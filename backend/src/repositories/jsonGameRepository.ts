import { games } from "../data/games.js";
import { brandStoredIgdbKeywords } from "../igdb/keywords.js";
import type { Game } from "../types/Game.js";

/*
 * Cache fría del seed: proyección de las fichas más populares. Estas fichas
 * se crean con keywords VACÍAS (Game.keywords es exclusivamente IGDB y el
 * seed es offline); la reparación de catálogo las rellena desde IGDB. Las
 * arrays `keywords` del archivo de datos son legado y no se sirven.
 */
export const jsonGameRepository = {
  async getAll(): Promise<Game[]> {
    return games.map(toGame);
  },

  async search(query: string): Promise<Game[]> {
    const searchQuery = query.toLowerCase();

    return games
      .filter((game) => game.title.toLowerCase().includes(searchQuery))
      .map(toGame);
  },
};

function toGame(game: (typeof games)[number]): Game {
  const { keywords: _legacyKeywords, ...rest } = game;
  void _legacyKeywords;
  return {
    ...rest,
    keywords: brandStoredIgdbKeywords([]),
  };
}