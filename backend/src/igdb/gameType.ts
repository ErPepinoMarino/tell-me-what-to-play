// Pure function: decide if an IGDB raw record is a non-independent game
// that should not become a candidate (DLC, bundle, mod, port, update, ...).
// No HTTP, no Prisma, no AI. Fully deterministic and testable offline.
//
// Regla de producto: NUNCA deduplicar por título/año/parte del nombre.
// Remakes, remasters, secuelas y ediciones que IGDB considera juegos
// independientes SON legítimos. Solo se descarta un candidato cuando IGDB lo
// clasifica explícitamente con un tipo no independiente; ante duda o campo
// ausente se conserva.

import type { IgdbGameRaw } from "./types.js";

// ids de /v4/game_types que NO representan un juego independiente:
// dependen de un juego base o son un packaging del mismo (Bundle/Port).
// Igualmente excluimos Mod y Update porque son contenido derivado.
const NON_INDEPENDENT_GAME_TYPES = new Set<number>([
  1, // DLC
  2, // Expansion
  3, // Bundle
  5, // Mod
  7, // Season
  11, // Port
  12, // Fork
  13, // Pack / Addon
  14, // Update
]);

/*
 * Devuelve true solo si IGDB clasifica el registro con un game_type
 * inequívocamente no independiente. game_type ausente -> false (nunca descartar).
 */
export function shouldSkipNonIndependentGame(raw: IgdbGameRaw): boolean {
  return NON_INDEPENDENT_GAME_TYPES.has(raw.game_type ?? -1);
}
