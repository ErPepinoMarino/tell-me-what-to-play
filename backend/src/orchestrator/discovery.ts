import { concludeGameToPersist, mapToCandidate } from "../igdb/mappers.js";
import { shouldSkipNonIndependentGame } from "../igdb/gameType.js";
import {
  genreIgbNames,
  platformIgbNames,
  perspectiveIgbNames,
  themeIgbId,
} from "../igdb/normalizers.js";
import type { IgdbClient, FilteredSearchOptions, IgdbGameRaw } from "../igdb/types.js";
import type { Candidate, Game } from "../types/Game.js";
import type { GameSearchIntent } from "../types/GameSearchIntent.js";
import type { EnrichmentEditable } from "../types/GameEnrichment.js";
import type { SearchKeyword } from "../types/keywords.js";
import { hardFilterViolations, passesHardFilters } from "../matching/matchGame.js";
import { KEYWORD_STOPWORDS, mintSearchKeywords } from "../matching/keywords.js";
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
import { createTrace, type Trace } from "../lib/logger.js";
import type { CatalogLayer, ReEnrichPatch } from "./types.js";
import type { DiscoveryCacheRepository } from "./discoveryCache.js";
import type { QueryOffsetStore } from "./queryOffsetStore.js";

export type DiscoveryAttemptOutcome = "ok" | "budget-exhausted" | "error";

// Enum TMWTP -> nombre IGDB de game_mode (resolución por nombre en el
// cliente). COMPETITIVE no existe en IGDB -> null (cae con trace).
const GAME_MODE_IGB_NAMES: Record<string, string | null> = {
  SINGLE_PLAYER: "Single player",
  MULTIPLAYER: "Multiplayer",
  COOPERATIVE: "Co-operative",
  COMPETITIVE: null,
  MASSIVELY_MULTIPLAYER: "Massively Multiplayer Online (MMO)",
  UNKNOWN: null,
};

export interface DiscoveryAttempt {
  outcome: DiscoveryAttemptOutcome;
  newGames: Game[];
  // La unidad se cortó por presupuesto tras haber empezado bien
  budgetExhausted: boolean;
  // La query no tiene más candidatos sin procesar: el orquestador puede
  // avanzar a la siguiente variante sin contar unidad ni gastar.
  variantExhausted: boolean;
  // Enrichments que fallaron (p. ej. Brave 402): para que el orquestador
  // pueda avisar al usuario de que el descubrimiento está degradado.
  enrichmentErrors: number;
}

// Progreso ficha a ficha para streaming: cada juego creado, con el intent
// que lo filtró (el relajado vigente en cascada). El orquestador re-rankea
// y emite snapshot sin esperar a la tanda.
export type DiscoveryProgress = (
  newGames: Game[],
  filterIntent: GameSearchIntent | undefined,
) => void;

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

/*
 * Contexto de búsqueda EFÍMERO de UNA ejecución de discovery: los términos
 * (canonicalizados) de la query que encontró el juego, usados SOLO como
 * overlay de la vista MatchableGame del pre-filtro y del matcher. NUNCA
 * llegan al candidato persistido: las keywords de la BDD solo contienen
 * vocabulario IGDB (invariante de tipos Game.keywords: IgdbKeyword[]).
 * Son SearchKeyword: vocabulario de búsqueda, no asignable a IgdbKeyword[].
 */
export interface SearchContext {
  hints: readonly SearchKeyword[];
}

/*
 * Tope de raws acumulados por lista (query+intent) — tanto la paginación
 * intrarun como el cursor cross-request (QueryOffsetStore) la comparten.
 *
 * ¿Por qué 300? IGDB solo documenta el máximo por REQUEST (limit ≤ 500) y
 * no fija techo para offset (el motor legado dejaba de paginar ~10.000
 * filas por offset; más allá exige scroll). Aquí no buscamos hecho
 * científico, sino nuestra regla "hacemos cuanto sea razonable, pero no
 * garantizamos encontrar resultados": 300 candidatos = 10 páginas de
 * igdbSearchLimit (30) ≈ 3,3% del presupuesto IGDB diario gastado en UNA
 * (query, intent) concreta. El orden por valoración comunitaria pone lo
 * mejor al principio; lo que asoma al final de la cola son títulos de
 * larga cola con señal mínima (isLowQualityRaw los cribaría igualmente).
 * Más profundo que esto es insistir.
 */
export const MAX_IGDB_LIST_RESULTS = 300;

// Grupos de requisitos, del primero al último en soltarse en la criba
// relajada: lo circunstancial (años, cámara, plataforma) antes que la
// esencia (temática). Los red flags (excluded) NO se sueltan nunca.
export type RelaxGroup =
  | "years"
  | "perspectives"
  | "platforms"
  | "gameModes"
  | "themes"
  | "genres"
  | "keywords";

export const RELAX_ORDER: RelaxGroup[] = [
  "years",
  "perspectives",
  "platforms",
  "gameModes",
  "themes",
  "genres",
  "keywords",
];

// Suelta un grupo de requisitos del intent (copia; el original intacto).
export function dropRelaxGroup(
  intent: GameSearchIntent,
  group: RelaxGroup,
): GameSearchIntent {
  switch (group) {
    case "years":
      return { ...intent, releaseYear: null, yearFrom: null, yearTo: null };
    case "keywords":
      return { ...intent, keywords: null };
    default:
      return {
        ...intent,
        objective: intent.objective
          ? { ...intent.objective, [group]: null }
          : intent.objective,
      };
  }
}

// ¿Queda alguna señal objetiva? La cascada nunca suelta el último grupo:
// sin nada que buscar no hay rescate.
function hasObjectiveSignal(intent: GameSearchIntent): boolean {
  return (
    (intent.keywords ?? []).length > 0 ||
    intent.releaseYear != null ||
    intent.yearFrom != null ||
    intent.yearTo != null ||
    (intent.objective?.genres ?? []).length > 0 ||
    (intent.objective?.themes ?? []).length > 0 ||
    (intent.objective?.platforms ?? []).length > 0 ||
    (intent.objective?.gameModes ?? []).length > 0 ||
    (intent.objective?.perspectives ?? []).length > 0
  );
}

// ¿Constriñe este grupo? Soltar un grupo vacío solo ensuciaría el aviso.
function relaxGroupHasSignal(
  intent: GameSearchIntent,
  group: RelaxGroup,
): boolean {
  switch (group) {
    case "years":
      return (
        intent.releaseYear != null ||
        intent.yearFrom != null ||
        intent.yearTo != null
      );
    case "keywords":
      return (intent.keywords ?? []).length > 0;
    case "genres":
      return (intent.objective?.genres ?? []).length > 0;
    case "themes":
      return (intent.objective?.themes ?? []).length > 0;
    case "platforms":
      return (intent.objective?.platforms ?? []).length > 0;
    case "gameModes":
      return (intent.objective?.gameModes ?? []).length > 0;
    case "perspectives":
      return (intent.objective?.perspectives ?? []).length > 0;
  }
}

export interface RelaxedAttempt {
  outcome: DiscoveryAttemptOutcome;
  newGames: Game[];
  // Intent efectivo (el que filtró a los creados): para rankear y responder.
  relaxedIntent: GameSearchIntent;
  // Grupos soltados hasta crear el ÚLTIMO juego (orden de soltado).
  droppedGroups: RelaxGroup[];
  budgetExhausted: boolean;
  enrichmentErrors: number;
}

/*
 * Estado de UNA ejecución de descubrimiento (la petición que atiende
 * handle()): la última búsqueda IGDB y por dónde va su consumo. Una query
 * suele devolver ~10 candidatos y cada unidad solo enriquece 2. En lugar de
 * repetir la llamada (mismos resultados) o rendirnos al agotar las
 * variantes, las unidades siguientes CONSUMEN la lista guardada sin gastar
 * IGDB. La lista se clavea por (query, intent): la devuelta depende del
 * `where` (filtros del intent), así que un intent estricto que agota la
 * suya no bloquea el refetch de otro más laxo con el mismo texto.
 *
 * Vive en el contexto de la ejecución, NO en el gestor: dos peticiones
 * concurrentes tienen cada una la suya y no pueden entrelazarse el cursor
 * ni pisarse la lista a través de un `await`.
 */
export interface DiscoveryRun {
  // Query e intent de la lista en curso (null = aún no hay lista).
  query: string | null;
  intentKey: string | null;
  // Raws de IGDB de la lista en curso (consumidos y pendientes).
  raws: IgdbGameRaw[];
  // Cuántos raws de la lista se han consumido ya en esta ejecución.
  cursor: number;
  // Paginación de la lista: offset de la PRÓXIMA página a pedir (avanza con
  // el tamaño real de cada página; los raws deduplicados no mueven la
  // posición). Arranca en 0 o, si la lista se retomó del store cross-request,
  // en el offset donde la dejó la petición anterior.
  offset: number;
  limit: number;
}

export function createDiscoveryRun(): DiscoveryRun {
  return {
    query: null,
    intentKey: null,
    raws: [],
    cursor: 0,
    offset: 0,
    limit: 0,
  };
}

/*
 * Clave estable de los campos del intent que determinan el `where` de
 * filteredSearch (null cuando no hay intent: text-search clásico).
 */
export function intentFilterKey(intent?: GameSearchIntent): string | null {
  if (!intent) return null;
  return JSON.stringify({
    keywords: intent.keywords ?? null,
    genres: intent.objective?.genres ?? null,
    themes: intent.objective?.themes ?? null,
    platforms: intent.objective?.platforms ?? null,
    gameModes: intent.objective?.gameModes ?? null,
    perspectives: intent.objective?.perspectives ?? null,
    releaseYear: intent.releaseYear ?? null,
    yearFrom: intent.yearFrom ?? null,
    yearTo: intent.yearTo ?? null,
    excluded: intent.excluded ?? null,
  });
}

/*
 * Clave del QueryOffsetStore: la MISMA (query normalizada, intent) que
 * clavea la lista en DiscoveryRun — el `where` de IGDB (y por tanto su
 * contenido) depende de ambos. Normalizada para que "Pirates" y "pirates"
 * compartan cursor; el intent identifica la lista incluso si el texto se
 * repite con filtros distintos.
 */
export function queryOffsetKey(
  normalizedQuery: string,
  intentKey: string | null,
): string {
  return `${normalizedQuery}::${intentKey ?? "no-intent"}`;
}

export class DiscoveryManager {
  constructor(
    private igdb: IgdbClient,
    private enrichment: EnrichmentService & Partial<EnrichmentUpdater>,
    private catalog: CatalogLayer,
    // Pool global de raws descubiertos y reutilizables entre peticiones.
    private cache: DiscoveryCacheRepository,
    // Cursor de paginación IGDB por (query, intent): en qué offset retomar
    // una búsqueda que reaparece en otra petición sin candidatos. Estado
    // separado del pool: aquí cero contenido, solo posición.
    private queryOffsets: QueryOffsetStore,
    private budget: BudgetLedger,
    private config: RecommendationConfig = RECOMMENDATION_CONFIG,
    // Opcional (FASE 4): canonicalización + resolución canónico → id IGDB
    // contra el diccionario local (el descubrimiento NO consulta /v4/keywords).
    private lexicon?: {
      canonicalizeTerms(terms: string[]): Promise<string[]>;
      resolveIds(terms: string[]): Promise<Map<string, number | null>>;
    },
  ) {}

  /*
   * Términos de la query que actúa como pista de contexto (pre-filtro y
   * matcher): la query que ENCONTRÓ el juego en IGDB es evidencia real de
   * temática. Se canonicalizan para que el matching vea el vocabulario
   * canónico ("infectados" → "zombies"). Viven en SearchContext: efímeros,
   * jamás se persisten.
   */
  private async buildSearchHints(query: string): Promise<readonly SearchKeyword[]> {
    const normalizedQuery = query.trim().toLowerCase();
    const queryWords = normalizedQuery
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !KEYWORD_STOPWORDS.has(word));
    const terms = this.lexicon
      ? await this.lexicon.canonicalizeTerms(
          normalizedQuery.length > 0 ? [normalizedQuery, ...queryWords] : [],
        )
      : normalizedQuery.length > 0
        ? [normalizedQuery, ...queryWords]
        : [];
    return mintSearchKeywords(terms);
  }

  // Canónicos → IDs numéricos de IGDB desde el léxico local (keyword_lexicon.
  // igdb_id). Sin léxico (tests) no hay IDs locales → sin filtro de keywords
  // en el where de IGDB.
  private async resolveKeywordIds(terms: string[]): Promise<number[]> {
    if (terms.length === 0) return [];
    if (!this.lexicon) return [];
    const ids = await this.lexicon.resolveIds(terms);
    return terms
      .map((term) => ids.get(term.trim().toLowerCase()))
      .filter((id): id is number => id !== null && id !== undefined);
  }

  /*
   * Descubrimiento FILTRADO: la consulta a IGDB pasa a `where` por atributos
   * combinando TODA la información del intent — keywords (IDs del léxico),
   * themes (mapa fijo), géneros/plataformas/modos/perspectivas (por nombre) y
   * años (exacto + rangos), y NEGANDO los red flags — ordenada por valoración
   * de la comunidad. Sin intent, text-search como antes.
   */
  private async filteredSearch(
    intent: GameSearchIntent,
    trace?: Trace | null,
    offset = 0,
  ): Promise<IgdbGameRaw[]> {
    const keywordIds = await this.resolveKeywordIds(intent.keywords ?? []);
    const themeIds = (intent.objective?.themes ?? [])
      .map((theme) => themeIgbId(theme))
      .filter((id): id is number => id !== null);
    const excludeKeywordIds = await this.resolveKeywordIds(
      intent.excluded?.keywords ?? [],
    );
    const excludeThemeIds = (intent.excluded?.themes ?? [])
      .map((theme) => themeIgbId(theme))
      .filter((id): id is number => id !== null);

    const options: FilteredSearchOptions = {
      keywordIds,
      genreIgbNames: (intent.objective?.genres ?? [])
        .filter((genre) => genre !== "UNKNOWN")
        .flatMap((genre) => genreIgbNames(genre)),
      themeIds,
      perspectiveIgbNames: (intent.objective?.perspectives ?? [])
        .filter((perspective) => perspective !== "UNKNOWN")
        .flatMap((perspective) => perspectiveIgbNames(perspective)),
      gameModeIgbNames: (intent.objective?.gameModes ?? [])
        .filter((mode) => mode !== "UNKNOWN")
        .map((mode) => GAME_MODE_IGB_NAMES[mode])
        .filter((name): name is string => name !== null),
      platformIgbNames: (intent.objective?.platforms ?? [])
        .filter((platform) => platform !== "UNKNOWN")
        .flatMap((platform) => platformIgbNames(platform)),
      releaseYear: intent.releaseYear ?? undefined,
      yearFrom: intent.yearFrom ?? undefined,
      yearTo: intent.yearTo ?? undefined,
      excludeKeywordIds,
      excludeThemeIds,
      excludeGenreIgbNames: (intent.excluded?.genres ?? [])
        .filter((genre) => genre !== "UNKNOWN")
        .flatMap((genre) => genreIgbNames(genre)),
      excludePlatformIgbNames: (intent.excluded?.platforms ?? [])
        .filter((platform) => platform !== "UNKNOWN")
        .flatMap((platform) => platformIgbNames(platform)),
      excludePerspectiveIgbNames: (intent.excluded?.perspectives ?? [])
        .filter((perspective) => perspective !== "UNKNOWN")
        .flatMap((perspective) => perspectiveIgbNames(perspective)),
      limit: this.config.igdbSearchLimit,
      // Offset solo en páginas >0: la primera página no cambia.
      ...(offset > 0 ? { offset } : {}),
      /*
       * Visibilidad de los drops de taxonomía: un término que no resuelve a
       * ID de IGDB se deja fuera del where — nunca en silencio (decisión
       * tras el bug del género ACTION, que caía sin traza).
       */
      onFilterDropped: (details) => {
        trace?.("taxonomy-unresolved", details);
      },
    };

    // LOG: ver qué opciones se pasan a IGDB
    console.log(`[DISCOVERY-FILTERED] genres=${JSON.stringify(options.genreIgbNames)} themes=${JSON.stringify(options.themeIds)} keywords=${JSON.stringify(options.keywordIds)} platforms=${JSON.stringify(options.platformIgbNames)} perspectives=${JSON.stringify(options.perspectiveIgbNames)} gameModes=${JSON.stringify(options.gameModeIgbNames)} year=${options.releaseYear ?? `${options.yearFrom}-${options.yearTo}`}`);

    return this.igdb.filteredSearch(options);
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
    traceId: string | undefined,
    intent: GameSearchIntent | undefined,
    anchors: Game[],
    onProgress: DiscoveryProgress | undefined,
    run: DiscoveryRun,
  ): Promise<DiscoveryAttempt> {
    const trace = traceId ? createTrace(traceId) : null;

    /*
     * Pistas efímeras de la query para el pre-filtro (SearchContext): afectan
     * la VISTA MatchableGame, nunca las keywords persistidas del candidato.
     */
    const normalizedQuery = query.trim().toLowerCase();
    const hints = await this.buildSearchHints(query);
    const context: SearchContext = { hints };
    const intentKey = intentFilterKey(intent);
    const queryKey = queryOffsetKey(normalizedQuery, intentKey);
    const sameQuery =
      run.query === query && run.intentKey === intentKey;
    if (sameQuery && run.cursor >= run.raws.length) {
      /*
       * Paginación intrarun: la misma pregunta agotada pide la página
       * siguiente (hasta MAX_IGDB_LIST_RESULTS en total por lista) en vez de
       * rendirse para siempre — "buscar más" debe poder traer títulos nuevos
       * de IGDB. La profundidad se comparte con el store cross-request: un
       * run nuevo retoma donde el store diga. Sin presupuesto para la página,
       * agotado sin ruido (no es un error de descubrimiento, es fin de lista
       * por hoy).
       */
      const nextOffset = run.offset;
      const canPage =
        intent !== undefined &&
        run.raws.length >= run.limit &&
        nextOffset < MAX_IGDB_LIST_RESULTS &&
        this.budget.tryReserve("igdb", 1);
      if (!canPage) {
        trace?.("igdb-list-exhausted", { query, offset: nextOffset });
        return {
          outcome: "ok",
          newGames: [],
          budgetExhausted: false,
          variantExhausted: true,
          enrichmentErrors: 0,
        };
      }
      let page: IgdbGameRaw[];
      try {
        page = await withTimeout(
          this.filteredSearch(intent, trace, nextOffset),
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
          enrichmentErrors: 0,
        };
      }
      this.budget.commit("igdb", 1);
      if (page.length === 0) {
        trace?.("igdb-list-exhausted", { query, offset: nextOffset });
        return {
          outcome: "ok",
          newGames: [],
          budgetExhausted: false,
          variantExhausted: true,
          enrichmentErrors: 0,
        };
      }
      /*
       * El offset avanza por el tamaño REAL de la página pedida: IGDB pagina
       * por posición, así que aunque desdupliquemos solapamientos (el orden
       * de un search por similitud no se garantiza estable entre páginas) la
       * posición de la lista sigue avanzando sin atascarse.
       */
      run.offset = nextOffset + page.length;
      const seenIds = new Set(run.raws.map((raw) => raw.id));
      run.raws = [
        ...run.raws,
        ...page.filter((raw) => !seenIds.has(raw.id)),
      ];
      await this.queryOffsets.setNextOffset(
        queryKey,
        Math.min(run.offset, MAX_IGDB_LIST_RESULTS),
      );
      await this.cache.addMany(page);
      trace?.("igdb-list-next-page", {
        query,
        offset: nextOffset,
        results: page.length,
      });
      // Se sigue al procesado normal: el cursor continúa en la página nueva.
    }

    if (!sameQuery) {
      /*
       * Pool-first: antes de gastar una llamada IGDB, escaneamos el pool
       * global de raws descubiertos por peticiones anteriores. Los raws
       * compatibles (pasan las puertas duras del intent si hay uno y no son
       * DLC/baja calidad) se reutilizan directamente sin costo.
       */
      const poolRaws = await this.cache.readAll();
      const poolCompatibles: IgdbGameRaw[] = [];
      for (const poolRaw of poolRaws) {
        if (shouldSkipNonIndependentGame(poolRaw)) continue;
        if (this.isLowQualityRaw(poolRaw)) continue;
        if (!intent) {
          poolCompatibles.push(poolRaw);
          continue;
        }
        const poolCandidate = mapToCandidate(poolRaw);
        if (
          passesHardFilters(
            intent,
            matchableView(poolCandidate, context),
            { semanticGates: false, anchors },
          )
        ) {
          poolCompatibles.push(poolRaw);
        }
      }

      if (poolCompatibles.length > 0) {
        run.query = query;
        run.intentKey = intentKey;
        run.raws = poolCompatibles;
        run.cursor = 0;
        run.offset = 0;
        // Sentinel: raws.length < limit impide que el branch de paginación
        // dispare incoherentemente sobre listas reconstruidas del pool.
        run.limit = poolCompatibles.length + 1;
        trace?.("pool-reuse", { query, results: poolCompatibles.length });
      } else {
        /*
         * Paginación cross-request: si esta (query, intent) ya se pidió sin
         * nada compatible, retomamos la lista por donde se quedó en lugar de
         * repetir la página 0. El cursor lo lleva QueryOffsetStore (solo la
         * posición: ni contenido ni historial); el pool global sigue siendo
         * la única memoria de raws. La búsqueda de texto sin intent no
         * pagina, así que ahí el offset es siempre 0.
         */
        const nextOffset = intent
          ? await this.queryOffsets.getNextOffset(queryKey)
          : 0;
        if (intent && nextOffset >= MAX_IGDB_LIST_RESULTS) {
          // Límite alcanzado en peticiones anteriores: agotado sin reservar
          // ni gastar — no se insiste en un nicho ya barrido.
          trace?.("igdb-list-exhausted", { query, offset: nextOffset });
          return {
            outcome: "ok",
            newGames: [],
            budgetExhausted: false,
            variantExhausted: true,
            enrichmentErrors: 0,
          };
        }
        if (!this.budget.tryReserve("igdb", 1)) {
          return {
            outcome: "budget-exhausted",
            newGames: [],
            budgetExhausted: true,
            variantExhausted: false,
            enrichmentErrors: 0,
          };
        }

        let raws: IgdbGameRaw[];
        try {
          raws = await withTimeout(
            intent
              ? this.filteredSearch(intent, trace, nextOffset)
              : this.igdb.searchGames(
                  query,
                  this.config.igdbSearchLimit,
                ),
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
            enrichmentErrors: 0,
          };
        }
        this.budget.commit("igdb", 1);
        if (raws.length > 0) {
          await this.cache.addMany(raws);
          if (intent) {
            // Solo se avanza con páginas no vacías (igual que "las listas
            // vacías no se cachean como agotadas"): una falla transitoria o
            // un nicho aún sin resultados no clava el cursor.
            await this.queryOffsets.setNextOffset(
              queryKey,
              Math.min(nextOffset + raws.length, MAX_IGDB_LIST_RESULTS),
            );
          }
        }
        /*
         * Una lista VACÍA no se cachea como cursor agotado: la query volvería
         * a "agotada" para siempre sin reintentar (falla transitoria de IGDB
         * o búsqueda sin resultados todavía). Solo las listas con resultados
         * son reutilizables entre unidades.
         */
        run.query = raws.length > 0 ? query : null;
        run.intentKey = raws.length > 0 ? intentKey : null;
        run.raws = raws;
        run.cursor = 0;
        // Base posicional de la lista: si se retomó de un store con offset,
        // la siguiente página dentro de esta ejecución sigue en ese offset.
        run.offset = raws.length > 0 ? nextOffset + raws.length : 0;
        run.limit = this.config.igdbSearchLimit;
        if (intent) {
          // Traza de la consulta filtrada: qué atributos fueron al `where`.
          trace?.("igdb-filtered", {
            query,
            keywords: intent.keywords ?? null,
            genres: intent.objective?.genres ?? null,
            themes: intent.objective?.themes ?? null,
            gameModes: intent.objective?.gameModes ?? null,
            platforms: intent.objective?.platforms ?? null,
            perspectives: intent.objective?.perspectives ?? null,
            releaseYear: intent.releaseYear,
            yearFrom: intent.yearFrom,
            yearTo: intent.yearTo,
            results: raws.length,
          });
        }
        trace?.("igdb-search", { query, results: raws.length });
      }
    } else {
      trace?.("igdb-list-reuse", {
        query,
        remaining: run.raws.length - run.cursor,
      });
    }

    const newGames: Game[] = [];
    let budgetExhausted = false;
    let enrichmentErrors = 0;

    while (run.cursor < run.raws.length && newGames.length < maxNew) {
      const raw = run.raws[run.cursor];
      run.cursor++;
      if (shouldSkipNonIndependentGame(raw)) continue;
      if (this.isLowQualityRaw(raw)) continue;

      const candidate = mapToCandidate(raw);

      /*
       * Pre-filtro must: el candidato se evalúa con su vista MatchableGame
       * (keywords IGDB + pistas de la query como overlay EFÍMERO). Si falla
       * los filtros duros del intent, está condenado a invalid — no merece
       * existsInCatalog ni Brave/LLM. Trade-off asumido: no se almacena; si
       * encaja en búsquedas futuras cuyo intent lo admita, se redescubrirá
       * entonces con las keywords correctas. Los GATES SEMÁNTICOS se omiten
       * aquí: el candidato aún no tiene semánticas (las escribirá el
       * enrichment) — se re-evalúa después.
       */
      if (
        intent &&
        !passesHardFilters(
          intent,
          matchableView(candidate, context),
          { semanticGates: false, anchors },
        )
      ) {
        trace?.("discovery-skip-must", {
          slug: candidate.slug,
          query,
          ...hardFilterViolations(
            intent,
            matchableView(candidate, context),
          ),
        });
        continue;
      }

      if (await this.existsInCatalog(candidate.sourceId, candidate.slug)) {
        // El raw ya está en PostgreSQL: se retira del pool para no volver a
        // evaluarlo en futuras peticiones.
        await this.cache.remove(candidate.sourceId);
        continue;
      }

      if (!this.reserveEnrichmentBudget()) {
        // La ficha no se procesó: vuelve a la lista para la siguiente unidad.
        run.cursor--;
        budgetExhausted = true;
        break;
      }

        try {
          const result = await withTimeout(
            this.enrichment.enrich(candidate),
            this.config.unitTimeoutMs,
            "enrichment",
          );
          this.commitEnrichmentBudget();
          // La ficha se concluye SOLO con lo que el campo editable expone;
          // las keywords salen intactas del candidate (vocabulario IGDB).
          const enriched = concludeGameToPersist(candidate, result.editable);
          /*
           * NOTA de diseño: la ficha enriquecida se ALMACENA SIEMPRE que
           * aporta valor (enrichmentAddsValue) aunque falle los gates
           * semánticos de ESTE intent — el coste del enrichment ya está
           * hundido y la ficha con semánticas reales es un activo para
           * búsquedas futuras. Los gates deciden qué se MUESTRA (el re-rank
           * con el pool actualizado la excluye de esta respuesta), no qué
           * se guarda.
           */
        /*
         * Garantía de calidad del catálogo: si el enrichment no aporta
         * NINGUNA semántica conocida NI keywords adicionales, la ficha es
         * inservible para el matching (todo null = no comparable) y solo
         * ensucia la BDD. Se gasta el Brave (ya consumido) pero NO se
         * persiste.
         */
        if (
          !enrichmentAddsValue(result.editable, result.additionalKeywords)
        ) {
          trace?.("discovery-skip-empty", { slug: candidate.slug });
          continue;
        }
        newGames.push(await this.catalog.createIgdb(enriched));
        // Promoción completada: el raw ya tiene dueño en PostgreSQL, sale
        // del pool (regla de borrado: solo tras existe-en-PG o promoción).
        await this.cache.remove(candidate.sourceId);
        onProgress?.([...newGames], intent);
      } catch (error) {
        // El intento pudo haber consumido llamadas de Brave a mitad: se
        // contabilizan igual (pesimista) y se sigue con el siguiente raw.
        // Trazable: sin esto, un 402 de Brave fallaba en silencio.
        trace?.("enrichment-error", {
          slug: candidate.slug,
          query,
          error: error instanceof Error ? error.message : String(error),
        });
        enrichmentErrors++;
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
      variantExhausted: run.cursor >= run.raws.length,
      enrichmentErrors,
    };
  }

  /*
   * Rescate relajado (rama "more"): criba local en cascada — pasada 0 con
   * must completo, luego soltando un grupo por pasada (RELAX_ORDER) hasta
   * llenar maxNew o agotar grupos. Solo se enriquece a los ≤maxNew
   * supervivientes. Reutiliza raws del pool global (gratis); solo si no hay
   * raws compatibles hace UNA o DOS llamadas de pago (amplia + where
   * relajado).
   */
  async discoverRelaxed(
    query: string,
    maxNew: number,
    traceId: string | undefined,
    intent: GameSearchIntent,
    anchors: Game[] = [],
    onProgress?: DiscoveryProgress,
  ): Promise<RelaxedAttempt> {
    const trace = traceId ? createTrace(traceId) : null;
    const empty: RelaxedAttempt = {
      outcome: "ok",
      newGames: [],
      relaxedIntent: intent,
      droppedGroups: [],
      budgetExhausted: false,
      enrichmentErrors: 0,
    };
    if (maxNew <= 0) return empty;

    /*
     * Sin señal objetiva (p. ej. intent solo-semántico) no hay rescate:
     * la llamada amplia sin texto traería el top general y la pasada 0,
     * sin requisitos, lo crearía todo. Cero llamadas, cero ruido.
     */
    if (!hasObjectiveSignal(intent)) return empty;

    // Fases de fetch (tope: 2 llamadas de pago por rescate):
    //  1. reutilizar raws compatibles del pool global (gratis);
    //  2. amplia de texto (trae títulos que el where no ve);
    //  3. where relajado en el primer grupo con señal (trae lo que el
    //     estricto excluye por un filtro de más).
    // Un fallo de fase no tumba el rescate: se sigue con lo reunido (la
    // criba honesta dirá si basta). Sin ninguna llamada por presupuesto,
    // budget-exhausted como antes.
    const allRaws: IgdbGameRaw[] = [];
    const seenRawIds = new Set<number>();
    const collectUnique = (list: IgdbGameRaw[]): void => {
      for (const raw of list) {
        if (!seenRawIds.has(raw.id)) {
          seenRawIds.add(raw.id);
          allRaws.push(raw);
        }
      }
    };
    // Fase 1: raws del pool global (gratis). Las puertas baratas (no DLC, no
    // low-quality) y los filtros duros del intent las aplica la cascada de
    // criba; los raws que no pasen se descartan allí sin coste.
    const poolRaws = await this.cache.readAll();
    const poolCount = allRaws.length;
    collectUnique(poolRaws);
    if (allRaws.length > poolCount) {
      trace?.("pool-reuse-relaxed", {
        query,
        available: allRaws.length,
      });
    }

    // Margen de criba: con menos del doble de candidatos que huecos, ni
    // la criba tiene de dónde elegir ni compensan más llamadas. Una lista
    // rica (21 para 8 huecos) no gasta de más.
    const needRaws = maxNew * 2;
    let fetchedAny = false;
    let fetchBlockedByBudget = false;

    if (allRaws.length < needRaws) {
      if (this.budget.tryReserve("igdb", 1)) {
        try {
          const broad = await withTimeout(
            this.broadSearch(query, intent, trace),
            this.config.unitTimeoutMs,
            "IGDB broad search",
          );
          this.budget.commit("igdb", 1);
          fetchedAny = true;
          trace?.("igdb-broad", { query, results: broad.length });
          collectUnique(broad);
          await this.cache.addMany(broad);
        } catch {
          this.budget.release("igdb", 1);
          trace?.("igdb-phase-error", { phase: "broad", query });
        }
      } else {
        fetchBlockedByBudget = true;
      }
    }

    const firstGroup = RELAX_ORDER.find((group) =>
      relaxGroupHasSignal(intent, group),
    );
    if (firstGroup && allRaws.length < needRaws) {
      if (this.budget.tryReserve("igdb", 1)) {
        try {
          const relaxed = await withTimeout(
            this.filteredSearch(dropRelaxGroup(intent, firstGroup), trace),
            this.config.unitTimeoutMs,
            "IGDB relaxed search",
          );
          this.budget.commit("igdb", 1);
          fetchedAny = true;
          trace?.("igdb-relaxed-where", {
            query,
            droppedGroup: firstGroup,
            results: relaxed.length,
          });
          collectUnique(relaxed);
          await this.cache.addMany(relaxed);
        } catch {
          this.budget.release("igdb", 1);
          trace?.("igdb-phase-error", { phase: "relaxed-where", query });
        }
      } else {
        fetchBlockedByBudget = true;
      }
    }

    if (allRaws.length === 0 && fetchBlockedByBudget && !fetchedAny) {
      return { ...empty, outcome: "budget-exhausted", budgetExhausted: true };
    }
    const raws = allRaws;

    // Pistas de la query + gates baratos, una sola vez para todas las pasadas.
    const context: SearchContext = { hints: await this.buildSearchHints(query) };
    const candidates: Candidate[] = [];
    for (const raw of raws) {
      if (shouldSkipNonIndependentGame(raw)) continue;
      if (this.isLowQualityRaw(raw)) continue;
      candidates.push(mapToCandidate(raw));
    }

    const newGames: Game[] = [];
    const seen = new Set<string>();
    const dropped: RelaxGroup[] = [];
    let relaxed = intent;
    let lastCreationPass = -1;
    let effectiveRelaxed = intent;
    let budgetExhausted = false;
    let enrichmentErrors = 0;

    // Pasada 0 = must completo; pasada N suelta RELAX_ORDER[N-1].
    for (let pass = 0; pass <= RELAX_ORDER.length; pass++) {
      if (newGames.length >= maxNew) break;
      if (pass > 0) {
        const group = RELAX_ORDER[pass - 1]!;
        if (!relaxGroupHasSignal(relaxed, group)) continue;
        const candidate = dropRelaxGroup(relaxed, group);
        if (!hasObjectiveSignal(candidate)) break;
        relaxed = candidate;
        dropped.push(group);
        trace?.("relax-pass", { droppedGroup: group });
      }
      for (const candidate of candidates) {
        if (newGames.length >= maxNew) break;
        if (seen.has(candidate.slug)) continue;
        if (
          !passesHardFilters(
            relaxed,
            matchableView(candidate, context),
            { semanticGates: false, anchors },
          )
        ) {
          trace?.("discovery-skip-must", {
            slug: candidate.slug,
            query,
            pass,
            ...hardFilterViolations(
              relaxed,
              matchableView(candidate, context),
            ),
          });
          continue;
        }
        if (await this.existsInCatalog(candidate.sourceId, candidate.slug)) {
          seen.add(candidate.slug);
          await this.cache.remove(candidate.sourceId);
          continue;
        }
        if (!this.reserveEnrichmentBudget()) {
          budgetExhausted = true;
          break;
        }
        try {
          const result = await withTimeout(
            this.enrichment.enrich(candidate),
            this.config.unitTimeoutMs,
            "enrichment",
          );
          this.commitEnrichmentBudget();
          const enriched = concludeGameToPersist(candidate, result.editable);
          if (!enrichmentAddsValue(result.editable, result.additionalKeywords)) {
seen.add(candidate.slug);
            continue;
          }
          newGames.push(await this.catalog.createIgdb(enriched));
          await this.cache.remove(candidate.sourceId);
          lastCreationPass = pass;
          // El intent efectivo es el que filtraba cuando se creó el último
          // juego: lo anunciado (droppedGroups) y lo rankeado coinciden.
          effectiveRelaxed = relaxed;
          onProgress?.([...newGames], effectiveRelaxed);
        } catch (error) {
          trace?.("enrichment-error", {
            slug: candidate.slug,
            query,
            error: error instanceof Error ? error.message : String(error),
          });
          enrichmentErrors++;
          this.commitEnrichmentBudget();
        }
        seen.add(candidate.slug);
      }
      if (budgetExhausted) break;
    }

    // Grupos efectivamente soltados: solo hasta la pasada donde se creó el
    // ÚLTIMO juego (soltar sin crear no cuenta para el aviso).
    const effectiveDropped =
      lastCreationPass < 0 ? [] : dropped.slice(0, lastCreationPass);
    trace?.("discovery-relaxed", {
      query,
      created: newGames.map((game) => game.slug),
      droppedGroups: effectiveDropped,
      budgetExhausted,
    });

    return {
      outcome: "ok",
      newGames,
      relaxedIntent: effectiveRelaxed,
      droppedGroups: effectiveDropped,
      budgetExhausted,
      enrichmentErrors,
    };
  }

  /*
   * Llamada AMPLIA (último recurso, sin caché útil): coincide CUALQUIERA,
   * solo filtra lo prohibido (red flags). Texto = PRIMER keyword (un solo
   * término: la búsqueda por texto de IGDB con frases multi-término
   * devuelve vacío). Sin atributos en el `where`: la exigencia la pone
   * la criba local, no IGDB.
   */
  private async broadSearch(
    query: string,
    intent: GameSearchIntent,
    trace?: Trace | null,
  ): Promise<IgdbGameRaw[]> {
    const firstKeyword = (intent.keywords ?? [])
      .map((k) => k.trim())
      .find((k) => k.length > 0);
    const text =
      firstKeyword ?? (query.trim().length > 0 ? query.trim() : undefined);
    const excludeKeywordIds = await this.resolveKeywordIds(
      intent.excluded?.keywords ?? [],
    );
    const excludeThemeIds = (intent.excluded?.themes ?? [])
      .map((theme) => themeIgbId(theme))
      .filter((id): id is number => id !== null);

    const options: FilteredSearchOptions = {
      text,
      excludeKeywordIds,
      excludeThemeIds,
      excludeGenreIgbNames: (intent.excluded?.genres ?? [])
        .filter((genre) => genre !== "UNKNOWN")
        .flatMap((genre) => genreIgbNames(genre)),
      excludePlatformIgbNames: (intent.excluded?.platforms ?? [])
        .filter((platform) => platform !== "UNKNOWN")
        .flatMap((platform) => platformIgbNames(platform)),
      excludePerspectiveIgbNames: (intent.excluded?.perspectives ?? [])
        .filter((perspective) => perspective !== "UNKNOWN")
        .flatMap((perspective) => perspectiveIgbNames(perspective)),
      limit: this.config.igdbBroadSearchLimit,
      onFilterDropped: (details) => {
        trace?.("taxonomy-unresolved", details);
      },
    };

    return this.igdb.filteredSearch(options);
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
      const { editable } = await withTimeout(
        this.enrichment.enrich(candidate),
        this.config.unitTimeoutMs,
        "anchor enrichment",
      );
      this.commitEnrichmentBudget();
      const created = await this.catalog.createIgdb(
        concludeGameToPersist(candidate, editable),
      );
      trace?.("anchor-created", { slug: created.slug });
      return { status: "found", game: created };
    } catch (error) {
      this.commitEnrichmentBudget();
      trace?.("enrichment-error", {
        slug: candidate.slug,
        step: "anchor-enrichment",
        error: error instanceof Error ? error.message : String(error),
      });
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

      /*
       * PATCH sin keywords (ReEnrichPatch.keywords?: never): el re-enrichment
       * actualiza descripciones, semánticas y (para fichas sin identidad)
       * datos objetivos. Las keywords quedan INTACTAS byte a byte; refrescarlas
       * desde IGDB es una operación explícita de sincronización de catálogo.
       */
      const semantic = enrichment.semantic;
      const resolvedSemantic = Object.fromEntries(
        SEMANTIC_FIELDS.map((field) => [
          field,
          semantic[field] ?? game[field],
        ]),
      ) as ReEnrichPatch["semantic"];
      const patch: ReEnrichPatch = {
        // Objetivos: estables salvo en fichas sin identidad (seed), que se
        // rehabilitan con los datos canónicos de IGDB. Compañías: se rellenan
        // si faltan, nunca se degradan las conocidas.
        sourceId: adoptObjective ? candidate.sourceId : undefined,
        coverUrl: adoptObjective
          ? (candidate.coverUrl ?? game.coverUrl)
          : undefined,
        releaseYear: adoptObjective
          ? (candidate.releaseYear ?? game.releaseYear)
          : undefined,
        genres: adoptObjective ? candidate.genres : undefined,
        themes: adoptObjective ? candidate.themes : undefined,
        platforms: adoptObjective ? candidate.platforms : undefined,
        gameModes: adoptObjective ? candidate.gameModes : undefined,
        perspectives: adoptObjective ? candidate.perspectives : undefined,
        developers:
          game.developers.length > 0 ? undefined : candidate.developers,
        publishers:
          game.publishers.length > 0 ? undefined : candidate.publishers,
        semantic: resolvedSemantic,
        description_es: enrichment.description_es || game.description_es,
        description_en: enrichment.description_en || game.description_en,
      };

      const updatedGame = await this.catalog.updateReEnrich(game, patch);
      trace?.("re-enrich-updated", {
        slug: updatedGame.slug,
        knownSemantics: knownSemanticsCount(updatedGame),
      });
      return { status: "updated", game: updatedGame };
    } catch (error) {
      this.commitEnrichmentBudget();
      trace?.("enrichment-error", {
        slug: game.slug,
        step: "re-enrichment",
        error: error instanceof Error ? error.message : String(error),
      });
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
    themes: candidate.themes,
    platforms: candidate.platforms,
    gameModes: candidate.gameModes,
    perspectives: candidate.perspectives,
    keywords: candidate.keywords,
    ...nulls,
  };
}

/*
 * Overlay EFÍMERO de las pistas de la query sobre la vista MatchableGame:
 * el pre-filtro y el matcher siguen viendo los términos que encontraron el
 * juego, pero ESAS pistas jamás entran a las keywords persistidas del
 * candidato. Contexto de UNA ejecución: no hay memoria entre peticiones.
 */
function matchableView(
  candidate: Candidate,
  context: SearchContext,
): MatchableGame {
  const matchable = candidateAsMatchable(candidate);
  if (context.hints.length === 0) return matchable;
  return {
    ...matchable,
    keywords: mergeKeywords(matchable.keywords, context.hints),
  };
}

/*
 * ¿Aporta algo el enrichment? Garantía de calidad del catálogo: una ficha
 * sin NINGUNA semántica conocida y sin keywords adicionales detectadas no
 * matchea nunca (todo null = no comparable) y solo ensucia la BDD. Las
 * keywords adicionales solo señalizan valor: NO se persisten.
 */
function enrichmentAddsValue(
  editable: EnrichmentEditable,
  additionalKeywords: readonly SearchKeyword[],
): boolean {
  const hasSemantics = SEMANTIC_FIELDS.some(
    (field) => editable.semantic[field] !== null,
  );
  const hasAdditionalKeywords = additionalKeywords.some(
    (term) => term.trim().length > 0,
  );
  return hasSemantics || hasAdditionalKeywords;
}
