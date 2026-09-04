import { describe, expect, it } from "vitest";
import { shouldSkipNonIndependentGame } from "../../src/igdb/gameType.js";
import type { IgdbGameRaw } from "../../src/igdb/types.js";

function rawGame(gameType: number | undefined, id = 1): IgdbGameRaw {
  const raw: IgdbGameRaw = { id, name: "Game" };
  if (gameType !== undefined) {
    raw.game_type = gameType;
  }
  return raw;
}

describe("shouldSkipNonIndependentGame", () => {
  it("skips game types that are clearly not independent", () => {
    const nonIndependent = [1, 2, 3, 5, 7, 11, 12, 13, 14]; // DLC, Expansion, Bundle, Mod, Season, Port, Fork, Pack/Addon, Update
    for (const type of nonIndependent) {
      expect(shouldSkipNonIndependentGame(rawGame(type))).toBe(true);
    }
  });

  it("keeps main games and independent variants", () => {
    const independent = [0, 4, 6, 8, 9, 10]; // Main Game, Standalone Expansion, Episode, Remake, Remaster, Expanded Game
    for (const type of independent) {
      expect(shouldSkipNonIndependentGame(rawGame(type))).toBe(false);
    }
  });

  it("keeps records without a game_type (never discard on doubt)", () => {
    expect(shouldSkipNonIndependentGame(rawGame(undefined))).toBe(false);
  });
});
