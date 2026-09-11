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
  RecommendationStreamSink,
  NoticeCode,
  RecommendationAction,
} from "../types/Recommendation.js";
import {
  RECOMMENDATION_CONFIG,
  type RecommendationConfig,
} from "../recommendation/constants.js";

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
import {
  createDiscoveryRun,
  DiscoveryManager,
  knownSemanticsCount,
  type DiscoveryRun,
} from "./discovery.js";
import { InterpretationError } from "./errors.js";
import {
  fallbackExplanation,
  type ExplanationComposer,
  type ExplanationInput,
} from "../services/explanationService.js";
import { applyRefineDelta } from "../services/intentService.js";
import { filterGenderMismatchedAdditions } from "../matching/keywords.js";
import { redirectKeywordsToEnumFields } from "../igdb/normalizers.js";
import type { RefineDelta } from "../types/GameSearchIntent.js";
import { createTrace, newTraceId, type Trace } from "../lib/logger.js";
import type { KeywordLexiconService } from "../services/keywordLexiconService.js";

export interface OrchestratorDeps {
  intents: IntentExtractor;
  cache: CacheLayer;
  catalog: CatalogLayer;
  discovery: DiscoveryManager;
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
  /*
   * El cliente es el dueño del ciclo de vida conversacional: con "reset" el
   * turno fue una búsqueda nueva (vacía "mostrados"); con "continue" siguió
   * el mismo hilo (refine, more, o ningún resultado) y acumula mostrados.
   */
  lifecycle: "reset" | "continue";
  shownGameIds: number[];
  /*
   * Cuando el clasificador devuelve "refine" pero el delta está vacío
   * (el usuario pide "más" sin añadir criterios), se excluyen los ya
   * mostrados como haría "more". Este flag lo señala.
   */
  excludeShown: boolean;
  /*
   * Intent previo del cliente (refine): tal como lo envió en contextIntent.
   * Tras normalizar el intent actual se compara contra este: si son iguales,
   * el refine es un no-op equivale a "more". Solo se informa en refines.
   */
  previousIntent?: GameSearchIntent;
  /*
   * Keywords que el torniquete de género dropeó de los añadidos del delta
   * (p. ej. "cowgirls" con mensaje masculino). Solo para traza.
   */
  genderDropped?: string[];
}

type StopReason =
  "budget" | "error" | "no-query" | "catalog-full" | "games-cap" | "deadline";

export class RecommendationOrchestrator {
  constructor(
    private deps: OrchestratorDeps,
    private config: RecommendationConfig = RECOMMENDATION_CONFIG,
  ) {}

  async handle(
    request: RecommendationRequest,
    sink?: RecommendationStreamSink,
  ): Promise<OrchestrationOutcome> {
    const traceId = newTraceId();
    const trace = createTrace(traceId);
    const startedAt = Date.now();
    const notices = new Set<NoticeCode>();
    let discoveryUnitsUsed = 0;
    // Estado de descubrimiento de ESTA petición: cada ejecución tiene la
    // suya para que dos requests concurrentes no se entrelacen el cursor
    // ni se pisen la lista IGDB a través de los awaits.
    const discoveryRun = createDiscoveryRun();

    trace("request", {
      action: request.action,
      actor: request.actor.kind,
      message: request.message,
    });

    // RESOLVE_ACTION + INTERPRET
    const base = await this.resolveIntent(request, notices);
    const action = request.action;

    // Paso 1 del procesado de keywords: rescata a los vocabularios enum
    // (genres/themes/platforms/gameModes/perspectives) las keywords que
    // pertenezcan a un vocabulario CERRADO — son filtros must que el léxico
    // descartaría si quedaran como keyword (p. ej. "horror" no es keyword IGDB).
    base.intent = redirectKeywordsToEnumFields(base.intent);

    /*
     * Canonicalización contra el léxico (punto 1 de integración): las
     * keywords del usuario ("infectados") se mapean al vocabulario canónico
     * ("zombies") ANTES del matching, del pre-filtro y de persistir sesión.
     * Idempotente: los canónicos ya canonicalizados no gastan embeddings.
     */
    if (this.deps.lexicon) {
      base.intent = await this.deps.lexicon.canonicalizeIntent(base.intent);
      this.traceLexiconDrops(trace);
    }

    /*
     * No-op tardío: la comparación pre-normalización de resolveIntent no ve
     * lo que el redirect/léxico liman después (p. ej. el delta traía
     * "more like this" y el léxico lo dropeó, dejando un intent idéntico
     * al previo). Se compara lo que se va a buscar contra lo que se buscó,
     * ambos normalizados: si coinciden, es un "dame más".
     */
    if (
      !base.excludeShown &&
      base.previousIntent &&
      isSameIntent(base.intent, base.previousIntent)
    ) {
      base.excludeShown = true;
      trace("exclude-noop-late", {});
    }

    if (base.genderDropped && base.genderDropped.length > 0) {
      trace("keyword-gender-dropped", { terms: base.genderDropped });
    }

    trace("intent", {
      keywords: base.intent.keywords,
      genres: base.intent.objective?.genres,
      themes: base.intent.objective?.themes,
      platforms: base.intent.objective?.platforms,
      gameModes: base.intent.objective?.gameModes,
      perspectives: base.intent.objective?.perspectives,
      gameReferenced: base.intent.gameReferenced,
      releaseYear: base.intent.releaseYear,
      yearFrom: base.intent.yearFrom,
      yearTo: base.intent.yearTo,
      excluded: base.intent.excluded,
      relation: base.intent.relation ?? null,
      semantic: base.intent.semantic,
    });
    // Streaming: el intent viaja en cuanto se resuelve (chips inmediatos).
    sink?.({ event: "intent", intent: base.intent });

    /*
     * Input sin sentido (clasificador = "nonsensical"): el mensaje no tiene
     * relación con buscar videojuegos. Se rechaza sin gastar en descubrimiento
     * ni explicación, aplicable a anon y logueado por igual.
     */
    if (base.intent.relation === "nonsensical") {
      notices.add("SENSELESS_INPUT");
      const response = {
        results: [],
        requestedGames: [],
        intent: base.intent,
        explanation: "",
        notices: [...notices],
        meta: {
          action,
          lifecycle: base.lifecycle,
          evaluatedCandidates: 0,
          partial: true,
          exhaustedPool: true,
          tierCounts: { excellent: 0, valid: 0, weak: 0, invalid: 0 },
          discoveryUnitsUsed: 0,
        },
      };
      trace("response", {
        stopReason: "senseless-input",
        results: 0,
        durationMs: Date.now() - startedAt,
      });
      return { response };
    }

    /*
     * ANON intenta REFINAR (relation "refine", detectado con el contexto del
     * cliente): el refinamiento es feature de sesión → CTA de login, sin
     * gastar descubrimiento ni explicación.
     */
    if (request.actor.kind === "anon" && base.intent.relation === "refine") {
      notices.add("REFINE_REQUIRES_LOGIN");
      const response = {
        results: [],
        requestedGames: [],
        intent: base.intent,
        explanation: "",
        notices: [...notices],
        meta: {
          action,
          lifecycle: base.lifecycle,
          evaluatedCandidates: 0,
          partial: true,
          exhaustedPool: true,
          tierCounts: { excellent: 0, valid: 0, weak: 0, invalid: 0 },
          discoveryUnitsUsed: 0,
        },
      };
      trace("response", {
        stopReason: "refine-requires-login",
        results: 0,
        durationMs: Date.now() - startedAt,
      });
      return { response };
    }

    if (isEmptyIntent(base.intent)) {
      notices.add("EMPTY_INTENT");
      trace("response", {
        stopReason: "empty-intent",
        results: 0,
        durationMs: Date.now() - startedAt,
      });
      return {
        response: await this.composeResponse({
          action,
          lifecycle: base.lifecycle,
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
          relaxedFilters: [],
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

    /*
     * Herencia de perfil del ancla ("algo similar a X" sin más señal): la
     * ficha del ancla define la búsqueda — sus géneros como must y su
     * perfil semántico como ranking, CAPADO a 0.8 para no disparar el gate
     * de presencia (las semánticas heredadas son referencia, no exigencia).
     * Las keywords del ancla NO se heredan como must (el problema "kratos"):
     * el parecido por keywords lo resuelve el gate de overlap del matcher.
     */
    if (
      anchors.length > 0 &&
      (base.intent.keywords ?? []).length === 0 &&
      base.intent.semantic === null &&
      base.intent.objective === null
    ) {
      const anchor = anchors[0];
      const profile = Object.fromEntries(
        SEMANTIC_FIELDS.map((field) => [
          field,
          anchor[field] === null
            ? null
            : Math.min(anchor[field] as number, 0.8),
        ]),
      ) as GameSearchIntent["semantic"];
      base.intent = {
        ...base.intent,
        objective: {
          genres: [...anchor.genres],
          themes: [...anchor.themes],
          platforms: null,
          gameModes: null,
          perspectives: null,
        },
        semantic: profile,
      };
      trace("anchor-profile-inherited", {
        anchor: anchor.slug,
        genres: anchor.genres,
        themes: anchor.themes,
      });
    }

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
     * Exclusión de mostrados: "more" Y refine no-op (delta vacío o fusión
     * idéntica a la previa: el usuario pide "más" sin cambiar criterios)
     * evitan repetir lo ya presentado. En "search" normal y en refine CON
     * cambios, los mostrados compiten de nuevo con la intención actual:
     * siempre se muestran los mejores.
     */
    const excludeIds =
      action === "more" || base.excludeShown ? base.shownGameIds : [];
    trace("exclude", {
      excludeShown: action === "more" || base.excludeShown,
      excludeIds: excludeIds.length,
    });

    let ranked = rankMatches(base.intent, pool, {
      anchors,
      excludeGameIds: excludeIds,
    }).ranked;

    // Relleno por necesidad: variantes de query y techo de fichas nuevas
    // (worst case = 8 juegos por petición). Para antes al llenar los slots,
    // agotar candidatos o secar el presupuesto diario.
    const variants = buildQueryVariants(base.intent);
    const slots = this.config.maxResults;
    // Streaming: snapshot rankeado (top slots) con el ranking dado. El
    // frontend reconcilia por id: lo existente se queda, lo nuevo entra
    // con efecto. Sin sink no cuesta nada.
    const emitResults = (current: typeof ranked = ranked): void => {
      if (!sink) return;
      sink({
        event: "results",
        results: current
          .filter(
            (item) => TIER_RANK[item.tier] >= TIER_RANK[this.config.minTier],
          )
          .slice(0, slots)
          .map((item) => toResultItem(item)),
      });
    };
    // Primera tanda inmediata (pool local, ~ms): gratificación instantánea
    // antes de lo caro (descubrimiento).
    emitResults();
    let variantIndex = 0;
    let newGamesCreated = 0;
    let stopReason: StopReason | undefined;
    let fillEnrichmentErrors = 0;
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
          anchors,
          // Ficha a ficha: cada creado re-rankea y se emite sin esperar
          // a la tanda (el pool aún no incluye lo nuevo: se previsualiza).
          (created) =>
            emitResults(
              rankMatches(base.intent, [...pool, ...created], {
                anchors,
                excludeGameIds: excludeIds,
              }).ranked,
            ),
          discoveryRun,
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
        fillEnrichmentErrors += attempt.enrichmentErrors;

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

    /*
     * Rescate relajado (RAMA "more": el botón la trae siempre, y el refine
     * sin cambios equivale a pulsarlo): si lo estricto no creó nada y
     * faltan resultados, criba en cascada (recicla la lista estricta del
     * turno o, sin caché, una llamada amplia). El resto del tiempo somos
     * estrictos y honestos. La sesión guarda el intent ORIGINAL; el
     * efectivo (relajado) solo rankea y responde este turno.
     */
    let effectiveIntent = base.intent;
    let relaxedGroups: string[] = [];
    if (
      base.excludeShown &&
      newGamesCreated === 0 &&
      countValid(ranked, this.config) < slots &&
      (!stopReason || stopReason === "no-query")
    ) {
      const broadQuery =
        variants[0] ?? (base.intent.keywords ?? []).slice(0, 3).join(" ");
      const rescue = await this.deps.discovery.discoverRelaxed(
        broadQuery,
        this.config.maxNewGamesPerRequest - newGamesCreated,
        traceId,
        base.intent,
        anchors,
        // Ficha a ficha con el intent efectivo vigente en cada creación.
        (created, filterIntent) =>
          emitResults(
            rankMatches(filterIntent ?? base.intent, [...pool, ...created], {
              anchors,
              excludeGameIds: excludeIds,
            }).ranked,
          ),
      );
      fillEnrichmentErrors += rescue.enrichmentErrors;
      if (rescue.outcome === "budget-exhausted") {
        notices.add("DISCOVERY_BUDGET_EXHAUSTED");
        stopReason = "budget";
      } else if (rescue.outcome === "error") {
        notices.add("DISCOVERY_UNAVAILABLE");
        stopReason = "error";
      } else if (rescue.newGames.length > 0) {
        pool.push(...rescue.newGames);
        newGamesCreated += rescue.newGames.length;
        discoveryUnitsUsed++;
        effectiveIntent = rescue.relaxedIntent;
        relaxedGroups = [...rescue.droppedGroups];
        notices.add("RELAXED_FILTERS");
        ranked = rankMatches(effectiveIntent, pool, {
          anchors,
          excludeGameIds: excludeIds,
        }).ranked;
        trace("rescue-relaxed", {
          created: rescue.newGames.map((game) => game.slug),
          droppedGroups: relaxedGroups,
          valid: countValid(ranked, this.config),
        });
      }
    }

    trace("fill-done", {
      stopReason,
      newGamesCreated,
      units: discoveryUnitsUsed,
      pool: pool.length,
      valid: countValid(ranked, this.config),
      enrichmentErrors: fillEnrichmentErrors,
    });

    // Drops del diccionario durante el relleno (pistas de búsqueda/enrichment/rescate).
    if (this.deps.lexicon) this.traceLexiconDrops(trace);

    // Enrichments fallidos (p. ej. Brave 402) sin crear nada: el
    // descubrimiento está degradado y el usuario debe saberlo.
    if (fillEnrichmentErrors > 0 && newGamesCreated === 0) {
      notices.add("DISCOVERY_UNAVAILABLE");
    }

    // SELECT: solo tier >= minTier, hasta llenar los slots de esta pregunta.
    const selected = ranked
      .filter((item) => TIER_RANK[item.tier] >= TIER_RANK[this.config.minTier])
      .slice(0, slots);

    const selectedIds = selected.map((item) => item.game.id);
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
        anchors,
        discoveryRun,
      );
    }

    const response = await this.composeResponse({
      action,
      lifecycle: base.lifecycle,
      intent: effectiveIntent,
      userMessage: request.message,
      ranked,
      poolSize: pool.length,
      results,
      requestedGames: anchors.map(toGameDTO),
      notices,
      exhaustedPool,
      discoveryUnitsUsed,
      trace,
      relaxedFilters: relaxedGroups,
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
    const shownGameIds = request.shownGameIds ?? [];

    if (request.action === "more") {
      /*
       * more: el cliente entrega la intención en curso y los mostrados. Sin
       * contexto útil no hay búsqueda previa que continuar. La UI solo
       * habilita el botón tras una búsqueda con resultados, pero se defiende
       * igual cayendo al camino de intención vacía (EMPTY_INTENT reutilizado).
       */
      const context = request.contextIntent;
      if (!context || isEmptyIntent(context)) {
        return {
          intent: { ...EMPTY_INTENT },
          lifecycle: "continue",
          shownGameIds,
          excludeShown: true,
        };
      }
      return {
        intent: context,
        lifecycle: "continue",
        shownGameIds,
        excludeShown: true,
      };
    }

    /*
     * search: el contexto previo es el contextIntent del cliente para TODOS
     * los actores (el servidor ya no guarda sesión). Se clasifica SIEMPRE:
     * el clasificador decide entre refine, new y nonsensical — el nonsensical
     * se devuelve temprano para rechazarlo sin gastar en descubrimiento ni
     * explicación.
     */
    const previousIntent = request.contextIntent ?? undefined;

    const relation = await this.classifyRelationStep(
      request.message,
      previousIntent,
    );

    /*
     * Sin previo útil no hay nada que refinar: un "refine" sin contexto o con
     * intención vacía se trata como búsqueda nueva (extracción fresca).
     * Además de honesto, evita el crash de fusionar contra undefined.
     */
    const effectiveRelation =
      relation === "refine" &&
      (!previousIntent || isEmptyIntent(previousIntent))
        ? "new"
        : relation;

    if (relation === "nonsensical") {
      return {
        intent: { ...EMPTY_INTENT, relation: "nonsensical" },
        lifecycle: "continue",
        shownGameIds,
        excludeShown: false,
      };
    }

    if (effectiveRelation === "refine") {
      if (request.actor.kind === "anon") {
        // El gate de refine vive en handle(): aquí solo dejamos la señal.
        return {
          intent: { ...(previousIntent ?? EMPTY_INTENT), relation: "refine" },
          lifecycle: "continue",
          shownGameIds,
          excludeShown: false,
        };
      }
      // Logueado: el previo lo trae el cliente (contextIntent).
      const delta = await this.extractDeltaWithRetry(
        request.message,
        previousIntent!,
      );
      // Torniquete de género: los añadidos con género contradicho por el
      // mensaje se dropean ANTES del merge ("vaqueros" no suma "cowgirls").
      // Solo delta-adds: jamás toca lo que el cliente envió ni el merge.
      const genderChecked = filterGenderMismatchedAdditions(
        request.message,
        delta.add?.keywords ?? null,
      );
      const genderDropped = genderChecked.dropped;
      const sanitizedDelta: RefineDelta = {
        ...delta,
        add: delta.add
          ? { ...delta.add, keywords: genderChecked.kept }
          : delta.add,
      };
      const intent = applyRefineDelta(previousIntent!, sanitizedDelta);
      // No-op refine (delta vacío o re-mención de lo ya pedido: el fusionado
      // es idéntico al previo) equivale a pulsar "dame más": se excluye lo
      // mostrado en vez de re-competir y re-mostrar lo mismo.
      const excludeShown =
        isDeltaEmpty(sanitizedDelta) || isSameIntent(intent, previousIntent!);
      return {
        intent,
        lifecycle: "continue",
        shownGameIds,
        excludeShown,
        // Foto del intent previo (normalizado del turno anterior): en
        // handle() se re-compara tras normalizar el actual, por si el
        // léxico/redirect limaron la diferencia (p. ej. "more like this").
        previousIntent: previousIntent!,
        genderDropped,
      };
    }

    /*
     * "new": extracción fresca, el intent previo es irrelevante. Si la
     * extracción queda vacía y el cliente traía contexto, se hereda
     * (INTENT_UNCHANGED): el mensaje no aportó señal nueva y el hilo de
     * búsqueda no cambia → lifecycle "continue" (no se resetean mostrados).
     */
    const extracted = await this.extractWithRetry(request.message);
    let intent = extracted;
    let unchanged = false;
    if (isEmptyIntent(extracted) && previousIntent) {
      intent = previousIntent;
      unchanged = true;
      notices.add("INTENT_UNCHANGED");
    }

    return {
      intent,
      lifecycle: unchanged ? "continue" : "reset",
      shownGameIds,
      excludeShown: false,
    };
  }

  /*
   * Clasificación refine-vs-new-vs-nonsensical. Usa el paso dedicado
   * (classifyRelation) cuando el extractor lo provee; sin clasificador se
   * asume búsqueda nueva (fakes/tests): el refinamiento es el caso que exige
   * el clasificador. El previousIntent es opcional: sin contexto, el
   * clasificador decide entre new y nonsensical.
   */
  private async classifyRelationStep(
    message: string,
    previousIntent?: GameSearchIntent,
  ): Promise<"new" | "refine" | "nonsensical"> {
    const classifier = this.deps.intents.classifyRelation;
    if (classifier) {
      return classifier(message, previousIntent);
    }
    return "new";
  }

  private async extractDeltaWithRetry(
    message: string,
    previousIntent: GameSearchIntent,
  ): Promise<RefineDelta> {
    const extractor = this.deps.intents.extractRefineDelta;
    if (!extractor) {
      // Sin extractor de delta (fakes/tests): refinamiento sin cambios.
      return { add: null, remove: null, excluded: null };
    }
    try {
      return await extractor(message, previousIntent);
    } catch {
      try {
        return await extractor(message, previousIntent);
      } catch {
        throw new InterpretationError();
      }
    }
  }

  private async extractWithRetry(message: string): Promise<GameSearchIntent> {
    try {
      return await this.deps.intents.extract(message);
    } catch {
      try {
        return await this.deps.intents.extract(message);
      } catch {
        throw new InterpretationError();
      }
    }
  }

  /*
   * Trace de la política conservadora del diccionario: cada keyword de
   * usuario que no matcheó ningún canónico de IGDB se ignora (no se guarda).
   * Nunca en silencio.
   */
  private traceLexiconDrops(trace: Trace): void {
    for (const drop of this.deps.lexicon?.drainDropped() ?? []) {
      trace("keyword-ignored", {
        term: drop.term,
        topMatch: drop.topMatch ?? null,
        similarity: drop.similarity ?? 0,
      });
    }
  }

  private runOrganicPostResponse(
    ranked: RankedMatch<Game>[],
    remainingVariants: string[],
    traceId: string,
    intent: GameSearchIntent,
    anchors: Game[],
    discoveryRun: DiscoveryRun,
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
          anchors,
          undefined,
          discoveryRun,
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
    lifecycle: "reset" | "continue";
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
    // Grupos soltados por la criba relajada (vacío = estricta).
    relaxedFilters: string[];
  }): Promise<RecommendationResponse> {
    const tierCounts = { excellent: 0, valid: 0, weak: 0, invalid: 0 };
    for (const item of params.ranked) tierCounts[item.tier]++;

    const meta: RecommendationMeta = {
      action: params.action,
      lifecycle: params.lifecycle,
      evaluatedCandidates: params.poolSize,
      partial: params.results.length < this.config.maxResults,
      exhaustedPool: params.exhaustedPool,
      tierCounts,
      discoveryUnitsUsed: params.discoveryUnitsUsed,
      relaxedFilters: params.relaxedFilters,
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
      /*
       * El explicador habla de los RESULTADOS, no del estado del pipeline:
       * PARTIAL/EXHAUSTED son notices internos (la guía del usuario es el
       * mensaje de anónimos del frontend), y si llegan al LLM los redacta.
       */
      notices: [...params.notices].filter(
        (notice) =>
          notice !== "PARTIAL_RESULTS" && notice !== "SEARCH_EXHAUSTED",
      ),
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

const EMPTY_INTENT: GameSearchIntent = {
  gameReferenced: null,
  objective: null,
  keywords: null,
  releaseYear: null,
  yearFrom: null,
  yearTo: null,
  excluded: null,
  relation: null,
  semantic: null,
};

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
      intent.objective.themes,
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
    !hasReferences && !hasKeywords && !hasObjective && !hasYear && !hasSemantic
  );
}

/*
 * ¿El refine es un no-op? Dos intents son el mismo si coinciden en todo
 * menos en `relation`: listas como conjuntos (orden-insensible, null ≡ []),
 * años y semánticas valor a valor (undefined ≡ null).
 */
export function isSameIntent(
  a: GameSearchIntent,
  b: GameSearchIntent,
): boolean {
  const sameList = (
    x: readonly string[] | null | undefined,
    y: readonly string[] | null | undefined,
  ): boolean => {
    const xs = [...(x ?? [])].sort();
    const ys = [...(y ?? [])].sort();
    return xs.length === ys.length && xs.every((v, i) => v === ys[i]);
  };
  const sameObjective = (
    x: GameSearchIntent["objective"],
    y: GameSearchIntent["objective"],
  ): boolean => {
    // null ≡ objeto con todo vacío.
    return (
      sameList(x?.genres, y?.genres) &&
      sameList(x?.themes, y?.themes) &&
      sameList(x?.platforms, y?.platforms) &&
      sameList(x?.gameModes, y?.gameModes) &&
      sameList(x?.perspectives, y?.perspectives)
    );
  };
  const sameExcluded = (
    x: GameSearchIntent["excluded"],
    y: GameSearchIntent["excluded"],
  ): boolean => {
    // null ≡ objeto con todo vacío (applyRefineDelta siempre construye el
    // objeto, la extracción fresca suele dejar null).
    return (
      sameList(x?.keywords, y?.keywords) &&
      sameList(x?.genres, y?.genres) &&
      sameList(x?.themes, y?.themes) &&
      sameList(x?.platforms, y?.platforms) &&
      sameList(x?.gameModes, y?.gameModes) &&
      sameList(x?.perspectives, y?.perspectives) &&
      (x?.releaseYear ?? null) === (y?.releaseYear ?? null) &&
      (x?.yearFrom ?? null) === (y?.yearFrom ?? null) &&
      (x?.yearTo ?? null) === (y?.yearTo ?? null)
    );
  };
  return (
    sameList(a.gameReferenced, b.gameReferenced) &&
    sameObjective(a.objective, b.objective) &&
    sameList(a.keywords, b.keywords) &&
    (a.releaseYear ?? null) === (b.releaseYear ?? null) &&
    (a.yearFrom ?? null) === (b.yearFrom ?? null) &&
    (a.yearTo ?? null) === (b.yearTo ?? null) &&
    sameExcluded(a.excluded, b.excluded) &&
    SEMANTIC_FIELDS.every(
      (field) =>
        (a.semantic?.[field] ?? null) === (b.semantic?.[field] ?? null),
    )
  );
}

/*
 * Un delta está vacío cuando no añade, no quita y no excluye nada.
 * Esto indica que el usuario pide "más resultados" sin cambiar criterios:
 * el orquestador lo trata como "more" (excluye los ya mostrados).
 */
function isDeltaEmpty(delta: RefineDelta): boolean {
  if (!delta) return true;
  const add = delta.add;
  const remove = delta.remove;
  const excluded = delta.excluded;

  const addEmpty =
    !add ||
    ([
      add.keywords,
      add.genres,
      add.themes,
      add.platforms,
      add.gameModes,
      add.perspectives,
      add.gameReferenced,
    ].every((f) => !f || f.length === 0) &&
      add.releaseYear == null &&
      add.yearFrom == null &&
      add.yearTo == null &&
      (!add.semantic ||
        SEMANTIC_FIELDS.every((field) => add.semantic?.[field] == null)));

  const removeEmpty =
    !remove ||
    ([
      remove.keywords,
      remove.genres,
      remove.themes,
      remove.platforms,
      remove.gameModes,
      remove.perspectives,
      remove.gameReferenced,
    ].every((f) => !f || f.length === 0) &&
      remove.releaseYear == null &&
      remove.yearFrom == null &&
      remove.yearTo == null &&
      (!remove.semantic || remove.semantic.length === 0));

  const excludedEmpty =
    !excluded ||
    ([
      excluded.keywords,
      excluded.genres,
      excluded.themes,
      excluded.platforms,
      excluded.gameModes,
      excluded.perspectives,
    ].every((f) => !f || f.length === 0) &&
      excluded.releaseYear == null &&
      excluded.yearFrom == null &&
      excluded.yearTo == null);

  return addEmpty && removeEmpty && excludedEmpty;
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
    themes: [...game.themes],
    platforms: [...game.platforms],
    gameModes: [...game.gameModes],
    perspectives: [...game.perspectives],
    description_es: game.description_es,
    description_en: game.description_en,
    keywords: [...game.keywords],
  };
}
