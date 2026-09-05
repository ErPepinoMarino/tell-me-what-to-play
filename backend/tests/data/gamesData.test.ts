import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { games } from "../../src/data/games.js";

const seedGames = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../src/data/games_seed.json", import.meta.url)),
    "utf8",
  ),
) as typeof games;

const genres = new Set([
  "ADVENTURE",
  "ARCADE",
  "CARD_AND_BOARD_GAME",
  "FIGHTING",
  "HACK_AND_SLASH_BEAT_EM_UP",
  "INDIE",
  "MOBA",
  "MUSIC",
  "PINBALL",
  "PLATFORM",
  "POINT_AND_CLICK",
  "PUZZLE",
  "QUIZ_TRIVIA",
  "RACING",
  "REAL_TIME_STRATEGY",
  "ROLE_PLAYING_RPG",
  "SHOOTER",
  "SIMULATOR",
  "SPORT",
  "STRATEGY",
  "TACTICAL",
  "TURN_BASED_STRATEGY",
  "VISUAL_NOVEL",
  "UNKNOWN",
]);
const platforms = new Set([
  "PC",
  "MAC",
  "LINUX",
  "PS5",
  "PS4",
  "PS3",
  "PS2",
  "PS1",
  "PS_VITA",
  "PSP",
  "XBOX_SERIES",
  "XBOX_ONE",
  "XBOX_360",
  "XBOX",
  "SWITCH",
  "WII_U",
  "WII",
  "GAMECUBE",
  "N64",
  "SNES",
  "NES",
  "NINTENDO_3DS",
  "DS",
  "GAME_BOY",
  "GAME_BOY_ADVANCE",
  "IOS",
  "ANDROID",
  "UNKNOWN",
]);

const gameModes = new Set([
  "SINGLE_PLAYER",
  "MULTIPLAYER",
  "COOPERATIVE",
  "COMPETITIVE",
  "MASSIVELY_MULTIPLAYER",
  "UNKNOWN",
]);
const perspectives = new Set([
  "FIRST_PERSON",
  "THIRD_PERSON",
  "TOP_DOWN",
  "ISOMETRIC",
  "SIDE_VIEW",
  "TEXT",
  "UNKNOWN",
]);

const themes = new Set([
  "SHOOTER",
  "BUSINESS",
  "COMEDY",
  "DRAMA",
  "EDUCATIONAL",
  "EROTIC",
  "FANTASY",
  "FOUR_X",
  "HISTORICAL",
  "HORROR",
  "KIDS",
  "MYSTERY",
  "NON_FICTION",
  "OPEN_WORLD",
  "PARTY",
  "ROMANCE",
  "SANDBOX",
  "SCIENCE_FICTION",
  "STEALTH",
  "SURVIVAL",
  "THRILLER",
  "WARFARE",
  "UNKNOWN",
]);

describe("objective game fixture", () => {
  it("contains only valid objective enum values and defaults", () => {
    for (const game of games) {
      expect(game.genres.every((genre) => genres.has(genre))).toBe(true);
      expect(game.themes.every((theme) => themes.has(theme))).toBe(true);
      expect(game.platforms.every((platform) => platforms.has(platform))).toBe(
        true,
      );
      expect(game.gameModes.every((mode) => gameModes.has(mode))).toBe(true);
      expect(
        game.perspectives.every((perspective) =>
          perspectives.has(perspective),
        ),
      ).toBe(true);
      expect(
        game.developers.every(
          (developer) => typeof developer === "string" && developer.length > 0,
        ),
      ).toBe(true);
      expect(
        game.publishers.every(
          (publisher) => typeof publisher === "string" && publisher.length > 0,
        ),
      ).toBe(true);
      expect(game.searchCount).toBe(0);
      expect(game).not.toHaveProperty("rating");
    }
  });

  it("uses lowercase kebab-case slugs (opcionalmente con año)", () => {
    for (const game of games) {
      expect(game.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*(-\d{4})?$/);
    }
  });

  it("keeps the JSON seed and TypeScript fixture aligned", () => {
    expect(games).toEqual(seedGames);
  });

  it("uses the canonical identifier for physical platform 3DS", () => {
    const schema = readFileSync(
      fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)),
      "utf8",
    );

    expect(schema).toContain("NINTENDO_3DS");
  });
});
