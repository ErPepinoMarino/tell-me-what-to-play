import { describe, expect, it } from "vitest";
import type { IgdbClient, IgdbGameRaw } from "../../src/igdb/types.js";
import type {
  Candidate,
  Game,
  IgdbGame,
  IgdbGameToPersist,
} from "../../src/types/Game.js";
import {
  ImportService,
  type EnrichmentService,
  type GameRepository,
} from "../../src/services/importService.js";
import type { EnrichmentResult } from "../../src/services/enrichmentService.js";
import type { Semantic } from "../../src/types/GameEnrichment.js";

const FULL_SEMANTIC: Semantic = {
  difficulty: 0.5,
  pace: 0.5,
  narrative: 0.5,
  complexity: 0.5,
  coziness: 0.5,
  strategy: 0.5,
  exploration: 0.5,
  violence: 0.5,
  horror: 0.5,
  darkness: 0.5,
  tension: 0.5,
  humor: 0.5,
  isolation: 0.5,
};

// ─── Fakes ───────────────────────────────────────────────────────────────

class FakeIgdbClient implements IgdbClient {
  constructor(private games: IgdbGameRaw[]) {}
  async fetchGames(): Promise<IgdbGameRaw[]> {
    return [];
  }
  async searchGames(): Promise<IgdbGameRaw[]> {
    return this.games;
  }
  async fetchGamesByIds(ids: number[]): Promise<IgdbGameRaw[]> {
    return this.games.filter((game) => ids.includes(game.id));
  }
  async filteredSearch(): Promise<IgdbGameRaw[]> {
    return this.games;
  }
  async fetchAllKeywords(): Promise<{ id: number; name: string; slug: string }[]> {
    return [];
  }
  async fetchThemesByGameIds(): Promise<{ id: number; themes?: { name: string }[] }[]> {
    return [];
  }
}

class FakeEnrichmentService implements EnrichmentService {
  async enrich(): Promise<EnrichmentResult> {
    return {
      editable: {
        description_es: "Enriched description ES",
        description_en: "Enriched description EN",
        semantic: FULL_SEMANTIC,
      },
      additionalKeywords: [],
    };
  }
}

class FakeRepository implements GameRepository {
  public created: IgdbGameToPersist[] = [];
  constructor(private existingBySlug: Record<string, Game> = {}) {}
  async getBySlug(slug: string): Promise<Game | undefined> {
    return this.existingBySlug[slug];
  }
  async createIgdb(game: IgdbGameToPersist): Promise<IgdbGame> {
    this.created.push(game);
    return {
      id: this.created.length,
      searchCount: 0,
      ...game,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function rawGame(
  id: number,
  name: string,
  extra: Partial<IgdbGameRaw> = {},
): IgdbGameRaw {
  return { id, name, ...extra };
}

function makeExistingGame(
  overrides: Partial<Omit<IgdbGame, "keywords">> = {},
): Game {
  return {
    provenance: "igdb",
    id: 1,
    slug: "hollow-knight",
    sourceId: "100",
    title: "Hollow Knight",
    description_es: null,
    description_en: null,
    coverUrl: null,
    releaseYear: null,
    genres: ["UNKNOWN"],
    themes: ["UNKNOWN"],
    platforms: ["UNKNOWN"],
    gameModes: ["UNKNOWN"],
    perspectives: ["UNKNOWN"],
    keywords: [],
    developers: [],
    publishers: [],
    searchCount: 0,
    difficulty: null,
    pace: null,
    narrative: null,
    complexity: null,
    coziness: null,
    strategy: null,
    exploration: null,
    violence: null,
    horror: null,
    darkness: null,
    tension: null,
    humor: null,
    isolation: null,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("ImportService.importByQuery", () => {
  it("creates new games when no existing records match", async () => {
    const raws = [rawGame(100, "Hollow Knight"), rawGame(200, "Celeste")];
    const igdb = new FakeIgdbClient(raws);
    const enrichment = new FakeEnrichmentService();
    const repo = new FakeRepository();
    const service = new ImportService(igdb, enrichment, repo);

    const result = await service.importByQuery("metroidvania", 10);

    expect(result).toEqual({ created: 2, skipped: 0, errors: [] });
    expect(repo.created).toHaveLength(2);
    expect(repo.created[0].sourceId).toBe("100");
    expect(repo.created[1].sourceId).toBe("200");
    expect(repo.created[0].description_es).toBe("Enriched description ES");
    expect(repo.created[0].description_en).toBe("Enriched description EN");
  });

  it("skips when the same slug already exists", async () => {
    const raws = [rawGame(100, "Hollow Knight")];
    const existing = makeExistingGame();
    const igdb = new FakeIgdbClient(raws);
    const enrichment = new FakeEnrichmentService();
    const repo = new FakeRepository({ "hollow-knight": existing });
    const service = new ImportService(igdb, enrichment, repo);

    const result = await service.importByQuery("metroidvania", 10);

    expect(result).toEqual({ created: 0, skipped: 1, errors: [] });
    expect(repo.created).toHaveLength(0);
  });

  it("calls enrichment only for new candidates", async () => {
    const raws = [rawGame(100, "Hollow Knight"), rawGame(200, "Celeste")];
    const existing = makeExistingGame();
    const igdb = new FakeIgdbClient(raws);
    const repo = new FakeRepository({ "hollow-knight": existing });

    let enrichCalls = 0;
    const enrichment: EnrichmentService = {
      enrich: async () => {
        enrichCalls++;
        return {
          editable: {
            description_es: "Enriched",
            description_en: "Enriched",
            semantic: FULL_SEMANTIC,
          },
          additionalKeywords: [],
        };
      },
    };

    const service = new ImportService(igdb, enrichment, repo);
    await service.importByQuery("test", 10);

    expect(enrichCalls).toBe(1);
  });

  it("records error and continues when enrichment fails", async () => {
    const raws = [
      rawGame(100, "Hollow Knight"),
      rawGame(200, "Broken Game"),
      rawGame(300, "Celeste"),
    ];
    const existing = makeExistingGame();
    const repo = new FakeRepository({ "hollow-knight": existing });

    const enrichment: EnrichmentService = {
      enrich: async (candidate: Candidate) => {
        if (candidate.slug === "broken-game") {
          throw new Error("Web search failed");
        }
        return {
          editable: {
            description_es: "Enriched",
            description_en: "Enriched",
            semantic: FULL_SEMANTIC,
          },
          additionalKeywords: [],
        };
      },
    };

    const igdb = new FakeIgdbClient(raws);
    const service = new ImportService(igdb, enrichment, repo);

    const result = await service.importByQuery("test", 10);

    expect(result.created).toBe(1); // celeste
    expect(result.skipped).toBe(1); // hollow-knight (exists)
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].rawId).toBe(200);
    expect(result.errors[0].error.message).toBe("Web search failed");
  });

  it("propagates error from searchGames", async () => {
    const igdb = new FakeIgdbClient([]);
    igdb.searchGames = async () => {
      throw new Error("IGDB timeout");
    };
    const enrichment = new FakeEnrichmentService();
    const repo = new FakeRepository();
    const service = new ImportService(igdb, enrichment, repo);

    await expect(service.importByQuery("test", 10)).rejects.toThrow(
      "IGDB timeout",
    );
    expect(repo.created).toHaveLength(0);
  });

  it("skips non-independent records (mod/port/bundle) and imports only the main game", async () => {
    const raws = [
      rawGame(365702, "Hollow Knight", { game_type: 5 }), // PS Vita unofficial port (Mod)
      rawGame(351296, "Dead Cells+", { game_type: 3 }), // Bundle
      rawGame(14593, "Hollow Knight", { game_type: 0 }), // main game
    ];
    const igdb = new FakeIgdbClient(raws);
    const enrichment = new FakeEnrichmentService();
    const repo = new FakeRepository();
    const service = new ImportService(igdb, enrichment, repo);

    const result = await service.importByQuery("hollow knight", 10);

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(2);
    expect(repo.created).toHaveLength(1);
    expect(repo.created[0].sourceId).toBe("14593");
  });

  it("does not deduplicate by title/year: original and remake both import", async () => {
    const raws = [
      rawGame(880, "Resident Evil 2", { game_type: 0 }), // 1998 original
      rawGame(19686, "Resident Evil 2", { game_type: 8 }), // 2019 remake
    ];
    const igdb = new FakeIgdbClient(raws);
    const enrichment = new FakeEnrichmentService();
    const repo = new FakeRepository();
    const service = new ImportService(igdb, enrichment, repo);

    const result = await service.importByQuery("resident evil 2", 10);

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(repo.created[0].sourceId).toBe("880");
    expect(repo.created[1].sourceId).toBe("19686");
  });
});
