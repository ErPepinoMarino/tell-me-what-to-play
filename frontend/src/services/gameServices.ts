import type { Game } from "@/types/Game";
import { gameRepository } from "@/repositories/gameRepository";

export const gameService = {
  async getBySlug(slug: string): Promise<Game | undefined> {
    return gameRepository.getBySlug(slug);
  },

  async search(query: string) {
    return gameRepository.search(query);
  },
};
