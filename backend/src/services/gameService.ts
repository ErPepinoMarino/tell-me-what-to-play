import type { Game } from "../types/Game.js";
import { IGameRepository } from "../repositories/IGameRepository.js";
import { prismaGameRepository } from "../repositories/prismaGameRepository.js";

const repository: IGameRepository = prismaGameRepository;

export const gameService = {
  async getBySlug(slug: string): Promise<Game | undefined> {
    return repository.getBySlug(slug);
  },

  async search(query: string) {
    return repository.search(query);
  },
  async create(game: Game): Promise<Game> {
    return repository.create(game);
  },
  async update(game: Game): Promise<Game> {
    return repository.update(game);
  },
};
