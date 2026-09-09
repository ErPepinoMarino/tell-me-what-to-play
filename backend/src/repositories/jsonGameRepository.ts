import { games } from "../data/games.js";
import type { Game } from "../types/Game.js";

export const jsonGameRepository = {
  async getAll(): Promise<Game[]> {
    return games;
  },

  async search(query: string): Promise<Game[]> {
    const searchQuery = query.toLowerCase();

    return games.filter((game) =>
      game.title.toLowerCase().includes(searchQuery),
    );
  },
};
