import type {
  FilteredSearchOptions,
  HttpClient,
  IgdbClient,
  IgdbGameRaw,
} from "./types.js";
import { IgdbAuth } from "./auth.js";
import {
  IgdbAuthError,
  IgdbError,
  IgdbRateLimitError,
  IgdbServerError,
} from "./errors.js";

const IGDB_API_URL = "https://api.igdb.com/v4/games";
const IGDB_GENRES_URL = "https://api.igdb.com/v4/genres";
const IGDB_PLATFORMS_URL = "https://api.igdb.com/v4/platforms";
const IGDB_KEYWORDS_URL = "https://api.igdb.com/v4/keywords";
const IGDB_GAME_MODES_URL = "https://api.igdb.com/v4/game_modes";
const IGDB_PERSPECTIVES_URL = "https://api.igdb.com/v4/player_perspectives";
const MAX_RETRIES = 4; // 1 initial + 3 retries = 4 total attempts
const BASE_DELAY_MS = 1000;

const FIELDS = [
  "name",
  "summary",
  "first_release_date",
  "game_type",
  "total_rating_count",
  "cover.image_id",
  "genres.name",
  "platforms.name",
  "game_modes.name",
  "player_perspectives.name",
  "keywords.name",
  "themes.name",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
].join(", ");

// Clase que implementa la interfaz IgdbClient y maneja la autenticación y las solicitudes a la API de IGDB
export class HttpIgdbClient implements IgdbClient {
  private auth: IgdbAuth;

  constructor(
    private httpClient: HttpClient,
    clientId: string,
    clientSecret: string,
  ) {
    this.auth = new IgdbAuth(clientId, clientSecret, httpClient);
  }
  //Aqui implementamos los metodos que declaramos en types.ts
  //Este no creo que lo usemos porque devuelve juegos sin criterio.
  async fetchGames(options: {
    offset: number;
    limit: number;
  }): Promise<IgdbGameRaw[]> {
    const token = await this.auth.getAccessToken();
    const body = this.buildQuery(options.offset, options.limit);
    return this.withRetry(() => this.request(token, body));
  }
  // este nos permite buscar juegos con un criterio de búsqueda y un límite de resultados. (el bueno)
  async searchGames(query: string, limit = 10): Promise<IgdbGameRaw[]> {
    const token = await this.auth.getAccessToken();
    // Sanitized limpia la cadena de búsqueda para evitar inyecciones de código y caracteres problemáticos
    // Reemplaza comillas, punto y coma y saltos de línea con espacios.
    // Luego reemplaza múltiples espacios con uno solo y recorta los espacios al inicio y al final
    const sanitized = query
      .replace(/[";\n]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const body =
      [
        `fields ${FIELDS}`,
        `search "${sanitized}"`,
        // Las versiones/ports (version_parent) son registros independientes en
        // IGDB; filtramos solo el juego principal en resultados de búsqueda.
        "where version_parent = null",
        `limit ${limit}`,
      ].join("; ") + ";";
    return this.withRetry(() => this.request(token, body));
  }
  // Constructor de la query de busqueda.
  private buildQuery(offset: number, limit: number): string {
    return (
      [
        `fields ${FIELDS}`,
        `limit ${limit}`,
        `offset ${offset}`,
        "sort name asc",
      ].join("; ") + ";"
    );
  }

  // Backfill/recovery: metadatos (ratings) de fichas ya descubiertas, por lote de IDs.
  async fetchGamesByIds(ids: number[]): Promise<IgdbGameRaw[]> {
    if (ids.length === 0) return [];
    const token = await this.auth.getAccessToken();
    const body =
      [
        "fields id, name, total_rating_count, total_rating",
        `where id = (${ids.join(",")})`,
        `limit ${Math.min(ids.length, 500)}`,
      ].join("; ") + ";";
    return this.withRetry(() => this.request(token, body));
  }

  /*
   * Diccionario completo de keywords (seed del léxico): TODA la taxonomía de
   * keywords de IGDB, paginada. Única fuente del diccionario cerrado.
   */
  async fetchAllKeywords(): Promise<{ id: number; name: string; slug: string }[]> {
    const token = await this.auth.getAccessToken();
    const rows: { id: number; name: string; slug: string }[] = [];
    for (let offset = 0; offset < 100_000; offset += 500) {
      const batch = (await this.withRetry(() =>
        this.requestRows(
          token,
          IGDB_KEYWORDS_URL,
          `fields id, name, slug; limit 500; offset ${offset};`,
        ),
      )) as unknown as { id: number; name: string; slug?: string }[];
      rows.push(
        ...batch
          .filter((row) => typeof row.name === "string")
          .map((row) => ({
            id: Number(row.id),
            name: row.name,
            slug: row.slug ?? "",
          })),
      );
      if (batch.length < 500) break;
    }
    return rows;
  }

  // Backfill de themes para fichas del catálogo, por lote de IDs de juego.
  async fetchThemesByGameIds(
    ids: number[],
  ): Promise<{ id: number; themes?: { name: string }[] }[]> {
    if (ids.length === 0) return [];
    const token = await this.auth.getAccessToken();
    const body =
      [
        "fields id, themes.name",
        `where id = (${ids.join(",")})`,
        `limit ${Math.min(ids.length, 500)}`,
      ].join("; ") + ";";
    return this.withRetry(() =>
      this.requestRows(token, IGDB_API_URL, body),
    ) as Promise<{ id: number; themes?: { name: string }[] }[]>;
  }

  /*
   * Descubrimiento por ATRIBUTOS: construye `where genres/keywords/platforms
   * /release_dates.y` resolviendo los nombres/slugs a IDs de IGDB (taxonomía
   * cacheada por proceso). Sin `search` se ordena por rating de comunidad →
   * el descubrimiento trae lo mejor valorado que cumple los atributos, no lo
   * que mejor suena en el título.
   */
  async filteredSearch(options: FilteredSearchOptions): Promise<IgdbGameRaw[]> {
    const token = await this.auth.getAccessToken();
    const conditions: string[] = ["version_parent = null"];

    if (options.genreIgbNames && options.genreIgbNames.length > 0) {
      const ids = await this.resolveTaxonomyIds(
        IGDB_GENRES_URL,
        "name",
        options.genreIgbNames,
      );
      if (ids.length > 0) conditions.push(`genres = (${ids.join(",")})`);
      else this.reportDropped(options, "genres", options.genreIgbNames);
    }
    // Themes: IDs directos (mapa fijo del intent → id, sin consulta runtime).
    if (options.themeIds && options.themeIds.length > 0) {
      conditions.push(`themes = (${options.themeIds.join(",")})`);
    }
    /*
     * Keywords con semántica AND: cada término es una condición separada
     * (`keywords = (a) & keywords = (b)`), que IGDB interpreta como "debe
     * tener ambas". Un único `keywords = (a,b)` es OR (cualquiera) y con
     * términos débiles ("3d") diluía todo el filtro. Los IDs vienen del
     * léxico local (igdb_id), no de una consulta a /v4/keywords.
     */
    if (options.keywordIds && options.keywordIds.length > 0) {
      // OR semantics: ANY of the keywords (not all). IGDB's `keywords = (a, b)`
      // matches games that have at least one of the listed keywords. This is
      // correct for discovery: broadens the pool without diluting precision.
      conditions.push(`keywords = (${options.keywordIds.join(",")})`);
    }
    if (options.perspectiveIgbNames && options.perspectiveIgbNames.length > 0) {
      const ids = await this.resolveTaxonomyIds(
        IGDB_PERSPECTIVES_URL,
        "name",
        options.perspectiveIgbNames,
      );
      if (ids.length > 0)
        conditions.push(`player_perspectives = (${ids.join(",")})`);
      else
        this.reportDropped(options, "perspectives", options.perspectiveIgbNames);
    }
    if (options.platformIgbNames && options.platformIgbNames.length > 0) {
      const ids = await this.resolveTaxonomyIds(
        IGDB_PLATFORMS_URL,
        "name",
        options.platformIgbNames,
      );
      if (ids.length > 0) conditions.push(`platforms = (${ids.join(",")})`);
      else this.reportDropped(options, "platforms", options.platformIgbNames);
    }
    if (options.gameModeIgbNames && options.gameModeIgbNames.length > 0) {
      const ids = await this.resolveTaxonomyIds(
        IGDB_GAME_MODES_URL,
        "name",
        options.gameModeIgbNames,
      );
      if (ids.length > 0) conditions.push(`game_modes = (${ids.join(",")})`);
      else this.reportDropped(options, "gameModes", options.gameModeIgbNames);
    }
    if (options.releaseYear !== undefined) {
      conditions.push(`release_dates.y = ${options.releaseYear}`);
    }
    if (options.yearFrom !== undefined) {
      conditions.push(`release_dates.y >= ${options.yearFrom}`);
    }
    if (options.yearTo !== undefined) {
      conditions.push(`release_dates.y <= ${options.yearTo}`);
    }

    /*
     * Red flags: negación en el where — el descubrimiento no trae candidatos
     * condenados por el matcher (gasta menos enrichment). `!= (a,b)` en IGDB
     * significa "no contiene ninguno", que es la semántica de exclusión.
     */
    if (options.excludeGenreIgbNames?.length) {
      const ids = await this.resolveTaxonomyIds(
        IGDB_GENRES_URL,
        "name",
        options.excludeGenreIgbNames,
      );
      if (ids.length > 0) conditions.push(`genres != (${ids.join(",")})`);
      else this.reportDropped(options, "genres", options.excludeGenreIgbNames);
    }
    if (options.excludeThemeIds?.length) {
      conditions.push(`themes != (${options.excludeThemeIds.join(",")})`);
    }
    if (options.excludeKeywordIds?.length) {
      conditions.push(`keywords != (${options.excludeKeywordIds.join(",")})`);
    }
    if (options.excludePlatformIgbNames?.length) {
      const ids = await this.resolveTaxonomyIds(
        IGDB_PLATFORMS_URL,
        "name",
        options.excludePlatformIgbNames,
      );
      if (ids.length > 0) conditions.push(`platforms != (${ids.join(",")})`);
      else
        this.reportDropped(options, "platforms", options.excludePlatformIgbNames);
    }
    if (options.excludePerspectiveIgbNames?.length) {
      const ids = await this.resolveTaxonomyIds(
        IGDB_PERSPECTIVES_URL,
        "name",
        options.excludePerspectiveIgbNames,
      );
      if (ids.length > 0)
        conditions.push(`player_perspectives != (${ids.join(",")})`);
      else
        this.reportDropped(
          options,
          "perspectives",
          options.excludePerspectiveIgbNames,
        );
    }

    // Sin texto no hay orden por relevancia: manda la comunidad.
    const statements: string[] = [`fields ${FIELDS}`];
    if (options.text) {
      statements.push(`search "${this.sanitizeQuery(options.text)}"`);
    } else {
      statements.push("sort total_rating_count desc");
    }
    statements.push(`where ${conditions.join(" & ")}`);
    statements.push(`limit ${options.limit ?? 30}`);

    const body = statements.join("; ") + ";";
    // LOG: ver exactamente qué query se envía a IGDB
    console.log(`[IGDB-QUERY] ${body}`);
    return this.withRetry(() => this.request(token, body));
  }

  private reportDropped(
    options: FilteredSearchOptions,
    field: "genres" | "themes" | "keywords" | "perspectives" | "gameModes" | "platforms",
    terms: string[],
  ): void {
    if (terms.length === 0) return;
    options.onFilterDropped?.({ field, terms });
  }

  private sanitizeQuery(text: string): string {
    return text
      .replace(/[";\n]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Resolución de nombres IGDB a IDs (cache por proceso; una llamada por tabla).
  private taxonomyCache = new Map<string, Map<string, number>>();

  private async resolveTaxonomyIds(
    url: string,
    field: "name",
    names: string[],
  ): Promise<number[]> {
    let cache = this.taxonomyCache.get(url);
    if (!cache) {
      const token = await this.auth.getAccessToken();
      const rows = (await this.requestRows(
        token,
        url,
        `fields ${field}; limit 500;`,
      )) as { id: number; [key: string]: unknown }[];
      cache = new Map(
        rows
          .filter((row) => typeof row[field] === "string")
          .map((row) => [
            String(row[field]).toLowerCase(),
            Number(row.id),
          ]),
      );
      this.taxonomyCache.set(url, cache);
    }

    const ids: number[] = [];
    for (const name of names) {
      const id = cache.get(name.toLowerCase());
      if (id !== undefined && !ids.includes(id)) ids.push(id);
    }
    // LOG: ver qué nombres se resuelven y a qué IDs
    console.log(`[IGDB-TAXONOMY] url=${url} names=[${names.join(", ")}] resolved=[${ids.join(", ")}] cacheSize=${cache.size}`);
    return ids;
  }

  // Usa el httpclient para hacer la petición a la API
  // Esta es la clave, ya que el httpclient del test le devolvera lo que queramos y el que sale del index.ts hace la petición real a la API de IGDB.
  // Importante para entender la relación entre los tests y el código de producción.
  // Peticion genérica contra cualquier endpoint de IGDB (games, genres,
  // keywords, platforms...): misma autenticación y mismo manejo de errores.
  private async requestRows(
    token: string,
    url: string,
    body: string,
  ): Promise<Record<string, unknown>[]> {
    const response = await this.httpClient.post(url, body, {
      "Client-ID": this.auth["clientId"],
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    });

    if (response.status === 429) {
      throw new IgdbRateLimitError();
    }
    if (response.status >= 500) {
      throw new IgdbServerError();
    }
    if (response.status === 401 || response.status === 403) {
      throw new IgdbAuthError();
    }
    if (response.status !== 200) {
      throw new IgdbError(`Unexpected IGDB response: ${response.status}`);
    }

    return (await response.json()) as Record<string, unknown>[];
  }

  private async request(token: string, body: string): Promise<IgdbGameRaw[]> {
    return (await this.requestRows(
      token,
      IGDB_API_URL,
      body,
    )) as unknown as IgdbGameRaw[];
  }
  // Mecanismo de reintentos si el error lo permite. Es decir IgdbRateLimitError o IgdbServerError.
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const isRetryable =
          error instanceof IgdbRateLimitError ||
          error instanceof IgdbServerError;
        if (!isRetryable) {
          throw error; // 401/403 or other errors: do not retry
        }
        if (attempt === MAX_RETRIES - 1) {
          throw error; // last attempt: propagate error
        }
        const delay = BASE_DELAY_MS * Math.pow(2, attempt); // 1s, 2s, 4s
        await this.sleep(delay);
      }
    }
    throw new IgdbError("Retry loop exited unexpectedly");
  }
  // Funcion para esperar entre repeticiones del retry.
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
