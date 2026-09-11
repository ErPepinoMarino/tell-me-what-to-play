import { games, toCuratedKeywords } from "../data/games.js";
import type { CuratedGame, Game } from "../types/Game.js";

/*
 * Cache fría del seed: todas sus fichas son vocabulario CU-RADO (nunca
 * IgdbKeyword). Se tipan como CuratedGame con el mint curado; es imposible
 * que un dato del seed "finja" procedencia IGDB.
 */
export const jsonGameRepository = {
  async getAll(): Promise<Game[]> {
    return games.map(toCuratedGame);
  },

  async search(query: string): Promise<Game[]> {
    const searchQuery = query.toLowerCase();

    return games
      .filter((game) => game.title.toLowerCase().includes(searchQuery))
      .map(toCuratedGame);
  },
};

function toCuratedGame(game: (typeof games)[number]): CuratedGame {
  return {
    ...game,
    provenance: "curated",
    keywords: toCuratedKeywords(game.keywords),
  };
}