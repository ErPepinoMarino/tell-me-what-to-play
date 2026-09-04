import { describe, expect, it, vi, afterEach } from "vitest";
import type { Candidate } from "../../src/types/Game.js";
import type {
  GameEnrichment,
  Semantic,
} from "../../src/types/GameEnrichment.js";
import type { ResearchProvider } from "../../src/services/research.js";
import {
  buildQueries,
  createEnrichmentService,
  EnrichmentServiceImpl,
  type EnrichmentModel,
} from "../../src/services/enrichmentService.js";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    sourceId: "105421",
    slug: "halo-3-2007",
    title: "Halo 3",
    releaseYear: 2007,
    genres: ["SHOOTER"],
    platforms: ["XBOX_360"],
    gameModes: ["SINGLE_PLAYER", "MULTIPLAYER"],
    perspectives: ["FIRST_PERSON"],
    keywords: ["sci-fi", "aliens"],
    developers: ["Bungie"],
    publishers: ["Microsoft Game Studios"],
    coverUrl:
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co1h2v.jpg",
    raw: {
      id: 105421,
      name: "Halo 3",
      summary: "The epic finale of the original Halo trilogy.",
      themes: [{ id: 7, name: "sci-fi" }],
    },
    ...overrides,
  };
}

const FULL_SEMANTIC: Semantic = {
  difficulty: 0.6,
  pace: 0.7,
  narrative: 0.3,
  complexity: 0.4,
  coziness: 0.1,
  strategy: 0.2,
  exploration: 0.4,
  violence: 0.9,
  horror: 0.2,
  darkness: 0.4,
  tension: 0.7,
  humor: 0.2,
  isolation: 0.1,
};

const NULL_SEMANTIC: Semantic = {
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
};

function makeEnrichment(
  overrides: Partial<GameEnrichment> = {},
): GameEnrichment {
  return {
    semantic: FULL_SEMANTIC,
    additionalKeywords: ["aliens", "space", "warthog"],
    description_es: "La épica conclusión de la trilogía.",
    description_en: "The epic conclusion of the trilogy.",
    ...overrides,
  };
}

class FakeResearchProvider implements ResearchProvider {
  private records: Record<string, string[]> = {};
  queries: string[] = [];
  add(query: string, snippets: string[]): void {
    this.records[query] = snippets;
  }
  async searchEvidence(
    query: string,
  ): Promise<{ source: string; snippet: string }[]> {
    this.queries.push(query);
    return (this.records[query] ?? ["Default evidence snippet."]).map(
      (snippet) => ({
        source: "fake-source",
        snippet,
      }),
    );
  }
}

function makeFakeModel(enrichment: GameEnrichment): EnrichmentModel {
  return { invoke: async () => enrichment };
}

describe("EnrichmentServiceImpl.enrich", () => {
  it("builds a complete GameToPersist from a candidate and the enrichment output", async () => {
    const research = new FakeResearchProvider();
    const model = makeFakeModel(makeEnrichment());
    const service = new EnrichmentServiceImpl(research, model);

    const result = await service.enrich(makeCandidate());

    expect(result.title).toBe("Halo 3");
    expect(result.slug).toBe("halo-3-2007");
    expect(result.sourceId).toBe("105421");
    expect(result.releaseYear).toBe(2007);
    expect(result.genres).toEqual(["SHOOTER"]);
    expect(result.platforms).toEqual(["XBOX_360"]);
    expect(result.developers).toEqual(["Bungie"]);
    expect(result.publishers).toEqual(["Microsoft Game Studios"]);
    expect(result.coverUrl).toBe(
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co1h2v.jpg",
    );
    expect(result.description_es).toBe("La épica conclusión de la trilogía.");
    expect(result.description_en).toBe("The epic conclusion of the trilogy.");
  });

  it("copies the semantic scores from the enrichment output", async () => {
    const research = new FakeResearchProvider();
    const model = makeFakeModel(makeEnrichment());
    const service = new EnrichmentServiceImpl(research, model);

    const result = await service.enrich(makeCandidate());

    expect(result.difficulty).toBe(0.6);
    expect(result.violence).toBe(0.9);
    expect(result.tension).toBe(0.7);
    expect(result.humor).toBe(0.2);
  });

  it("keeps semantics null when the enrichment has no evidence-based values", async () => {
    const research = new FakeResearchProvider();
    const model = makeFakeModel(makeEnrichment({ semantic: NULL_SEMANTIC }));
    const service = new EnrichmentServiceImpl(research, model);

    const result = await service.enrich(makeCandidate());

    expect(result.difficulty).toBeNull();
    expect(result.pace).toBeNull();
    expect(result.horror).toBeNull();
    expect(result.isolation).toBeNull();
  });

  it("merges additional keywords, deduplicating against existing candidate keywords", async () => {
    const research = new FakeResearchProvider();
    // "aliens" ya existe en el candidate -> se descarta; "space" y "warthog" se añaden
    const model = makeFakeModel(
      makeEnrichment({ additionalKeywords: ["aliens", "space", "warthog"] }),
    );
    const service = new EnrichmentServiceImpl(research, model);

    const result = await service.enrich(makeCandidate());

    expect(result.keywords).toEqual(["sci-fi", "aliens", "space", "warthog"]);
  });

  it("merges deduplicating case-insensitively", async () => {
    const research = new FakeResearchProvider();
    const model = makeFakeModel(
      makeEnrichment({ additionalKeywords: ["Aliens", "SPACE", "warthog"] }),
    );
    const service = new EnrichmentServiceImpl(research, model);

    const result = await service.enrich(makeCandidate());

    expect(result.keywords).toEqual(["sci-fi", "aliens", "space", "warthog"]);
  });

  it("queries the research provider for evidence before calling the model", async () => {
    const research = new FakeResearchProvider();

    let captured: unknown;
    const model: EnrichmentModel = {
      invoke: async (messages) => {
        captured = messages;
        return makeEnrichment();
      },
    };
    const service = new EnrichmentServiceImpl(research, model);

    await service.enrich(makeCandidate());

    expect(research.queries).toHaveLength(2);
    const messages = captured as { role: string; content: string }[];
    const userMsg = messages.find((m) => m.role === "user")!;
    expect(userMsg.content).toContain("Default evidence snippet.");
  });
});

describe("buildQueries", () => {
  it("returns exactly two queries covering both evidence clusters", () => {
    expect(buildQueries(makeCandidate())).toEqual([
      "Halo 3 2007 Bungie review gameplay -walkthrough -wiki -cheats -download",
      "Halo 3 2007 Bungie story world atmosphere -walkthrough -wiki -cheats -download",
    ]);
  });

  it("adds the year only when releaseYear is present", () => {
    const [review] = buildQueries(makeCandidate({ releaseYear: null }));

    expect(review).toContain("Halo 3");
    expect(review).not.toContain("2007");
  });

  it("prioritizes the developer as the disambiguation anchor", () => {
    const [review] = buildQueries(
      makeCandidate({ developers: ["Bungie"], genres: ["SHOOTER"] }),
    );

    expect(review).toContain("Halo 3 2007 Bungie");
  });

  it("falls back to the genre term when there is no developer", () => {
    const [review] = buildQueries(
      makeCandidate({ developers: [], genres: ["SHOOTER"] }),
    );

    expect(review).toContain("Halo 3 2007 shooter");
  });

  it("falls back to the first keyword when there is no developer or known genre", () => {
    const [review] = buildQueries(
      makeCandidate({
        developers: [],
        genres: ["UNKNOWN"],
        keywords: ["sci-fi", "aliens"],
      }),
    );

    expect(review).toContain("Halo 3 2007 sci-fi");
  });

  it("omits the anchor when nothing is available", () => {
    const [review] = buildQueries(
      makeCandidate({ developers: [], genres: ["UNKNOWN"], keywords: [] }),
    );

    expect(review).toBe(
      "Halo 3 2007 review gameplay -walkthrough -wiki -cheats -download",
    );
  });

  it("always includes the noise exclusions in both queries", () => {
    for (const query of buildQueries(makeCandidate())) {
      for (const exclusion of [
        "-walkthrough",
        "-wiki",
        "-cheats",
        "-download",
      ]) {
        expect(query).toContain(exclusion);
      }
    }
  });
});

describe("createEnrichmentService", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds an EnrichmentServiceImpl when the API key is present", () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-api-key");

    const service = createEnrichmentService();

    expect(service).toBeInstanceOf(EnrichmentServiceImpl);
  });

  it("throws when the Brave Search API key is missing", () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");

    expect(() => createEnrichmentService()).toThrow(
      "BRAVE_SEARCH_API_KEY must be set",
    );
  });
});
