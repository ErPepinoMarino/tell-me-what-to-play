import type { Game } from "../types/Game.js";
import { prismaGameRepository } from "../repositories/prismaGameRepository.js";

const repository = prismaGameRepository;

const SEMANTIC_ATTRIBUTES = [
  "difficulty",
  "pace",
  "narrative",
  "complexity",
  "coziness",
  "strategy",
  "exploration",
  "violence",
  "horror",
  "darkness",
  "tension",
  "humor",
  "isolation",
] as const;

function validateSemanticAttributes(game: Game): void {
  for (const attr of SEMANTIC_ATTRIBUTES) {
    const value = game[attr];
    if (value !== null && (value < 0 || value > 1)) {
      throw new RangeError(`${attr} must be between 0 and 1`);
    }
  }
}

export const gameService = {
  async getBySlug(slug: string): Promise<Game | undefined> {
    return repository.getBySlug(slug);
  },

  async search(query: string) {
    return repository.search(query);
  },
  async create(game: Game): Promise<Game> {
    validateSemanticAttributes(game);
    return repository.create(game);
  },
  async update(game: Game): Promise<Game> {
    validateSemanticAttributes(game);
    return repository.update(game);
  },
};
