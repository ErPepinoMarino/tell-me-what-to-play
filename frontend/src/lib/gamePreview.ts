import type { Game } from "@/types/Game";
import type { RecommendedGame } from "@/types/Recommendation";

const PLACEHOLDER = "/images/ImagePlaceHolder.webp";

/*
 * Vista preliminar de ficha a partir del DTO de recomendación (campos en
 * común). El DTO no trae sourceId/developers/publishers/searchCount ni
 * dims semánticas; esos huecos los completará useGameDetail (A4) con el
 * GET /api/games/:slug real. Interino solo para poder abrir la ficha
 * desde un card sin navegación completa.
 */
export function gamePreviewFromRecommended(game: RecommendedGame): Game {
  return {
    id: game.id,
    slug: game.slug,
    title: game.title,
    description_es: game.description_es ?? "",
    description_en: game.description_en ?? "",
    coverUrl: game.coverUrl ?? PLACEHOLDER,
    releaseYear: game.releaseYear ?? 0,
    genres: game.genres,
    themes: game.themes,
    platforms: game.platforms,
    gameModes: game.gameModes,
    perspectives: game.perspectives,
    keywords: game.keywords,
    developers: [],
    publishers: [],
    searchCount: 0,
    difficulty: null,
    pace: null,
    narrative: null,
    complexity: null,
    strategy: null,
    exploration: null,
    violence: null,
    horror: null,
    darkness: null,
    tension: null,
    humor: null,
    isolation: null,
  };
}
