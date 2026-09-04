import { mapToCandidate } from "../igdb/mappers.js";
import { shouldSkipNonIndependentGame } from "../igdb/gameType.js";
import type { IgdbClient, IgdbGameRaw } from "../igdb/types.js";
import type { Candidate, Game, GameToPersist } from "../types/Game.js";
import type { GameSearchIntent } from "../types/GameSearchIntent.js";
import { passesHardFilters } from "../matching/matchGame.js";
import { KEYWORD_STOPWORDS } from "../matching/keywords.js";
import type { MatchableGame } from "../matching/types.js";
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
    // Opcional (FASE 4): canonicalización de keywords contra el léxico.
    private lexicon?: { canonicalizeTerms(terms: string[]): Promise<string[]> },
  ) {}

  private async canonicalizeKeywords(terms: string[]): Promise<string[]> {
    return this.lexicon ? this.lexicon.canonicalizeTerms(terms) : terms;
  }

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
    intent?: GameSearchIntent,
  ): Promise<DiscoveryAttempt> {
    const trace = traceId ? createTrace(traceId) : null;

    /*
     * Canonicalización (punto 3 de integración): los términos de la query
     * que sembramos en las fichas ya nacen canónicos ("infectados" →
     * "zombies"), de modo que el pre-filtro must y el matcher los vean.
     */
    const normalizedQuery = query.trim().toLowerCase();
    const queryWords = normalizedQuery
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !KEYWORD_STOPWORDS.has(word));
    const seedTerms = this.lexicon
      ? await this.lexicon.canonicalizeTerms(
          normalizedQuery.length > 0 ? [normalizedQuery, ...queryWords] : [],
        )
      : normalizedQuery.length > 0
        ? [normalizedQuery, ...queryWords]
        : [];
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
          this.igdb.searchGames(query, this.config.igdbSearchLimit),
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
      /*
       * Una lista VACÍA no se cachea como cursor agotado: la query volvería
       * a "agotada" para siempre sin reintentar (falla transitoria de IGDB
       * o búsqueda sin resultados todavía). Solo las listas con resultados
       * son reutilizables entre unidades.
       */
      this.lastQuery = raws.length > 0 ? query : null;
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
      if (this.isLowQualityRaw(raw)) continue;

      const candidate = this.seedQueryKeywords(mapToCandidate(raw), seedTerms);

      /*
       * Pre-filtro must: si el candidato (ya con las keywords de la query
       * sembradas) falla los filtros duros del intent, está condenado a
       * invalid — no merece existsInCatalog ni Brave/LLM. Trade-off
       * asumido: no se almacena; si encaja en búsquedas futuras cuyo intent
       * lo admita, se redescubrirá entonces con las keywords correctas.
       */
      if (intent && !passesHardFilters(intent, candidateAsMatchable(candidate))) {
        trace?.("discovery-skip-must", { slug: candidate.slug, query });
        continue;
      }

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
          /*
           * Canonicalización (punto 2 de integración): las keywords
           * adicionales del enrichment convergen al vocabulario canónico
           * antes de persistir.
           */
          if (this.lexicon) {
            enriched.keywords = await this.lexicon.canonicalizeTerms(
              enriched.keywords,
            );
          }
        /*
         * Garantía de calidad del catálogo: si el enrichment no aporta
         * NINGUNA semántica conocida NI keywords nuevas, la ficha es
         * inservible para el matching (todo null = no comparable) y solo
         * ensucia la BDD. Se gasta el Brave (ya consumido) pero NO se
         * persiste.
         */
        if (!enrichmentAddsValue(enriched, candidate)) {
          trace?.("discovery-skip-empty", { slug: candidate.slug });
          continue;
        }
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
   * Siembra: la query que ENCONTRÓ el juego en IGDB es evidencia real de
   * temática (el índice de búsqueda la usó para devolverlo) → se fusiona
   * en las keywords del candidato ANTES del enriquecimiento, junto con sus
   * palabras (≥3 letras) por si el intent las pide sueltas. La query
   * completa va como UNA keyword: "car wash" del intent debe casar con la
   * ficha descubierta por "car wash", no con "car" y "wash" por separado.
   * Fichas guardadas = IGDB ∪ búsqueda (dedup), de modo que lo descubierto
   * matchea con la intención que lo descubrió.
   */
  private seedQueryKeywords(candidate: Candidate, terms: string[]): Candidate {
    return { ...candidate, keywords: mergeKeywords(candidate.keywords, terms) };
  }

  /*
   * Gate de calidad del relleno: sin señal comunitaria mínima en IGDB, la
   * ficha es probablemente ruido (títulos genéricos, apps infantiles) y no
   * merece 2 Brave + 1 LLM. Sin dato (undefined) = desconocido = se
   * conserva, coherente con "null no significa cero".
   */
  private isLowQualityRaw(raw: IgdbGameRaw): boolean {
    return (
      typeof raw.total_rating_count === "number" &&
      raw.total_rating_count < this.config.minIgdbRatingCount
    );
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
   * Re-enrichment de una ficha existente: null del enrichment = sin evidencia
   * nueva → se conserva el valor previo (nunca se degrada una ficha conocida).
   *
   * Fichas incompletas (p. ej. las del seed sin source_id): el match contra
   * IGDB se hace también por título normalizado y, si la ficha no tiene
   * source_id, se ADOPTAN los datos objetivos del candidato (identidad,
   * clasificaciones, portada, año) además de semánticas y keywords. Así una
   * ficha "casi vacía" queda rehabilitada de una pasada.
   */
  async reEnrich(game: Game, traceId?: string): Promise<ReEnrichResult> {
    const trace = traceId ? createTrace(traceId) : null;
    const adoptObjective = game.sourceId === null;

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

    // Clave de comparación de títulos: minúsculas sin puntuación y con
    // numerales romanos a dígitos — IGDB usa apóstrofes tipográficos
    // ("Baldur’s"), títulos canónicos más largos ("The Witcher 3: Wild
    // Hunt") y numeración romana ("Baldur’s Gate III").
    const ROMAN_TO_DIGIT: Record<string, string> = {
      i: "1",
      ii: "2",
      iii: "3",
      iv: "4",
      v: "5",
    };
    const titleKey = (title: string) =>
      title
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map((token) => ROMAN_TO_DIGIT[token] ?? token)
        .join("");
    const gameTitleKey = titleKey(game.title);

    const raw = raws.find((candidateRaw) => {
      const candidate = mapToCandidate(candidateRaw);
      if (game.sourceId !== null && candidate.sourceId === game.sourceId) {
        return true;
      }
      if (candidate.slug === game.slug) return true;
      const candidateKey = titleKey(candidate.title);
      if (candidateKey === gameTitleKey) return true;
      // Contención con guardia de longitud (evita claves cortas ambiguas).
      return (
        gameTitleKey.length >= 6 &&
        (candidateKey.includes(gameTitleKey) ||
          gameTitleKey.includes(candidateKey))
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
        // Objetivos: estables salvo en fichas sin identidad (seed), que se
        // rehabilitan con los datos canónicos de IGDB. Compañías: se rellenan
        // si faltan, nunca se degradan las conocidas.
        sourceId: adoptObjective ? candidate.sourceId : game.sourceId,
        coverUrl: adoptObjective
          ? (candidate.coverUrl ?? game.coverUrl)
          : game.coverUrl,
        releaseYear: adoptObjective
          ? (candidate.releaseYear ?? game.releaseYear)
          : game.releaseYear,
        genres: adoptObjective ? candidate.genres : game.genres,
        platforms: adoptObjective ? candidate.platforms : game.platforms,
        gameModes: adoptObjective ? candidate.gameModes : game.gameModes,
        perspectives: adoptObjective
          ? candidate.perspectives
          : game.perspectives,
        developers:
          game.developers.length > 0 ? game.developers : candidate.developers,
        publishers:
          game.publishers.length > 0 ? game.publishers : candidate.publishers,
        keywords: await this.canonicalizeKeywords(
          mergeKeywords(
            mergeKeywords(game.keywords, candidate.keywords),
            enrichment.additionalKeywords,
          ),
        ),
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

/*
 * Vista MatchableGame de un Candidate para el pre-filtro must: sin
 * semánticas aún (el enrichment las escribirá), que es exactamente el
 * estado en el que el candidato se evaluaría al entrar al matcher.
 */
function candidateAsMatchable(candidate: Candidate): MatchableGame {
  const nulls = Object.fromEntries(
    SEMANTIC_FIELDS.map((field) => [field, null]),
  ) as Record<(typeof SEMANTIC_FIELDS)[number], null>;
  return {
    id: 0,
    slug: candidate.slug,
    sourceId: candidate.sourceId,
    title: candidate.title,
    releaseYear: candidate.releaseYear,
    genres: candidate.genres,
    platforms: candidate.platforms,
    gameModes: candidate.gameModes,
    perspectives: candidate.perspectives,
    keywords: candidate.keywords,
    ...nulls,
  };
}

/*
 * ¿Aporta algo el enrichment? Garantía de calidad del catálogo: una ficha
 * sin NINGUNA semántica conocida y sin keywords nuevas no matchea nunca
 * (todo null = no comparable) y solo ensucia la BDD.
 */
function enrichmentAddsValue(
  enriched: GameToPersist,
  candidate: Candidate,
): boolean {
  const hasSemantics = SEMANTIC_FIELDS.some(
    (field) => enriched[field] !== null,
  );
  const addsKeywords = enriched.keywords.length > candidate.keywords.length;
  return hasSemantics || addsKeywords;
}
