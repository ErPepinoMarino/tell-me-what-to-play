import { games } from "@/data/games";
import type { Game } from "@/types/Game";

export const gameRepository = {
  async getAll(): Promise<Game[]> {
    return games;
  },

  async getBySlug(slug: string): Promise<Game | undefined> {
    return games.find((game) => game.slug === slug);
  },

  async search(query: string): Promise<Game[]> {
    const searchQuery = query.toLowerCase();

    return games.filter((game) =>
      game.title.toLowerCase().includes(searchQuery)
    );
  },
};
