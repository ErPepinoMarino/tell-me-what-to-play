// Interfaz para lanzar peticiones HTTP a la API de IGDB
// Se abstrae para poder inyectar un cliente falso en los tests
export interface HttpClient {
  post(url: string, body: string, headers: HeadersInit): Promise<HttpResponse>;
}
// Interfaz para la respuesta de la API de IGDB
// Ocurre lo mismo que con HttpClient.
export interface HttpResponse {
  status: number;
  json(): Promise<unknown>;
}

// Los datos que devuelve la API de IGDB para un juego, viene de su Api, no es cosa nuestra.
export interface IgdbGameRaw {
  id: number;
  name: string;
  summary?: string;
  first_release_date?: number; // epoch seconds
  game_type?: number; // id de game_types (0 Main Game ... 14 Update)
  total_rating_count?: number; // nº de valoraciones de usuarios (señal de calidad)
  total_rating?: number; // nota media de usuarios (0-100)
  cover?: { image_id: string };
  genres?: { id: number; name: string }[];
  platforms?: { id: number; name: string }[];
  game_modes?: { id: number; name: string }[];
  player_perspectives?: { id: number; name: string }[];
  keywords?: { id: number; name: string }[];
  themes?: { id: number; name: string }[];
  involved_companies?: {
    id: number;
    company: { id: number; name: string };
    developer: boolean;
    publisher: boolean;
  }[];
}

// Consulta de descubrimiento FILTRADA: en lugar de text-search por título
// (que no puede servir intents multi-atributo), IGDB permite `where` por
// atributos: géneros/themes/keywords/plataformas/game_modes/perspectivas por
// ID y años por release_dates. Los keywords van AND-encadenados (cada
// condición exige esa keyword); géneros/themes/plataformas/modos/perspectivas
// son ANY dentro del grupo. Los red flags se NEGAN en el where (el
// descubrimiento no trae candidatos condenados por el matcher).
export interface FilteredSearchOptions {
  // Términos de título (opcional: con filtros de atributos suele sobrar).
  text?: string;
  // Nombres IGDB de géneros (se resuelven a IDs contra /v4/genres).
  genreIgbNames?: string[];
  // IDs numéricos de themes (mapa fijo del intent → id, sin runtime).
  themeIds?: number[];
  // IDs numéricos de keywords (léxico local igdb_id, sin /v4/keywords).
  keywordIds?: number[];
  // Nombres IGDB de perspectivas (se resuelven contra /v4/player_perspectives).
  perspectiveIgbNames?: string[];
  // Nombres IGDB de game_modes (se resuelven contra /v4/game_modes).
  gameModeIgbNames?: string[];
  // Nombres IGDB de plataformas (se resuelven a IDs contra /v4/platforms).
  platformIgbNames?: string[];
  // Año exacto de lanzamiento (release_dates.y).
  releaseYear?: number;
  // Rangos de año pedidos ("de los 90" → 1990-1999).
  yearFrom?: number;
  yearTo?: number;
  // Red flags (negación): el descubrimiento excluye los candidatos que los
  // contengan antes del enrichment.
  excludeGenreIgbNames?: string[];
  excludeThemeIds?: number[];
  excludeKeywordIds?: number[];
  excludePlatformIgbNames?: string[];
  excludePerspectiveIgbNames?: string[];
  limit?: number;
  // Visibilidad: un término que NO resuelve a ID se deja fuera del where.
  // Nunca en silencio (decisión de producto tras el bug del género ACTION).
  onFilterDropped?: (details: {
    field:
      | "genres"
      | "themes"
      | "keywords"
      | "perspectives"
      | "gameModes"
      | "platforms";
    terms: string[];
  }) => void;
}

// Interfaz con las peticiones que le haremos a IGDB
// fetchGames para que nos devuelva un array de juegos que no sabemos (no la usaremos)
// searchGames (la buena) que nos permite añadir una query con criterios de búsqueda y un límite de resultados.
// fetchGamesByIds: recovery/backfill de metadatos (ratings) para fichas ya descubiertas.
// filteredSearch: descubrimiento por ATRIBUTOS (géneros/keywords/plataformas/año).
// fetchAllKeywords: diccionario completo de keywords (seed del léxico).
// fetchThemesByGameIds: backfill de themes para fichas del catálogo.
export interface IgdbClient {
  fetchGames(options: {
    offset: number;
    limit: number;
  }): Promise<IgdbGameRaw[]>;

  searchGames(query: string, limit?: number): Promise<IgdbGameRaw[]>;

  fetchGamesByIds(ids: number[]): Promise<IgdbGameRaw[]>;

  filteredSearch(options: FilteredSearchOptions): Promise<IgdbGameRaw[]>;

  fetchAllKeywords(): Promise<{ id: number; name: string; slug: string }[]>;

  fetchThemesByGameIds(
    ids: number[],
  ): Promise<{ id: number; themes?: { name: string }[] }[]>;
}
