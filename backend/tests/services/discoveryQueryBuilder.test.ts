import { describe, expect, it, vi } from "vitest";
import { DiscoveryQueryBuilder } from "../../src/orchestrator/discoveryQueryBuilder.js";
import { RECOMMENDATION_CONFIG } from "../../src/recommendation/constants.js";
import { FakeIgdbClient, makeIntent, makeRaw } from "../helpers/fakes.js";

function makeBuilder(options: {
  resolveIds?: (terms: string[]) => Promise<Map<string, number | null>>;
} = {}) {
  const igdb = new FakeIgdbClient({});
  const builder = new DiscoveryQueryBuilder(
    igdb,
    RECOMMENDATION_CONFIG,
    options.resolveIds ? { resolveIds: options.resolveIds } : undefined,
  );
  return { igdb, builder };
}

describe("DiscoveryQueryBuilder.filteredSearch", () => {
  it("traduce el intent a FilteredSearchOptions y ejecuta igdb.filteredSearch", async () => {
    const { igdb, builder } = makeBuilder({
      resolveIds: async (terms) =>
        new Map(terms.map((term) => [term, term === "pirates" ? 42 : null])),
    });
    igdb.filteredResults = [makeRaw(101, "Pirate Gold")];

    const intent = makeIntent({
      keywords: ["pirates"],
      objective: {
        genres: ["ROLE_PLAYING_RPG"],
        themes: ["HORROR"],
        platforms: ["PC"],
        gameModes: ["SINGLE_PLAYER", "COOPERATIVE"],
        perspectives: ["FIRST_PERSON"],
      },
      releaseYear: 2007,
      yearFrom: null,
      yearTo: null,
      excluded: {
        keywords: ["zombies"],
        genres: ["SHOOTER"],
        themes: ["HORROR"],
        platforms: null,
        gameModes: null,
        perspectives: null,
        releaseYear: null,
        yearFrom: null,
        yearTo: null,
      },
    });

    const result = await builder.filteredSearch(intent);

    expect(result).toEqual(igdb.filteredResults);
    const options = igdb.filteredCalls[0];
    expect(options.keywordIds).toEqual([42]);
    expect(options.excludeKeywordIds).toEqual([]); // "zombies" sin id en el léxico
    expect(options.genreIgbNames).toEqual(["Role-playing (RPG)"]);
    expect(options.themeIds).toEqual([19]); // HORROR
    expect(options.platformIgbNames).toEqual(["PC (Microsoft Windows)"]);
    expect(options.gameModeIgbNames).toEqual(["Single player", "Co-operative"]);
    expect(options.perspectiveIgbNames).toEqual(["First person"]);
    expect(options.excludeThemeIds).toEqual([19]);
    expect(options.excludeGenreIgbNames).toEqual(["Shooter"]);
    expect(options.releaseYear).toBe(2007);
    expect(options.limit).toBe(RECOMMENDATION_CONFIG.igdbSearchLimit);
    expect(options.offset).toBeUndefined();
  });

  it("añade offset solo cuando es > 0 (la primera página no cambia)", async () => {
    const { igdb, builder } = makeBuilder();

    await builder.filteredSearch(makeIntent(), undefined, 30);
    expect(igdb.filteredCalls[0].offset).toBe(30);

    await builder.filteredSearch(makeIntent());
    expect(igdb.filteredCalls[1].offset).toBeUndefined();
  });

  it("onFilterDropped reenvía a la traza como taxonomy-unresolved", async () => {
    const { igdb, builder } = makeBuilder();
    const trace = vi.fn();

    await builder.filteredSearch(makeIntent(), trace);

    const onFilterDropped = igdb.filteredCalls[0].onFilterDropped;
    expect(typeof onFilterDropped).toBe("function");
    onFilterDropped?.({ field: "genres", terms: ["Whatever"] });
    expect(trace).toHaveBeenCalledWith("taxonomy-unresolved", {
      field: "genres",
      terms: ["Whatever"],
    });
  });
});

describe("DiscoveryQueryBuilder.broadSearch", () => {
  it("usa el primer keyword como texto y niega los red flags", async () => {
    const { igdb, builder } = makeBuilder();
    igdb.filteredResults = [makeRaw(201, "Cowboy")];
    const intent = makeIntent({
      keywords: ["pirates", "cowboys"],
      excluded: {
        keywords: null,
        genres: ["SHOOTER"],
        themes: ["HORROR"],
        platforms: null,
        gameModes: null,
        perspectives: null,
        releaseYear: null,
        yearFrom: null,
        yearTo: null,
      },
    });

    const result = await builder.broadSearch("pirates rpg", intent);

    expect(result).toEqual(igdb.filteredResults);
    const options = igdb.filteredCalls[0];
    expect(options.text).toBe("pirates"); // primer keyword
    expect(options.excludeGenreIgbNames).toEqual(["Shooter"]);
    expect(options.excludeThemeIds).toEqual([19]);
    expect(options.limit).toBe(RECOMMENDATION_CONFIG.igdbBroadSearchLimit);
  });

  it("sin keywords cae al trim del query (o undefined si vacío)", async () => {
    const { igdb, builder } = makeBuilder();

    await builder.broadSearch("   ", makeIntent());
    expect(igdb.filteredCalls[0].text).toBeUndefined();

    await builder.broadSearch("mario", makeIntent());
    expect(igdb.filteredCalls[1].text).toBe("mario");
  });
});