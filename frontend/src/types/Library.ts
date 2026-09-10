import type { Game } from "@/types/Game";

export type UserGameStatus = "PENDING" | "PLAYED" | "COMPLETED";

export type Recommendation =
  | "HIGHLY_RECOMMENDED"
  | "RECOMMENDED"
  | "MEH"
  | "NOT_RECOMMENDED";

/*
 * Entrada de GET /api/users/:id/library (incluye la fila del juego en la
 * propiedad relación "games"). Ordenada por título en el backend.
 */
export interface LibraryEntry {
  user_id: number;
  game_id: number;
  status: UserGameStatus | null;
  recommendation: Recommendation | null;
  review: string | null;
  games: Game;
}
