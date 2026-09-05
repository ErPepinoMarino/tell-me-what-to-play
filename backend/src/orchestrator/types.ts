import type { Game, GameToPersist } from "../types/Game.js";
import type { GameSearchIntent } from "../types/GameSearchIntent.js";

// Filtro de pre-selección SQL del pool de candidatos (cap externo incluido).
// Semántica conjuntiva: TODO lo pedido debe estar (contrato de filtros duros).
export interface CandidateFilter {
  genres: string[];
  themes: string[];
  keywords: string[];
  platforms: string[];
  releaseYear: number | null;
  yearFrom: number | null;
  yearTo: number | null;
  limit: number;
}

/*
 * Capa de catálogo canónica: TODA identidad de juego (ids de sesión,
 * resultados, exclusiones) nace de aquí. El JSON cache es una proyección
 * y se canonicaliza contra esta capa antes de entrar al matcher.
 */
export interface CatalogLayer {
  findCandidates(filter: CandidateFilter): Promise<Game[]>;
  getBySlugs(slugs: string[]): Promise<Map<string, Game>>;
  getBySlug(slug: string): Promise<Game | undefined>;
  getBySourceId(sourceId: string): Promise<Game | undefined>;
  searchByTitle(query: string): Promise<Game[]>;
  create(game: GameToPersist): Promise<Game>;
  update(game: Game): Promise<Game>;
  incrementSearchCounts(ids: number[]): Promise<void>;
  countGames(): Promise<number>;
}

// Capa caliente: proyección de los más populares. Nunca autoridad de ids.
export interface CacheLayer {
  getAll(): Promise<Game[]>;
  searchByTitle(query: string): Promise<Game[]>;
}

export interface IntentExtractor {
  extract(
    userText: string,
    previousIntent?: GameSearchIntent,
  ): Promise<GameSearchIntent>;
  /*
   * Clasificador de relación refine-vs-new (anon sin sesión): paso mínimo
   * que solo decide si el mensaje afina la búsqueda anterior o empieza otra.
   * Sin clasificador, el orquestador usa extract como fallback (tests).
   */
  classifyRelation?(
    userText: string,
    previousIntent: GameSearchIntent,
  ): Promise<"new" | "refine">;
}

export type Actor = { kind: "anon" } | { kind: "user"; userId: number };

export interface RecommendationRequest {
  action: "search" | "more";
  message: string;
  actor: Actor;
  /*
   * Última intención que el cliente conoce (la que muestra en los chips).
   * Para ANON (sin sesión) es la ÚNICA forma de clasificar si el mensaje es
   * un refinamiento o un tema nuevo. Para usuarios logueados se ignora
   * (la sesión ya tiene el contexto).
   */
  contextIntent?: GameSearchIntent | null;
}
