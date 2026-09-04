import type { Game, GameToPersist } from "../types/Game.js";
import type { GameSearchIntent } from "../types/GameSearchIntent.js";

// Filtro de pre-selección SQL del pool de candidatos (cap externo incluido).
// Semántica conjuntiva: TODO lo pedido debe estar (contrato de filtros duros).
export interface CandidateFilter {
  genres: string[];
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
}

export type Actor = { kind: "anon" } | { kind: "user"; userId: number };

export interface RecommendationRequest {
  action: "search" | "more";
  message: string;
  actor: Actor;
}
