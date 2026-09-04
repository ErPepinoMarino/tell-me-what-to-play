import { rankMatches } from "../matching/rankMatches.js";
import { SEMANTIC_FIELDS, TIER_RANK } from "../matching/constants.js";
import type { MatchReason, RankedMatch } from "../matching/types.js";
import type { Game } from "../types/Game.js";
import type { GameSearchIntent } from "../types/GameSearchIntent.js";
import type {
  MatchReasonDTO,
  RecommendationMeta,
  RecommendationResponse,
  RecommendationResultItem,
  RecommendedGameDTO,
  NoticeCode,
  RecommendationAction,
} from "../types/Recommendation.js";
import {
  RECOMMENDATION_CONFIG,
  type RecommendationConfig,
} from "../recommendation/constants.js";
import {
  appendShownIds,
  type SessionState,
  type SessionStore,
} from "../sessions/sessionStore.js";
import type {
  IntentExtractor,
  CatalogLayer,
  CacheLayer,
  RecommendationRequest,
} from "./types.js";
import {
  buildQueryVariants,
  gatherCandidates,
  findAnchorByTitle,
} from "./candidates.js";
import { DiscoveryManager, knownSemanticsCount } from "./discovery.js";
import {
  InterpretationError,
  LoginRequiredError,
  SessionExpiredError,
} from "./errors.js";
import {
  fallbackExplanation,
  type ExplanationComposer,
  type ExplanationInput,
} from "../services/explanationService.js";
import { createTrace, newTraceId, type Trace } from "../lib/logger.js";
import type { KeywordLexiconService } from "../services/keywordLexiconService.js";

export interface OrchestratorDeps {
  intents: IntentExtractor;
  cache: CacheLayer;
  catalog: CatalogLayer;
  discovery: DiscoveryManager;
  sessions: SessionStore;
  explainer: ExplanationComposer;
  /*
   * Opcional: canonicalización de keywords contra el léxico (FASE 4).
   * Sin léxico, el comportamiento es el previo (keywords crudas).
   */
  lexicon?: KeywordLexiconService;
}

export interface OrchestrationOutcome {
  response: RecommendationResponse;
  // Trabajo orgánico post-respuesta (ya iniciado). La ruta lo suelta en
  // fire-and-forget; los tests lo esperan explícitamente.
  background?: Promise<void>;
}

interface IntentResolution {
  intent: GameSearchIntent;
  session?: SessionState;
  userId?: number;
  shownGameIds: number[];
}

type StopReason =
  "budget" | "error" | "no-query" | "catalog-full" | "games-cap" | "deadline";

export class RecommendationOrchestrator {
  constructor(
    private deps: OrchestratorDeps,
    private config: RecommendationConfig = RECOMMENDATION_CONFIG,
  ) {}

  async handle(request: RecommendationRequest): Promise<OrchestrationOutcome> {
    const traceId = newTraceId();
    const trace = createTrace(traceId);
    const startedAt = Date.now();
    const notices = new Set<NoticeCode>();
    let discoveryUnitsUsed = 0;

    trace("request", {
      action: request.action,
      actor: request.actor.kind,
      message: request.message,
    });

    // RESOLVE_ACTION + INTERPRET
    const base = await this.resolveIntent(request, notices);
    const action = request.action;

    /*
     * Canonicalización contra el léxico (punto 1 de integración): las
     * keywords del usuario ("infectados") se mapean al vocabulario canónico
     * ("zombies") ANTES del matching, del pre-filtro y de persistir sesión.
     * Idempotente: los canónicos ya canonicalizados no gastan embeddings.
     */
    if (this.deps.lexicon) {
      base.intent = await this.deps.lexicon.canonicalizeIntent(base.intent);
    }

    trace("intent", {
      keywords: base.intent.keywords,
      genres: base.intent.objective?.genres,
      platforms: base.intent.objective?.platforms,
      gameModes: base.intent.objective?.gameModes,
      gameReferenced: base.intent.gameReferenced,
      semantic: base.intent.semantic,
    });

    if (isEmptyIntent(base.intent)) {
      notices.add("EMPTY_INTENT");
      this.persistSession(base, []);
      trace("response", {
        stopReason: "empty-intent",
        results: 0,
        durationMs: Date.now() - startedAt,
      });
      return {
        response: await this.composeResponse({
          action,
          intent: base.intent,
          userMessage: request.message,
          ranked: [],
          poolSize: 0,
          results: [],
          requestedGames: [],
          notices,
          exhaustedPool: true,
          discoveryUnitsUsed: 0,
          trace,
        }),
      };
    }

    // RESOLVE_ANCHORS
    const anchors: Game[] = [];
    const unresolved: string[] = [];
    for (const name of base.intent.gameReferenced ?? []) {
      try {
        const found = await findAnchorByTitle(
          name,
          this.deps.cache,
          this.deps.catalog,
        );
        if (found) anchors.push(found);
        else unresolved.push(name);
      } catch {
        notices.add("PG_DEGRADED");
        unresolved.push(name);
      }
    }
    trace("anchors", {
      resolved: anchors.map((anchor) => anchor.slug),
      unresolved,
    });
    for (const name of unresolved) {
      const result = await this.deps.discovery.discoverByName(name, traceId);
      if (result.status === "budget-exhausted") {
        notices.add("DISCOVERY_BUDGET_EXHAUSTED");
        notices.add("ANCHOR_NOT_FOUND");
        break;
      }
      if (result.status === "error") {
        notices.add("DISCOVERY_UNAVAILABLE");
        notices.add("ANCHOR_NOT_FOUND");
        break;
      }
      discoveryUnitsUsed++;
      if (result.status === "found") anchors.push(result.game);
      else notices.add("ANCHOR_NOT_FOUND");
    }
    if (anchors.length > 0) notices.add("EXPLICIT_GAME_REQUESTED");

    // GATHER pool local (pre-filtro PG + cache canonicalizada)
    let pool: Game[];
    try {
      pool = await gatherCandidates(
        this.deps.cache,
        this.deps.catalog,
        base.intent,
        this.config,
      );
    } catch {
      notices.add("PG_DEGRADED");
      pool = await this.cacheOnlyPool();
    }
    trace("pool", { candidates: pool.length });

    /*
     * Exclusión de mostrados: SOLO "more" evita repetir lo ya presentado.
     * En "search" los mostrados compiten de nuevo con la intención actual
     * (el LLM puede haberla extendido): siempre se muestran los mejores.
     */
    const excludeIds = action === "more" ? base.shownGameIds : [];

    let ranked = rankMatches(base.intent, pool, {
      anchors,
      excludeGameIds: excludeIds,
    }).ranked;

    // Relleno por necesidad: variantes de query y techo de fichas nuevas
    // (worst case = 8 juegos por petición). Para antes al llenar los slots,
    // agotar candidatos o secar el presupuesto diario.
    const variants = buildQueryVariants(base.intent);
    const slots = this.config.maxResults;
    let variantIndex = 0;
    let newGamesCreated = 0;
    let stopReason: StopReason | undefined;
    const fillDeadline = Date.now() + this.config.fillDeadlineMs;

    if (countValid(ranked, this.config) < slots) {
      let catalogFull = false;
      try {
        catalogFull =
          (await this.deps.catalog.countGames()) >= this.config.maxCatalogSize;
      } catch {
        // Si PG está caído el descubrimiento fallará por sí solo más adelante.
      }

      if (catalogFull) {
        notices.add("CATALOG_FULL");
        stopReason = "catalog-full";
      }

      while (
        !stopReason &&
        countValid(ranked, this.config) < slots &&
        newGamesCreated < this.config.maxNewGamesPerRequest
      ) {
        if (Date.now() >= fillDeadline) {
          // Relleno síncrono demasiado largo: parcial + "Más así" continúa.
          stopReason = "deadline";
          trace("fill-deadline", { created: newGamesCreated });
          break;
        }
        if (variantIndex >= variants.length) {
          stopReason = "no-query";
          break;
        }
        const variant = variants[variantIndex];

        const remainingGameCap =
          this.config.maxNewGamesPerRequest - newGamesCreated;
        const attempt = await this.deps.discovery.discoverByQuery(
          variant,
          Math.min(this.config.maxNewGamesPerDiscoveryUnit, remainingGameCap),
          traceId,
          base.intent,
        );
        if (attempt.outcome === "budget-exhausted") {
          // Un intento bloqueado por presupuesto no consume nada: no cuenta
          // como unidad ni como llamada.
          notices.add("DISCOVERY_BUDGET_EXHAUSTED");
          stopReason = "budget";
          break;
        }
        if (attempt.outcome === "error") {
          notices.add("DISCOVERY_UNAVAILABLE");
          stopReason = "error";
          break;
        }

        /*
         * La MISMA variante se repite mientras su lista siga dando juegos
         * (el gestor la reutiliza sin repetir la llamada IGDB). Solo se
         * avanza a la siguiente variante cuando la lista se agota o la
         * unidad resulta improductiva.
         */
        if (attempt.variantExhausted || attempt.newGames.length === 0) {
          variantIndex++;
        }
        if (attempt.newGames.length === 0) continue;

        pool.push(...attempt.newGames);
        ranked = rankMatches(base.intent, pool, {
          anchors,
          excludeGameIds: excludeIds,
        }).ranked;
        discoveryUnitsUsed++;
        newGamesCreated += attempt.newGames.length;
        trace("discovery-unit", {
          unit: discoveryUnitsUsed,
          query: variant,
          created: attempt.newGames.map((game) => game.slug),
          totalCreated: newGamesCreated,
          validSoFar: countValid(ranked, this.config),
          variantExhausted: attempt.variantExhausted,
        });
        if (attempt.budgetExhausted) {
          // El presupuesto de enriquecimiento se secó a mitad: más
          // intentos fallarían igual, paramos esta petición.
          notices.add("DISCOVERY_BUDGET_EXHAUSTED");
          stopReason = "budget";
        }
      }

      if (countValid(ranked, this.config) >= slots) stopReason = undefined;
      else if (
        !stopReason &&
        newGamesCreated >= this.config.maxNewGamesPerRequest
      )
        stopReason = "games-cap";
    }

    trace("fill-done", {
      stopReason,
      newGamesCreated,
      units: discoveryUnitsUsed,
      pool: pool.length,
      valid: countValid(ranked, this.config),
    });

    // SELECT: solo tier >= minTier, hasta llenar los slots de esta pregunta.
    const selected = ranked
      .filter((item) => TIER_RANK[item.tier] >= TIER_RANK[this.config.minTier])
      .slice(0, slots);

    const selectedIds = selected.map((item) => item.game.id);
    this.persistSession(base, selectedIds);
    try {
      await this.deps.catalog.incrementSearchCounts([
        ...selectedIds,
        ...anchors.map((anchor) => anchor.id),
      ]);
    } catch {
      // La popularidad es best-effort: no condiciona la respuesta.
    }

    const results = selected.map((item) => toResultItem(item));
    const resultsBelowSlots = results.length < slots;
    const exhaustedPool =
      resultsBelowSlots &&
      stopReason !== undefined &&
      stopReason !== "games-cap" &&
      stopReason !== "deadline";

    if (results.length < this.config.targetValidResults) {
      notices.add("PARTIAL_RESULTS");
    }
    if (exhaustedPool) notices.add("SEARCH_EXHAUSTED");

    // Crecimiento orgánico post-respuesta cuando la respuesta ya está llena.
    let background: Promise<void> | undefined;
    if (!resultsBelowSlots) {
      background = this.runOrganicPostResponse(
        ranked,
        variants.slice(variantIndex),
        traceId,
        base.intent,
      );
    }

    const response = await this.composeResponse({
      action,
      intent: base.intent,
      userMessage: request.message,
      ranked,
      poolSize: pool.length,
      results,
      requestedGames: anchors.map(toGameDTO),
      notices,
      exhaustedPool,
      discoveryUnitsUsed,
      trace,
    });
    trace("response", {
      stopReason,
      shown: response.results.length,
      tierCounts: response.meta.tierCounts,
      notices: response.notices,
      durationMs: Date.now() - startedAt,
    });

    return { response, background };
  }

  private async resolveIntent(
    request: RecommendationRequest,
    notices: Set<NoticeCode>,
  ): Promise<IntentResolution> {
    if (request.action === "more") {
      if (request.actor.kind === "anon") throw new LoginRequiredError();

      const session = this.deps.sessions.get(request.actor.userId);
      if (!session || !session.currentIntent) throw new SessionExpiredError();

      return {
        intent: session.currentIntent,
        session,
        userId: request.actor.userId,
        shownGameIds: session.shownGameIds,
      };
    }

    /*
     * search: intent nuevo. Si hay sesión con intención previa, el extractor
     * la recibe como contexto y decide si el mensaje la EXTIENDE (merge) o
     * la REEMPLAZA (tema nuevo): afinar o cambiar de tema es decisión del
     * intérprete, no del cliente.
     */
    let session: SessionState | undefined;
    let userId: number | undefined;
    let previousIntent: GameSearchIntent | undefined;

    if (request.actor.kind === "user") {
      userId = request.actor.userId;
      session = this.deps.sessions.ensure(userId);
      previousIntent = session.currentIntent ?? undefined;
    }

    const extracted = await this.extractWithRetry(request.message, previousIntent);

    /*
     * Salvaguarda determinista: si el mensaje no aporta intención nueva
     * ("sí", "¿y eso?") pero la sesión tenía una, se reutiliza la previa.
     * El LLM interpreta; el código decide con una regla verificable.
     */
    let intent = extracted;
    if (isEmptyIntent(extracted) && previousIntent) {
      intent = previousIntent;
      notices.add("INTENT_UNCHANGED");
    }

    return {
      intent,
      session,
      userId,
      shownGameIds: session?.shownGameIds ?? [],
    };
  }

  private async extractWithRetry(
    message: string,
    previousIntent?: GameSearchIntent,
  ): Promise<GameSearchIntent> {
    try {
      return await this.deps.intents.extract(message, previousIntent);
    } catch {
      try {
        return await this.deps.intents.extract(message, previousIntent);
      } catch {
        throw new InterpretationError();
      }
    }
  }

  private persistSession(base: IntentResolution, selectedIds: number[]): void {
    if (!base.session || base.userId === undefined) return;

    base.session.currentIntent = base.intent;
    if (selectedIds.length > 0) {
      base.session.shownGameIds = appendShownIds(
        base.session.shownGameIds,
        selectedIds,
        this.config.sessionShownCap,
      );
    }
    this.deps.sessions.save(base.userId, base.session);
  }

  /*
   * Trabajo orgánico post-respuesta: primero re-enrich de las fichas que el
   * usuario está viendo con menos semánticas que el umbral; después,
   * descubrimiento adyacente con las variantes de query no consumidas.
   */
  private runOrganicPostResponse(
    ranked: RankedMatch<Game>[],
    remainingVariants: string[],
    traceId: string,
    intent: GameSearchIntent,
  ): Promise<void> {
    return (async () => {
      let units = 0;

      const incomplete = ranked
        .filter(
          (item) => TIER_RANK[item.tier] >= TIER_RANK[this.config.minTier],
        )
        .map((item) => item.game)
        .filter(
          (game) =>
            knownSemanticsCount(game) < this.config.reEnrichMinKnownSemantics,
        );

      for (const game of incomplete) {
        if (units >= this.config.organicUnitsPerRequest) return;
        const result = await this.deps.discovery.reEnrich(game, traceId);
        if (result.status === "budget-exhausted") return;
        if (result.status !== "skipped") units++;
      }

      for (const variant of remainingVariants) {
        if (units >= this.config.organicUnitsPerRequest) return;
        await this.deps.discovery.discoverByQuery(
          variant,
          this.config.maxNewGamesPerDiscoveryUnit,
          traceId,
          intent,
        );
        units++;
      }
    })().catch((error) => {
      console.error("[organic] background work failed:", error);
    });
  }

  private async cacheOnlyPool(): Promise<Game[]> {
    const cacheGames = await this.deps.cache.getAll();
    return cacheGames.slice(0, this.config.matchPoolCap);
  }

  private async composeResponse(params: {
    action: RecommendationAction;
    intent: GameSearchIntent;
    ranked: RankedMatch[];
    poolSize: number;
    results: RecommendationResultItem[];
    requestedGames: RecommendedGameDTO[];
    notices: Set<NoticeCode>;
    exhaustedPool: boolean;
    discoveryUnitsUsed: number;
    trace: Trace;
    userMessage: string;
  }): Promise<RecommendationResponse> {
    const tierCounts = { excellent: 0, valid: 0, weak: 0, invalid: 0 };
    for (const item of params.ranked) tierCounts[item.tier]++;

    const meta: RecommendationMeta = {
      action: params.action,
      evaluatedCandidates: params.poolSize,
      partial: params.results.length < this.config.maxResults,
      exhaustedPool: params.exhaustedPool,
      tierCounts,
      discoveryUnitsUsed: params.discoveryUnitsUsed,
    };

    // Explicación global para AIChat: mismos datos deterministas que la UI.
    // En intención vacía no se gasta LLM: la plantilla pide más detalle.
    const explanationInput: ExplanationInput = {
      action: params.action,
      userMessage: params.userMessage,
      intent: params.intent,
      results: params.results.map((item) => ({
        title: item.game.title,
        tier: item.tier,
        topReasons: item.reasons.map((reason) => ({
          block: reason.block,
          field: reason.field,
          kind: reason.kind,
          note: reason.note,
        })),
      })),
      requestedGames: params.requestedGames.map((game) => game.title),
      notices: [...params.notices],
      meta: {
        evaluatedCandidates: params.poolSize,
        partial: meta.partial,
        exhaustedPool: params.exhaustedPool,
        tierCounts,
      },
    };
    const fallback = fallbackExplanation(explanationInput);
    let explanation: string;
    if (params.notices.has("EMPTY_INTENT")) {
      // En intención vacía no se gasta LLM: la plantilla pide más detalle.
      explanation = fallback;
    } else {
      const explanationStart = Date.now();
      let source: "llm" | "fallback";
      try {
        explanation = await this.deps.explainer.compose(explanationInput);
        source = explanation === fallback ? "fallback" : "llm";
      } catch {
        explanation = fallback;
        source = "fallback";
      }
      params.trace("explanation", {
        source,
        durationMs: Date.now() - explanationStart,
      });
    }

    return {
      results: params.results,
      requestedGames: params.requestedGames,
      intent: params.intent,
      explanation,
      notices: [...params.notices],
      meta,
    };
  }
}

function isEmptyIntent(intent: GameSearchIntent): boolean {
  const hasReferences = (intent.gameReferenced ?? []).length > 0;
  const hasKeywords = (intent.keywords ?? []).length > 0;
  /*
   * El objective/semantic son objetos con campos anulables: {genres:null,...}
   * NO es señal utilizable (lo devuelve el LLM con mensajes tipo "sí").
   * Las exclusiones (excluded) NO cuentan como señal: una intención que
   * solo dice "que no sea X" no define qué se busca → EMPTY_INTENT.
   */
  const hasObjective =
    intent.objective !== null &&
    [
      intent.objective.genres,
      intent.objective.platforms,
      intent.objective.gameModes,
      intent.objective.perspectives,
    ].some((fields) => (fields ?? []).length > 0);
  const hasYear =
    intent.releaseYear != null ||
    intent.yearFrom != null ||
    intent.yearTo != null;
  const hasSemantic =
    intent.semantic !== null &&
    SEMANTIC_FIELDS.some((field) => intent.semantic?.[field] !== null);
  return (
    !hasReferences &&
    !hasKeywords &&
    !hasObjective &&
    !hasYear &&
    !hasSemantic
  );
}

function countValid(
  ranked: RankedMatch[],
  config: RecommendationConfig,
): number {
  return ranked.filter(
    (item) => TIER_RANK[item.tier] >= TIER_RANK[config.minTier],
  ).length;
}

function toResultItem(item: RankedMatch<Game>): RecommendationResultItem {
  return {
    game: toGameDTO(item.game),
    score: item.score,
    tier: item.tier,
    coverage: { ...item.coverage },
    reasons: topReasons(item.reasons),
  };
}

function topReasons(reasons: MatchReason[]): MatchReasonDTO[] {
  /*
   * Se excluyen los "skipped" (ruido diagnóstico); los bonus a contribución
   * cero (keyword-match) se muestran tras los que puntúan: la temática no
   * suma, pero explica.
   */
  return [...reasons]
    .filter((reason) => reason.kind !== "skipped")
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3)
    .map((reason) => ({
      block: reason.block,
      field: reason.field,
      contribution: reason.contribution,
      kind: reason.kind,
      note: reason.note,
    }));
}

function toGameDTO(game: Game): RecommendedGameDTO {
  return {
    id: game.id,
    slug: game.slug,
    title: game.title,
    coverUrl: game.coverUrl,
    releaseYear: game.releaseYear,
    genres: [...game.genres],
    platforms: [...game.platforms],
    gameModes: [...game.gameModes],
    perspectives: [...game.perspectives],
    description_es: game.description_es,
    description_en: game.description_en,
    keywords: [...game.keywords],
  };
}
