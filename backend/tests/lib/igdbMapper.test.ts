import { describe, expect, it } from "vitest";
import { mapIGDBGame } from "../../src/igdb/mappers.js";
import type { IgdbGameRaw } from "../../src/igdb/types.js";

// Juego completo: todos los campos que IGDB puede traer
const FULL_GAME: IgdbGameRaw = {
  id: 105421,
  name: "Halo 3",
  summary: "The epic finale of the original Halo trilogy.",
  first_release_date: 1190352000, // 21 sep 2007 UTC
  cover: { image_id: "co1h2v" },
  genres: [
    { id: 5, name: "Shooter" },
    { id: 12, name: "Card & Board Game" }, // sin equivalencia -> keywords
  ],
  platforms: [
    { id: 6, name: "Xbox 360" },
    { id: 49, name: "Sega Saturn" }, // sin equivalencia -> keywords
  ],
  game_modes: [
    { id: 1, name: "Single player" },
    { id: 2, name: "Multiplayer" },
  ],
  player_perspectives: [{ id: 1, name: "First person" }],
  keywords: [
    { id: 7, name: "sci-fi" },
    { id: 8, name: "aliens" },
  ],
  themes: [
    { id: 17, name: "Horror" },
    { id: 7, name: "sci-fi" },
  ], // "sci-fi" duplicado
  involved_companies: [
    {
      id: 1,
      company: { id: 10, name: "Bungie" },
      developer: true,
      publisher: false,
    },
    {
      id: 2,
      company: { id: 11, name: "Microsoft Game Studios" },
      developer: false,
      publisher: true,
    },
    {
      id: 3,
      company: { id: 12, name: "Destiny devs" },
      developer: true,
      publisher: false,
    },
    {
      id: 4,
      company: { id: 13, name: "   " },
      developer: true,
      publisher: false,
    }, // basura: se filtra
  ],
};

// Juego mínimo: solo lo imprescindible que IGDB siempre devuelve
const MINIMAL_GAME: IgdbGameRaw = {
  id: 999,
  name: "Pokémon Rojo",
};

describe("mapIGDBGame", () => {
  it("maps a complete game into the TMWTP domain", () => {
    const game = mapIGDBGame(FULL_GAME);

    expect(game.title).toBe("Halo 3");
    expect(game.slug).toBe("halo-3-2007");
    expect(game.releaseYear).toBe(2007);
    expect(game.coverUrl).toBe(
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co1h2v.jpg",
    );
    expect(game.genres).toEqual(["SHOOTER", "CARD_AND_BOARD_GAME"]);
    expect(game.themes).toEqual(["HORROR"]);
    expect(game.platforms).toEqual(["XBOX_360"]);
    expect(game.gameModes).toEqual(["SINGLE_PLAYER", "MULTIPLAYER"]);
    expect(game.perspectives).toEqual(["FIRST_PERSON"]);
    // Múltiples developers/publishers, dedupe y filtrado de vacíos
    expect(game.developers).toEqual(["Bungie", "Destiny devs"]);
    expect(game.publishers).toEqual(["Microsoft Game Studios"]);
  });

  it("never discards data: unclassified enums and themes go to keywords", () => {
    const game = mapIGDBGame(FULL_GAME);

    // keywords IGDB + unclassified (platforma Sega Saturn, theme "sci-fi"),
    // dedupe case-insensitive y en orden de llegada: sin duplicar "sci-fi"
    expect(game.keywords).toEqual(["sci-fi", "aliens", "Sega Saturn"]);
  });

  it("maps a minimal game: everything absent becomes null, UNKNOWN or []", () => {
    const game = mapIGDBGame(MINIMAL_GAME);

    expect(game.title).toBe("Pokémon Rojo");
    expect(game.slug).toBe("pokemon-rojo"); // sin año -> sin sufijo
    expect(game.releaseYear).toBeNull();
    expect(game.coverUrl).toBeNull();
    expect(game.genres).toEqual(["UNKNOWN"]);
    expect(game.platforms).toEqual(["UNKNOWN"]);
    expect(game.gameModes).toEqual(["UNKNOWN"]);
    expect(game.perspectives).toEqual(["UNKNOWN"]);
    expect(game.keywords).toEqual([]);
    expect(game.developers).toEqual([]);
    expect(game.publishers).toEqual([]);
  });

  it("leaves description_es, description_en and all semantic dimensions as null", () => {
    const game = mapIGDBGame(FULL_GAME);

    expect(game.description_es).toBeNull();
    expect(game.description_en).toBeNull();
    expect(game.difficulty).toBeNull();
    expect(game.pace).toBeNull();
    expect(game.narrative).toBeNull();
    expect(game.complexity).toBeNull();
    expect(game.coziness).toBeNull();
    expect(game.strategy).toBeNull();
    expect(game.exploration).toBeNull();
    expect(game.violence).toBeNull();
    expect(game.horror).toBeNull();
    expect(game.darkness).toBeNull();
    expect(game.tension).toBeNull();
    expect(game.humor).toBeNull();
    expect(game.isolation).toBeNull();
  });

  it("returns null cover when the game has no cover at all", () => {
    const game = mapIGDBGame({ ...FULL_GAME, cover: undefined });
    expect(game.coverUrl).toBeNull();
  });
});
