import type { Game } from "../types/Game.js";

export interface IGameRepository {
  getAll(): Promise<Game[]>;

  getBySlug(slug: string): Promise<Game | undefined>;

  search(query: string): Promise<Game[]>;

  create(game: Game): Promise<Game>;

  update(game: Game): Promise<Game>;

  delete(id: number): Promise<void>;
}
