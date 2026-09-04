import { mapToCandidate } from "../igdb/mappers.js";
import { shouldSkipNonIndependentGame } from "../igdb/gameType.js";
import type { IgdbClient, IgdbGameRaw } from "../igdb/types.js";
import type { Candidate, Game } from "../types/Game.js";
import type {
  EnrichmentService,
  EnrichmentUpdater,
} from "../services/enrichmentService.js";
import { mergeKeywords } from "../services/enrichmentService.js";
import type { BudgetLedger } from "../budget/budgetLedger.js";
import {
  RECOMMENDATION_CONFIG,
  type RecommendationConfig,
} from "../recommendation/constants.js";
import { SEMANTIC_FIELDS } from "../matching/constants.js";
import { withTimeout } from "../lib/withTimeout.js";
import { createTrace } from "../lib/logger.js";
import type { CatalogLayer } from "./types.js";

export type DiscoveryAttemptOutcome = "ok" | "budget-exhausted" | "error";

export interface DiscoveryAttempt {
  outcome: DiscoveryAttemptOutcome;
  newGames: Game[];
  // La unidad se cortó por presupuesto tras haber empezado bien
  budgetExhausted: boolean;
  // La query no tiene más candidatos sin procesar: el orquestador puede
  // avanzar a la siguiente variante sin contar unidad ni gastar.
  variantExhausted: boolean;
}

export type AnchorDiscoveryResult =
  | { status: "found"; game: Game }
  | { status: "not-found" }
  | { status: "budget-exhausted" }
  | { status: "error" };

export type ReEnrichResult =
  | { status: "updated"; game: Game }
  | { status: "not-found" }
  | { status: "skipped" }
  | { status: "budget-exhausted" }
  | { status: "error" };

export class DiscoveryManager {
  /*
   * Memoria de la última búsqueda IGDB: una query suele devolver ~10
   * candidatos y cada unidad solo enriquece 2. En lugar de repetir la
   * llamada (mismos resultados) o rendirnos al agotar las variantes, las
   * unidades siguientes CONSUMEN la lista guardada sin gastar IGDB.
   * V1: un solo proceso; peticiones concurrentes pueden entrelazar el
   * cursor (mismo criterio que la sesión en memoria).
   */
  private lastQuery: string | null = null;
  private lastRaws: IgdbGameRaw[] = [];
  private lastCursor = 0;

  constructor(
    private igdb: IgdbClient,
    private enrichment: EnrichmentService & Partial<EnrichmentUpdater>,
    private catalog: CatalogLayer,
    private budget: BudgetLedger,
    private config: RecommendationConfig = RECOMMENDATION_CONFIG,
  ) {}

  /*
   * Unidad de descubrimiento: 1 búsqueda IGDB → filtrar existentes →
   * enriquecer (2 Brave + 1 LLM por ficha) → persistir. La reserva de
   * Brave/LLM es por intento de enrich, así el presupuesto parcial
   * aprovecha lo que puede en lugar de bloquear la unidad entera.
   */
  async discoverByQuery(
    query: string,
    maxNew: number,
    traceId?: string,
  ): Promise<DiscoveryAttempt> {
    const trace = traceId ? createTrace(traceId) : null;
    const sameQuery = this.lastQuery === query;
    if (sameQuery && this.lastCursor >= this.lastRaws.length) {
      trace?.("igdb-list-exhausted", { query });
      return {
        outcome: "ok",
        newGames: [],
        budgetExhausted: false,
        variantExhausted: true,
      };
    }

    if (!sameQuery) {
      if (!this.budget.tryReserve("igdb", 1)) {
        return {
          outcome: "budget-exhausted",
          newGames: [],
          budgetExhausted: true,
          variantExhausted: false,
        };
      }

      let raws: IgdbGameRaw[];
      try {
        raws = await withTimeout(
          this.igdb.searchGames(query, 10),
          this.config.unitTimeoutMs,
          "IGDB search",
        );
      } catch {
        this.budget.release("igdb", 1);
        return {
          outcome: "error",
          newGames: [],
          budgetExhausted: false,
          variantExhausted: false,
        };
      }
      this.budget.commit("igdb", 1);
      this.lastQuery = query;
      this.lastRaws = raws;
      this.lastCursor = 0;
      trace?.("igdb-search", { query, results: raws.length });
    } else {
      trace?.("igdb-list-reuse", {
        query,
        remaining: this.lastRaws.length - this.lastCursor,
      });
    }

    const newGames: Game[] = [];
    let budgetExhausted = false;

    while (this.lastCursor < this.lastRaws.length && newGames.length < maxNew) {
      const raw = this.lastRaws[this.lastCursor];
      this.lastCursor++;
      if (shouldSkipNonIndependentGame(raw)) continue;

      const candidate = this.seedQueryKeywords(mapToCandidate(raw), query);
      if (await this.existsInCatalog(candidate.sourceId, candidate.slug))
        continue;

      if (!this.reserveEnrichmentBudget()) {
        // La ficha no se procesó: vuelve a la lista para la siguiente unidad.
        this.lastCursor--;
        budgetExhausted = true;
        break;
      }

      try {
        const enriched = await withTimeout(
          this.enrichment.enrich(candidate),
          this.config.unitTimeoutMs,
          "enrichment",
        );
        this.commitEnrichmentBudget();
        newGames.push(await this.catalog.create(enriched));
      } catch {
        // El intento pudo haber consumido llamadas de Brave a mitad: se
        // contabilizan igual (pesimista) y se sigue con el siguiente raw.
        this.commitEnrichmentBudget();
      }
    }

    trace?.("discovery-attempt", {
      query,
      created: newGames.map((game) => game.slug),
      budgetExhausted,
    });

    return {
      outcome: "ok",
      newGames,
      budgetExhausted,
      variantExhausted: this.lastCursor >= this.lastRaws.length,
    };
  }

  /*
   * Siembra: las palabras de la query que ENCONTRARON el juego en IGDB son
   * evidencia real de temática (el índice de búsqueda de IGDB las usó para
   * devolverlo) → se fusionan en las keywords del candidato ANTES del
   * enriquecimiento. Fichas guardadas = IGDB ∪ búsqueda (dedup), de modo
   * que lo descubierto matchea con la intención que lo descubrió.
   */
  private seedQueryKeywords(candidate: Candidate, query: string): Candidate {
    const terms = query
      .split(/\s+/)
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length >= 3);
    return { ...candidate, keywords: mergeKeywords(candidate.keywords, terms) };
  }

  // Ancla no resuelta en catálogo/cache: se busca por nombre en IGDB.
  // Si ya existe como ficha se devuelve tal cual (sin gastar enrichment).
  async discoverByName(
    title: string,
    traceId?: string,
  ): Promise<AnchorDiscoveryResult> {
    const trace = traceId ? createTrace(traceId) : null;
    if (!this.budget.tryReserve("igdb", 1)) {
      return { status: "budget-exhausted" };
    }

    let raws: IgdbGameRaw[];
    try {
      raws = await withTimeout(
        this.igdb.searchGames(title, 5),
        this.config.unitTimeoutMs,
        "IGDB anchor search",
      );
    } catch {
      this.budget.release("igdb", 1);
      return { status: "error" };
    }
    this.budget.commit("igdb", 1);
    trace?.("anchor-search", { title, results: raws.length });

    const raw = raws.find((r) => !shouldSkipNonIndependentGame(r));
    if (!raw) return { status: "not-found" };

    const candidate = mapToCandidate(raw);
    const existing =
      (await this.catalog.getBySourceId(candidate.sourceId)) ??
      (await this.catalog.getBySlug(candidate.slug));
    if (existing) {
      trace?.("anchor-found-existing", { slug: existing.slug });
      return { status: "found", game: existing };
    }

    if (!this.reserveEnrichmentBudget()) {
      return { status: "budget-exhausted" };
    }

    try {
      const enriched = await withTimeout(
        this.enrichment.enrich(candidate),
        this.config.unitTimeoutMs,
        "anchor enrichment",
      );
      this.commitEnrichmentBudget();
      const created = await this.catalog.create(enriched);
      trace?.("anchor-created", { slug: created.slug });
      return { status: "found", game: created };
    } catch {
      this.commitEnrichmentBudget();
      return { status: "error" };
    }
  }

  /*
   * Re-enrichment de una ficha existente: datos objetivos estables, semánticas
   * y description revisables. null del enrichment = sin evidencia nueva → se
   * conserva el valor previo (nunca se degrada una ficha conocida).
   */
  async reEnrich(game: Game, traceId?: string): Promise<ReEnrichResult> {
    const trace = traceId ? createTrace(traceId) : null;
    if (!game.sourceId) return { status: "skipped" };

    if (!this.budget.tryReserve("igdb", 1)) {
      return { status: "budget-exhausted" };
    }

    let raws: IgdbGameRaw[];
    try {
      raws = await withTimeout(
        this.igdb.searchGames(game.title, 5),
        this.config.unitTimeoutMs,
        "IGDB re-enrich search",
      );
    } catch {
      this.budget.release("igdb", 1);
      return { status: "error" };
    }
    this.budget.commit("igdb", 1);

    const raw = raws.find((candidateRaw) => {
      const candidate = mapToCandidate(candidateRaw);
      return (
        candidate.sourceId === game.sourceId || candidate.slug === game.slug
      );
    });
    if (!raw) {
      trace?.("re-enrich-not-found", { slug: game.slug });
      return { status: "not-found" };
    }

    const updater = this.enrichment.enrichForUpdate;
    if (!updater) return { status: "skipped" };

    if (!this.reserveEnrichmentBudget()) {
      return { status: "budget-exhausted" };
    }

    try {
      const candidate = mapToCandidate(raw);
      const enrichment = await withTimeout(
        updater.call(this.enrichment, candidate),
        this.config.unitTimeoutMs,
        "re-enrichment",
      );
      this.commitEnrichmentBudget();

      const semantic = enrichment.semantic;
      const updated: Game = {
        ...game,
        keywords: mergeKeywords(game.keywords, enrichment.additionalKeywords),
        difficulty: semantic.difficulty ?? game.difficulty,
        pace: semantic.pace ?? game.pace,
        narrative: semantic.narrative ?? game.narrative,
        complexity: semantic.complexity ?? game.complexity,
        coziness: semantic.coziness ?? game.coziness,
        strategy: semantic.strategy ?? game.strategy,
        exploration: semantic.exploration ?? game.exploration,
        violence: semantic.violence ?? game.violence,
        horror: semantic.horror ?? game.horror,
        darkness: semantic.darkness ?? game.darkness,
        tension: semantic.tension ?? game.tension,
        humor: semantic.humor ?? game.humor,
        isolation: semantic.isolation ?? game.isolation,
        description_es: enrichment.description_es || game.description_es,
        description_en: enrichment.description_en || game.description_en,
      };

      const updatedGame = await this.catalog.update(updated);
      trace?.("re-enrich-updated", {
        slug: updatedGame.slug,
        knownSemantics: knownSemanticsCount(updatedGame),
      });
      return { status: "updated", game: updatedGame };
    } catch {
      this.commitEnrichmentBudget();
      return { status: "error" };
    }
  }

  private async existsInCatalog(
    sourceId: string,
    slug: string,
  ): Promise<boolean> {
    return (
      (await this.catalog.getBySourceId(sourceId)) !== undefined ||
      (await this.catalog.getBySlug(slug)) !== undefined
    );
  }

  // Reserva atómica del coste de un enrich: si falla alguna de las dos
  // partes, se libera lo reservado para no bloquear saldo ajeno.
  private reserveEnrichmentBudget(): boolean {
    const braveReserved = this.budget.tryReserve(
      "brave",
      this.config.braveQueriesPerEnrichment,
    );
    if (!braveReserved) return false;

    const llmReserved = this.budget.tryReserve("llm", 1);
    if (!llmReserved) {
      this.budget.release("brave", this.config.braveQueriesPerEnrichment);
      return false;
    }

    return true;
  }

  private commitEnrichmentBudget(): void {
    this.budget.commit("brave", this.config.braveQueriesPerEnrichment);
    this.budget.commit("llm", 1);
  }
}

// Semánticas conocidas de una ficha (no null): umbral de re-enrichment.
export function knownSemanticsCount(game: Game): number {
  return SEMANTIC_FIELDS.filter((field) => game[field] !== null).length;
}
