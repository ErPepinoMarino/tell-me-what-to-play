import type {
  CuratedGame,
  CuratedGameToPersist,
  Game,
  IgdbGame,
  IgdbGameToPersist,
} from "../types/Game.js";
import type { Semantic } from "../types/GameEnrichment.js";
import type { IgdbGameRaw } from "../igdb/types.js";
import type {
  GameMode,
  Genre,
  Perspective,
  Platform,
  Theme,
} from "../types/enums.js";
import type { GameSearchIntent } from "../types/GameSearchIntent.js";

// Filtro de pre-selección SQL del pool de candidatos (cap externo incluido).
// Semántica conjuntiva: TODO lo pedido debe estar (contrato de filtros duros).
export interface CandidateFilter {
  genres: string[];
  themes: string[];
  keywords: string[];
  platforms: string[];
  gameModes: string[];
  perspectives: string[];
  releaseYear: number | null;
  yearFrom: number | null;
  yearTo: number | null;
  limit: number;
}

/*
 * Patch de re-enrichment: SOLO lo que el enrichment puede escribir sobre una
 * ficha existente — descripciones, semánticas y (para fichas sin identidad)
 * datos objetivos. `keywords?: never` hace estructuralmente imposible que el
 * reEnrich toque las keywords: refrescarlas desde IGDB es una operación
 * explícita de sincronización de catálogo, no parte del enrichment.
 */
export interface ReEnrichPatch {
  description_es: string | null;
  description_en: string | null;
  semantic: Semantic;
  sourceId?: string | null;
  coverUrl?: string | null;
  releaseYear?: number | null;
  genres?: Genre[];
  themes?: Theme[];
  platforms?: Platform[];
  gameModes?: GameMode[];
  perspectives?: Perspective[];
  developers?: string[];
  publishers?: string[];
  keywords?: never;
}

/*
 * Capa de catálogo canónica: TODA identidad de juego (ids de sesión,
 * resultados, exclusiones) nace de aquí. El JSON cache es una proyección
 * y se canonicaliza contra esta capa antes de entrar al matcher.
 *
 * Escritura de keywords: SOLO tres operaciones semánticamente explícitas
 * (createIgdb, createCurated, syncCatalogKeywords). No existe ningún
 * `create`/`update` genérico que acepte un `Game` arbitrario.
 * updateReEnrich actualiza la ficha SIN acceso a keywords.
 */
export interface CatalogLayer {
  findCandidates(filter: CandidateFilter): Promise<Game[]>;
  getBySlugs(slugs: string[]): Promise<Map<string, Game>>;
  getBySlug(slug: string): Promise<Game | undefined>;
  getBySourceId(sourceId: string): Promise<Game | undefined>;
  searchByTitle(query: string): Promise<Game[]>;
  createIgdb(game: IgdbGameToPersist): Promise<IgdbGame>;
  createCurated(game: CuratedGameToPersist): Promise<CuratedGame>;
  syncCatalogKeywords(game: IgdbGame, raw: IgdbGameRaw): Promise<IgdbGame>;
  updateReEnrich(game: Game, patch: ReEnrichPatch): Promise<Game>;
  incrementSearchCounts(ids: number[]): Promise<void>;
  countGames(): Promise<number>;
}

// Capa caliente: proyección de los más populares. Nunca autoridad de ids.
export interface CacheLayer {
  getAll(): Promise<Game[]>;
  searchByTitle(query: string): Promise<Game[]>;
}

export interface IntentExtractor {
  /*
   * Extracción SIEMPRE fresca (sin contexto): el mensaje se interpreta con
   * el contrato base. El segundo parámetro existe por compatibilidad con
   * fakes/tests y se ignora.
   */
  extract(
    userText: string,
    previousIntent?: GameSearchIntent,
  ): Promise<GameSearchIntent>;
  /*
   * Clasificador de relación refine-vs-new: paso mínimo que solo decide, por
   * INFERENCIA, si el mensaje afina la búsqueda anterior o empieza otra.
   * Único punto de decisión para anon y logueado. Sin clasificador, el
   * orquestador asume búsqueda nueva (fakes/tests).
   */
  classifyRelation?(
    userText: string,
    previousIntent?: GameSearchIntent,
  ): Promise<"new" | "refine" | "nonsensical">;
  /*
   * Delta del refinamiento: solo se llama tras classifyRelation = "refine".
   * Extrae qué añadir/quitar; el merge es determinista (applyRefineDelta).
   */
  extractRefineDelta?(
    userText: string,
    previousIntent: GameSearchIntent,
  ): Promise<import("../types/GameSearchIntent.js").RefineDelta>;
}

export type Actor = { kind: "anon" } | { kind: "user"; userId: number };

export interface RecommendationRequest {
  action: "search" | "more";
  message: string;
  actor: Actor;
  /*
   * Última intención que el cliente conoce (la que muestra en los chips).
   * Es el "intento previo" para clasificar refine-vs-new y la base del
   * refinado. El servidor ya NO guarda sesión: la conversación vive en el
   * cliente.
   */
  contextIntent?: GameSearchIntent | null;
  /*
   * IDs ya mostrados al usuario en este hilo de conversación. El cliente
   * es el dueño del contexto; solo se usa para excluir en turnos "more"-like
   * (more explícito o refine no-op). Una búsqueda NUEVA empieza de cero.
   */
  shownGameIds?: number[];
}
