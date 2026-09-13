/*
 * DiscoveryQueryBuilder: traduce los criterios de búsqueda internos
 * (GameSearchIntent) a la consulta que necesita IGDB y la ejecuta.
 *
 *   GameSearchIntent → DiscoveryQueryBuilder → IGDB query (filteredSearch)
 *
 * Única responsabilidad: construcción y ejecución de la búsqueda IGDB —
 * `where` por atributos (keywords→IDs, themes→IDs, géneros/plataformas/
 * modos/perspectivas→nombres), años (exacto + rangos) y red flags negados.
 * No toca paginación, pool, cache, enrichment ni persistencia.
 */
import {
  genreIgbNames,
  platformIgbNames,
  perspectiveIgbNames,
  themeIgbId,
} from "../igdb/normalizers.js";
import type {
  FilteredSearchOptions,
  IgdbClient,
  IgdbGameRaw,
} from "../igdb/types.js";
import type { GameSearchIntent } from "../types/GameSearchIntent.js";
import type { RecommendationConfig } from "../recommendation/constants.js";
import type { Trace } from "../lib/logger.js";

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

// Resolución canónico → id numérico de IGDB desde el léxico local
// (keyword_lexicon.igdb_id). Opcional: sin léxico no hay filtro de keywords.
export interface KeywordIdResolver {
  resolveIds(terms: string[]): Promise<Map<string, number | null>>;
}

export class DiscoveryQueryBuilder {
  constructor(
    private igdb: IgdbClient,
    private config: RecommendationConfig,
    private lexicon?: KeywordIdResolver,
  ) {}

  // Canónicos → IDs numéricos de IGDB desde el léxico local. Sin léxico
  // (tests) no hay IDs locales → sin filtro de keywords en el where.
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
   * de la comunidad.
   */
  async filteredSearch(
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
   * Llamada AMPLIA (último recurso, sin caché útil): coincide CUALQUIERA,
   * solo filtra lo prohibido (red flags). Texto = PRIMER keyword (un solo
   * término: la búsqueda por texto de IGDB con frases multi-término
   * devuelve vacío). Sin atributos en el `where`: la exigencia la pone
   * la criba local, no IGDB.
   */
  async broadSearch(
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
}