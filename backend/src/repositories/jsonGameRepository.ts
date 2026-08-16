import { games } from "../data/games.js";
import type { Game } from "../types/Game.js";

export const jsonGameRepository = {
  async getAll(): Promise<Game[]> {
    return games;
  },

  async getBySlug(slug: string): Promise<Game | undefined> {
    return games.find((game) => game.slug === slug);
  },

  async search(query: string): Promise<Game[]> {
    const searchQuery = query.toLowerCase();

    return games.filter((game) =>
      game.title.toLowerCase().includes(searchQuery),
    );
  },
  async create(game: Game): Promise<Game> {
    games.push(game);
    return game;
  },
  async update(game: Game): Promise<Game> {
    const index = games.findIndex((item) => item.id === game.id);

    if (index === -1) {
      throw new Error(`Game with id ${game.id} not found`);
    }

    games[index] = game;
    return game;
  },
  async delete(id: number): Promise<void> {
    const index = games.findIndex((game) => game.id === id);

    if (index === -1) {
      throw new Error(`Game with id ${id} not found`);
    }

    games.splice(index, 1);
  },
};
