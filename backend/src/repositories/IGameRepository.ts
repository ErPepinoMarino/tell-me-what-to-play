import type { Game } from "../types/Game.js";

export interface IGameRepository {
  getAll(): Promise<Game[]>;

  getBySlug(slug: string): Promise<Game | undefined>;

  search(query: string): Promise<Game[]>;
}
