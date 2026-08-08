import { games } from "../data/games.js";
import type { Game } from "../types/Game.js";
import { IGameRepository } from "./IGameRepository.js"; //se importa como js pese a ser ts porque el module system es NodeNext y el module resolution es NodeNext, por lo que se resuelve como js

export const jsonGameRepository: IGameRepository = {
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
};
