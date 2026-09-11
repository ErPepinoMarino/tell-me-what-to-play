import type {
  FilteredSearchOptions,
  IgdbClient,
  IgdbGameRaw,
} from "../../src/igdb/types.js";
import {
  brandStoredIgdbKeywords,
  extractIgdbKeywords,
} from "../../src/igdb/keywords.js";
import { mintSearchKeywords } from "../../src/matching/keywords.js";
import type {
  Candidate,
  CuratedGame,
  CuratedGameToPersist,
  Game,
  IgdbGame,
  IgdbGameToPersist,
} from "../../src/types/Game.js";
import type {
  GameEnrichment,
  Semantic,
} from "../../src/types/GameEnrichment.js";
import type { GameSearchIntent } from "../../src/types/GameSearchIntent.js";
import type {
  EnrichmentResult,
  EnrichmentService,
  EnrichmentUpdater,
} from "../../src/services/enrichmentService.js";
import type { CatalogLayer, CacheLayer, ReEnrichPatch } from "../../src/orchestrator/types.js";
import type { BudgetLimits } from "../../src/budget/budgetLedger.js";

export const FULL_SEMANTIC: Semantic = {
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

export const NULL_SEMANTIC: Semantic = {
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

export function makeGame(
  overrides: Partial<Omit<IgdbGame, "keywords">> & { keywords?: string[] } & Pick<IgdbGame, "id">,
): IgdbGame {
  const { keywords = [], ...rest } = overrides;
  return {
    slug: `game-${overrides.id}`,
    title: `Game ${overrides.id}`,
    description_es: null,
    description_en: null,
    coverUrl: null,
    releaseYear: 2020,
    genres: ["UNKNOWN"],
    themes: ["UNKNOWN"],
    platforms: ["PC"],
    gameModes: ["UNKNOWN"],
    perspectives: ["UNKNOWN"],
    provenance: "igdb",
    keywords: brandStoredIgdbKeywords(keywords),
    developers: [],
    publishers: [],
    searchCount: 0,
    sourceId: String(overrides.id),
    ...NULL_SEMANTIC,
    ...rest,
  };
}

export function makeIntent(
  overrides: Partial<GameSearchIntent> = {},
): GameSearchIntent {
  return {
    gameReferenced: null,
    objective: null,
    keywords: null,
    releaseYear: null,
    yearFrom: null,
    yearTo: null,
    excluded: null,
    relation: null,
    semantic: null,
    ...overrides,
  };
}

export function makeRaw(
  id: number,
  name: string,
  overrides: Partial<IgdbGameRaw> = {},
): IgdbGameRaw {
  return {
    id,
    name,
    keywords: [{ id, name: "pirates" }],
    ...overrides,
  };
}

export function makeGameEnrichment(
  overrides: Partial<GameEnrichment> = {},
): GameEnrichment {
  return {
    semantic: FULL_SEMANTIC,
    additionalKeywords: ["extra"],
    description_es: "Un juego de piratas.",
    description_en: "A pirate game.",
    ...overrides,
  };
}

function overlap(a: string[], b: string[]): boolean {
  return a.some((value) => b.includes(value));
}

function overlapKeywords(a: readonly string[], b: readonly string[]): boolean {
  const normalizedA = a.map((k) => k.toLowerCase());
  return b.some((k) => normalizedA.includes(k.toLowerCase()));
}

export class FakeCatalogLayer implements CatalogLayer {
  private byId = new Map<number, Game>();
  private nextId = 1;
  createCalls = 0;
  updateCalls = 0;
  findCandidatesCalls = 0;
  searchCountIncrements: number[][] = [];

  seed(games: Game[]): void {
    for (const game of games) {
      this.byId.set(game.id, game);
    }
    this.nextId = Math.max(0, ...games.map((g) => g.id)) + 1;
  }

  get(id: number): Game | undefined {
    return this.byId.get(id);
  }

  all(): Game[] {
    return [...this.byId.values()];
  }

  async findCandidates(filter: {
    genres: string[];
    themes: string[];
    keywords: string[];
    platforms: string[];
    gameModes?: string[];
    perspectives?: string[];
    limit: number;
  }): Promise<Game[]> {
    this.findCandidatesCalls++;
    const all = this.all();
    const hasSignals =
      filter.genres.length > 0 ||
      filter.themes.length > 0 ||
      filter.keywords.length > 0 ||
      filter.platforms.length > 0 ||
      (filter.gameModes ?? []).length > 0 ||
      (filter.perspectives ?? []).length > 0;
    if (!hasSignals) return all.slice(0, filter.limit);

    const matching = all.filter(
      (game) =>
        overlap(game.genres, filter.genres) ||
        overlap(game.themes, filter.themes) ||
        overlap(game.platforms, filter.platforms) ||
        overlap(game.gameModes, filter.gameModes ?? []) ||
        overlap(game.perspectives, filter.perspectives ?? []) ||
        overlapKeywords(game.keywords, filter.keywords),
    );
    return (matching.length > 0 ? matching : all).slice(0, filter.limit);
  }

  async getBySlugs(slugs: string[]): Promise<Map<string, Game>> {
    const result = new Map<string, Game>();
    for (const slug of slugs) {
      const game = [...this.byId.values()].find((g) => g.slug === slug);
      if (game) result.set(slug, game);
    }
    return result;
  }

  async getBySlug(slug: string): Promise<Game | undefined> {
    return this.all().find((game) => game.slug === slug);
  }

  async getBySourceId(sourceId: string): Promise<Game | undefined> {
    return this.all().find((game) => game.sourceId === sourceId);
  }

  async searchByTitle(query: string): Promise<Game[]> {
    const normalized = query.toLowerCase();
    return this.all().filter((game) =>
      game.title.toLowerCase().includes(normalized),
    );
  }

  async createIgdb(game: IgdbGameToPersist): Promise<IgdbGame> {
    this.createCalls++;
    const created: IgdbGame = {
      ...game,
      provenance: "igdb",
      id: this.nextId++,
      searchCount: 0,
    };
    this.byId.set(created.id, created);
    return created;
  }

  async createCurated(game: CuratedGameToPersist): Promise<CuratedGame> {
    this.createCalls++;
    const created: CuratedGame = {
      ...game,
      provenance: "curated",
      id: this.nextId++,
      searchCount: 0,
    };
    this.byId.set(created.id, created);
    return created;
  }

  async syncCatalogKeywords(
    game: IgdbGame,
    raw: IgdbGameRaw,
  ): Promise<IgdbGame> {
    const updated: IgdbGame = {
      ...game,
      keywords: extractIgdbKeywords(raw),
    };
    this.byId.set(updated.id, updated);
    return updated;
  }

  async updateReEnrich(game: Game, patch: ReEnrichPatch): Promise<Game> {
    this.updateCalls++;
    const updated: Game = {
      ...game,
      description_es: patch.description_es,
      description_en: patch.description_en,
      sourceId: patch.sourceId !== undefined ? patch.sourceId : game.sourceId,
      coverUrl: patch.coverUrl ?? game.coverUrl,
      releaseYear: patch.releaseYear ?? game.releaseYear,
      genres: patch.genres ?? game.genres,
      themes: patch.themes ?? game.themes,
      platforms: patch.platforms ?? game.platforms,
      gameModes: patch.gameModes ?? game.gameModes,
      perspectives: patch.perspectives ?? game.perspectives,
      developers: patch.developers ?? game.developers,
      publishers: patch.publishers ?? game.publishers,
      difficulty: patch.semantic.difficulty ?? game.difficulty,
      pace: patch.semantic.pace ?? game.pace,
      narrative: patch.semantic.narrative ?? game.narrative,
      complexity: patch.semantic.complexity ?? game.complexity,
      coziness: patch.semantic.coziness ?? game.coziness,
      strategy: patch.semantic.strategy ?? game.strategy,
      exploration: patch.semantic.exploration ?? game.exploration,
      violence: patch.semantic.violence ?? game.violence,
      horror: patch.semantic.horror ?? game.horror,
      darkness: patch.semantic.darkness ?? game.darkness,
      tension: patch.semantic.tension ?? game.tension,
      humor: patch.semantic.humor ?? game.humor,
      isolation: patch.semantic.isolation ?? game.isolation,
    };
    this.byId.set(updated.id, updated);
    return updated;
  }

  async incrementSearchCounts(ids: number[]): Promise<void> {
    this.searchCountIncrements.push(ids);
    for (const id of ids) {
      const game = this.byId.get(id);
      if (game) game.searchCount++;
    }
  }

  async countGames(): Promise<number> {
    return this.byId.size;
  }
}

export class FakeCacheLayer implements CacheLayer {
  constructor(public games: Game[] = []) {}

  async getAll(): Promise<Game[]> {
    return [...this.games];
  }

  async searchByTitle(query: string): Promise<Game[]> {
    const normalized = query.toLowerCase();
    return this.games.filter((game) =>
      game.title.toLowerCase().includes(normalized),
    );
  }
}

export class FakeIgdbClient implements IgdbClient {
  calls: { query: string; limit: number }[] = [];
  filteredCalls: FilteredSearchOptions[] = [];
  filteredResults: IgdbGameRaw[] = [];

  constructor(
    private results: Record<string, IgdbGameRaw[]> = {},
    private error?: Error,
    private allById: IgdbGameRaw[] = [],
  ) {}

  async fetchGames(): Promise<IgdbGameRaw[]> {
    return [];
  }

  async searchGames(query: string, limit = 10): Promise<IgdbGameRaw[]> {
    this.calls.push({ query, limit });
    if (this.error) throw this.error;
    return (this.results[query] ?? []).slice(0, limit);
  }

  async fetchGamesByIds(ids: number[]): Promise<IgdbGameRaw[]> {
    return this.allById.filter((raw) => ids.includes(raw.id));
  }

  async filteredSearch(options: FilteredSearchOptions): Promise<IgdbGameRaw[]> {
    this.filteredCalls.push(options);
    if (this.error) throw this.error;
    const limit = options.limit ?? this.filteredResults.length;
    const offset = options.offset ?? 0;
    return this.filteredResults.slice(offset, offset + limit);
  }

  async fetchAllKeywords(): Promise<{ id: number; name: string; slug: string }[]> {
    return [];
  }

  async fetchThemesByGameIds(): Promise<{ id: number; themes?: { name: string }[] }[]> {
    return [];
  }
}

export class FakeEnrichment implements EnrichmentService, EnrichmentUpdater {
  enrichCalls: Candidate[] = [];
  enrichUpdateCalls: Candidate[] = [];

  constructor(
    private enrichment: GameEnrichment = makeGameEnrichment(),
    private fail = false,
  ) {}

  async enrich(candidate: Candidate): Promise<EnrichmentResult> {
    this.enrichCalls.push(candidate);
    if (this.fail) throw new Error("enrich failed");
    return {
      editable: {
        description_es: this.enrichment.description_es,
        description_en: this.enrichment.description_en,
        semantic: this.enrichment.semantic,
      },
      additionalKeywords: mintSearchKeywords(this.enrichment.additionalKeywords),
    };
  }

  async enrichForUpdate(candidate: Candidate): Promise<GameEnrichment> {
    this.enrichUpdateCalls.push(candidate);
    if (this.fail) throw new Error("enrich failed");
    return this.enrichment;
  }
}

export const HIGH_BUDGET: BudgetLimits = { igdb: 100, brave: 200, llm: 200 };
