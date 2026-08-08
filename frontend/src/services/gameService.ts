import type { Game } from "@/types/Game";
import { jsonGameRepository } from "@/repositories/jsonGameRepository";
import { IGameRepository } from "@/repositories/IGameRepository";

const repository: IGameRepository = jsonGameRepository;

export const gameService = {
  async getBySlug(slug: string): Promise<Game | undefined> {
    return repository.getBySlug(slug);
  },

  async search(query: string) {
    return repository.search(query);
  },
};
