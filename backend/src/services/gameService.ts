import type { Game } from "../types/Game.js";
import { jsonGameRepository } from "../repositories/jsonGameRepository.js";
import { IGameRepository } from "../repositories/IGameRepository.js";

const repository: IGameRepository = jsonGameRepository;

export const gameService = {
  async getBySlug(slug: string): Promise<Game | undefined> {
    return repository.getBySlug(slug);
  },

  async search(query: string) {
    return repository.search(query);
  },
};
