import { describe, expect, it } from "vitest";
import {
  extractYear,
  generateSlug,
  normalizeGameModes,
  normalizeGenres,
  normalizePerspectives,
  normalizePlatforms,
  normalizeThemes,
  redirectKeywordsToEnumFields,
} from "../../src/igdb/normalizers.js";
import type { GameSearchIntent } from "../../src/types/GameSearchIntent.js";

// 1 ene 2022 00:00:00 UTC
const EPOCH_2022 = 1640995200;
// 31 dic 2022 23:30:00 UTC (última hora del año)
const EPOCH_END_2022 = 1672529400;

describe("extractYear", () => {
  it("converts a valid epoch timestamp into its calendar year", () => {
    expect(extractYear(EPOCH_2022)).toBe(2022);
  });

  it("returns null for an absent date (undefined), never invents data", () => {
    expect(extractYear(undefined)).toBeNull();
  });

  it("uses UTC: a game released on Dec 31st late in the day belongs to that year", () => {
    // Con getFullYear() y una timezone local UTC+14, esto daría 2023.
    expect(extractYear(EPOCH_END_2022)).toBe(2022);
  });

  it("returns null for invalid timestamps instead of propagating garbage", () => {
    expect(extractYear(Number.NaN)).toBeNull();
  });
});

describe("normalizeGenres", () => {
  it("maps known IGDB genre names to TMWTP Genre enums (1:1 con IGDB)", () => {
    const result = normalizeGenres(["Shooter", "Role-playing (RPG)", "Platform"]);
    expect(result.values).toEqual(["SHOOTER", "ROLE_PLAYING_RPG", "PLATFORM"]);
  });

  it("no mapea nombres desconocidos a valores de enum (no se inventa nada)", () => {
    const result = normalizeGenres(["Shooter", "Whatever"]);
    expect(result.values).toEqual(["SHOOTER"]);
  });

  it("returns empty results for absent or empty input", () => {
    expect(normalizeGenres(undefined)).toEqual({ values: [] });
    expect(normalizeGenres([])).toEqual({ values: [] });
  });

  it("deduplicates genres while preserving order", () => {
    const result = normalizeGenres(["Shooter", "Shooter"]);
    expect(result.values).toEqual(["SHOOTER"]);
  });

  it("rejects genre names that IGDB does not have (Action/Casual/MMO)", () => {
    const result = normalizeGenres(["Action", "Casual", "Massively Multiplayer"]);
    expect(result.values).toEqual([]);
  });
});

describe("normalizeThemes", () => {
  it("maps real IGDB theme names to TMWTP Theme enums", () => {
    const result = normalizeThemes(["Horror", "Action", "Science fiction", "Open world"]);
    expect(result.values).toEqual([
      "HORROR",
      "ACTION",
      "SCIENCE_FICTION",
      "OPEN_WORLD",
    ]);
  });

  it("no mapea themes desconocidos a valores de enum", () => {
    const result = normalizeThemes(["Horror", "Whatever"]);
    expect(result.values).toEqual(["HORROR"]);
  });
});

describe("normalizePlatforms", () => {
  it("maps real IGDB platform names to TMWTP Platform enums", () => {
    const result = normalizePlatforms([
      "PC (Microsoft Windows)",
      "Nintendo 3DS",
      "Xbox Series X|S",
    ]);
    expect(result.values).toEqual(["PC", "NINTENDO_3DS", "XBOX_SERIES"]);
  });

  it("no mapea plataformas sin equivalencia TMWTP a valores de enum", () => {
    const result = normalizePlatforms(["PC (Microsoft Windows)", "Sega Saturn", "Ouya"]);
    expect(result.values).toEqual(["PC"]);
  });

  it("returns empty results for absent or empty input", () => {
    expect(normalizePlatforms(undefined)).toEqual({ values: [] });
    expect(normalizePlatforms([])).toEqual({ values: [] });
  });

  it("deduplicates platforms while preserving order", () => {
    // "Game Boy" y "Game Boy Color" son la misma plataforma TMWTP
    const result = normalizePlatforms(["Game Boy", "Game Boy Color"]);
    expect(result.values).toEqual(["GAME_BOY"]);
  });
});

describe("normalizeGameModes", () => {
  it("maps real IGDB game mode names, collapsing Split screen into MULTIPLAYER y MMO aparte", () => {
    const result = normalizeGameModes([
      "Single player",
      "Co-operative",
      "Split screen",
      "Massively Multiplayer Online (MMO)",
    ]);
    expect(result.values).toEqual([
      "SINGLE_PLAYER",
      "COOPERATIVE",
      "MULTIPLAYER",
      "MASSIVELY_MULTIPLAYER",
    ]);
  });

  it("no mapea modos de juego desconocidos a valores de enum", () => {
    const result = normalizeGameModes(["Single player", "Battle Royale"]);
    expect(result.values).toEqual(["SINGLE_PLAYER"]);
  });

  it("returns empty results for absent or empty input", () => {
    expect(normalizeGameModes(undefined)).toEqual({ values: [] });
  });
});

describe("normalizePerspectives", () => {
  it("maps real IGDB perspective names to TMWTP Perspective enums", () => {
    const result = normalizePerspectives(["First person", "Side view", "Text"]);
    expect(result.values).toEqual(["FIRST_PERSON", "SIDE_VIEW", "TEXT"]);
  });

  it("no mapea perspectivas solo-IGDB a valores de enum", () => {
    const result = normalizePerspectives(["First person", "Virtual Reality", "Auditory"]);
    expect(result.values).toEqual(["FIRST_PERSON"]);
  });

  it("returns empty results for absent or empty input", () => {
    expect(normalizePerspectives(undefined)).toEqual({ values: [] });
  });
});

describe("generateSlug", () => {
  it("lowercases, removes accents and replaces symbols with dashes", () => {
    expect(generateSlug("Pokémon: Let's Go!", null)).toBe("pokemon-let-s-go");
  });

  it("appends the year as suffix when available", () => {
    expect(generateSlug("Elden Ring", 2022)).toBe("elden-ring-2022");
  });

  it("does not append anything when the year is absent", () => {
    expect(generateSlug("Halo", null)).toBe("halo");
  });

  it("collapses consecutive non-alphanumeric characters into a single dash", () => {
    expect(generateSlug("The  Legend   of --- Zelda!!", 2017)).toBe(
      "the-legend-of-zelda-2017",
    );
  });

  it("trims leading and trailing dashes from symbols at the edges", () => {
    expect(generateSlug("!!!DOOM!!!", 1993)).toBe("doom-1993");
  });
});

describe("redirectKeywordsToEnumFields", () => {
  const objective = (over: Partial<NonNullable<GameSearchIntent["objective"]>> = {}) => ({
    genres: null,
    themes: null,
    platforms: null,
    gameModes: null,
    perspectives: null,
    ...over,
  });

  it("rescata un theme de keywords y lo coloca en objective.themes", () => {
    const out = redirectKeywordsToEnumFields({
      gameReferenced: null,
      objective: objective(),
      keywords: ["horror"],
      releaseYear: null,
      yearFrom: null,
      yearTo: null,
      excluded: null,
      relation: null,
      semantic: null,
    });
    expect(out.objective?.themes).toEqual(["HORROR"]);
    expect(out.keywords).toBeNull();
  });

  it("rescata géneros, plataformas, modos y perspectivas (5 vocabularios)", () => {
    const out = redirectKeywordsToEnumFields({
      gameReferenced: null,
      objective: objective(),
      keywords: ["rpg", "pc", "co-op", "first person", "horror"],
      releaseYear: null,
      yearFrom: null,
      yearTo: null,
      excluded: null,
      relation: null,
      semantic: null,
    });
    expect(out.objective?.genres).toEqual(["ROLE_PLAYING_RPG"]);
    expect(out.objective?.platforms).toEqual(["PC"]);
    expect(out.objective?.gameModes).toEqual(["COOPERATIVE"]);
    expect(out.objective?.perspectives).toEqual(["FIRST_PERSON"]);
    expect(out.objective?.themes).toEqual(["HORROR"]);
    expect(out.keywords).toBeNull();
  });

  it("conserva keywords reales (vocabulario abierto) sin tocar", () => {
    const out = redirectKeywordsToEnumFields({
      gameReferenced: null,
      objective: objective(),
      keywords: ["steampunk", "pirates"],
      releaseYear: null,
      yearFrom: null,
      yearTo: null,
      excluded: null,
      relation: null,
      semantic: null,
    });
    expect(out.keywords).toEqual(["steampunk", "pirates"]);
    expect(out.objective).toEqual(objective());
  });

  it("no duplica un enum ya presente en la lista", () => {
    const out = redirectKeywordsToEnumFields({
      gameReferenced: null,
      objective: objective({ themes: ["HORROR"] }),
      keywords: ["horror", "pirates"],
      releaseYear: null,
      yearFrom: null,
      yearTo: null,
      excluded: null,
      relation: null,
      semantic: null,
    });
    expect(out.objective?.themes).toEqual(["HORROR"]);
    expect(out.keywords).toEqual(["pirates"]);
  });

  it("devuelve el intent intacto sin keywords", () => {
    const intent: GameSearchIntent = {
      gameReferenced: null,
      objective: null,
      keywords: null,
      releaseYear: null,
      yearFrom: null,
      yearTo: null,
      excluded: null,
      relation: null,
      semantic: null,
    };
    expect(redirectKeywordsToEnumFields(intent)).toBe(intent);
  });

  it("no envia un falso positivo: 'sport fishing' no se convierte en genre SPORT", () => {
    const out = redirectKeywordsToEnumFields({
      gameReferenced: null,
      objective: objective(),
      keywords: ["sport fishing"],
      releaseYear: null,
      yearFrom: null,
      yearTo: null,
      excluded: null,
      relation: null,
      semantic: null,
    });
    expect(out.keywords).toEqual(["sport fishing"]);
    expect(out.objective?.genres).toBeNull();
  });
});