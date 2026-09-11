import { describe, expect, it, vi } from "vitest";
import {
  isSameIntent,
  RecommendationOrchestrator,
} from "../../src/orchestrator/recommendationOrchestrator.js";
import { DiscoveryManager } from "../../src/orchestrator/discovery.js";
import { InMemoryDiscoveryCacheRepository } from "../../src/orchestrator/discoveryCache.js";
import { InMemoryQueryOffsetStore } from "../../src/orchestrator/queryOffsetStore.js";
import { InMemoryBudgetLedger } from "../../src/budget/budgetLedger.js";
import {
  RECOMMENDATION_CONFIG,
  type RecommendationConfig,
} from "../../src/recommendation/constants.js";
import type { IntentExtractor } from "../../src/orchestrator/types.js";
import type { KeywordLexiconService } from "../../src/services/keywordLexiconService.js";
import type { IgdbGameRaw } from "../../src/igdb/types.js";
import type { Game } from "../../src/types/Game.js";
import type {
  GameSearchIntent,
  RefineDelta,
} from "../../src/types/GameSearchIntent.js";
import {
  FakeCacheLayer,
  FakeCatalogLayer,
  FakeEnrichment,
  FakeIgdbClient,
  FULL_SEMANTIC,
  makeGame,
  makeGameEnrichment,
  makeIntent,
  makeRaw,
  NULL_SEMANTIC,
} from "../helpers/fakes.js";

const USER = { kind: "user", userId: 1 } as const;
const ANON = { kind: "anon" } as const;

const PIRATES_INTENT: GameSearchIntent = makeIntent({
  keywords: ["pirates"],
  objective: {
    genres: ["ROLE_PLAYING_RPG"],
    themes: null,
    platforms: null,
    gameModes: null,
    perspectives: null,
  },
});

const PIRATES_GAME = makeGame({
  id: 1,
  slug: "pirates-cove",
  title: "Pirates Cove",
  genres: ["ROLE_PLAYING_RPG"],
  keywords: ["pirates"],
  ...FULL_SEMANTIC,
});

interface SetupOptions {
  catalogGames?: Game[];
  cacheGames?: Game[];
  intent: GameSearchIntent;
  igdbResults?: Record<string, IgdbGameRaw[]>;
  enrichment?: FakeEnrichment;
  config?: Partial<RecommendationConfig>;
  limits?: { igdb?: number; brave?: number; llm?: number };
  classifyRelation?: (message: string, previous?: GameSearchIntent) => Promise<"new" | "refine" | "nonsensical">;
  extractRefineDelta?: (
    message: string,
    previous: GameSearchIntent,
  ) => Promise<import("../../src/types/GameSearchIntent.js").RefineDelta>;
  lexicon?: {
    canonicalizeIntent(intent: GameSearchIntent): Promise<GameSearchIntent>;
    drainDropped(): { term: string; topMatch: string | null; similarity: number }[];
  };
}

function setup(options: SetupOptions) {
  const catalog = new FakeCatalogLayer();
  catalog.seed(options.catalogGames ?? []);
  const cache = new FakeCacheLayer(options.cacheGames ?? []);
  const extract = vi.fn(async () => options.intent);
  const intents: IntentExtractor = {
    extract,
    classifyRelation: options.classifyRelation,
    extractRefineDelta: options.extractRefineDelta,
  };
  const igdb = new FakeIgdbClient(options.igdbResults ?? {});
  const enrichment = options.enrichment ?? new FakeEnrichment();
  const budget = new InMemoryBudgetLedger({
    igdb: options.limits?.igdb ?? 0,
    brave: options.limits?.brave ?? 0,
    llm: options.limits?.llm ?? 0,
  });
  const discovery = new DiscoveryManager(
    igdb,
    enrichment,
    catalog,
    new InMemoryDiscoveryCacheRepository(),
    new InMemoryQueryOffsetStore(),
    budget,
  );
  const config: RecommendationConfig = {
    ...RECOMMENDATION_CONFIG,
    ...options.config,
  };
  const composeExplanation = vi.fn(
    async () => "Explicación determinista de prueba",
  );
  const orchestrator = new RecommendationOrchestrator(
    {
      intents,
      cache,
      catalog,
      discovery,
      explainer: { compose: composeExplanation },
      ...(options.lexicon
        ? {
            lexicon:
              options.lexicon as unknown as KeywordLexiconService,
          }
        : {}),
    },
    config,
  );
  return {
    orchestrator,
    catalog,
    cache,
    extract,
    igdb,
    enrichment,
    budget,
    composeExplanation,
  };
}

describe("isSameIntent", () => {
  it("ignora relation, orden de listas y null ≡ []", () => {
    const a = makeIntent({
      keywords: ["pirates", "2d"],
      objective: {
        genres: ["ROLE_PLAYING_RPG"],
        themes: null,
        platforms: null,
        gameModes: null,
        perspectives: null,
      },
      relation: "new",
    });
    const b = makeIntent({
      keywords: ["2d", "pirates"],
      objective: {
        genres: ["ROLE_PLAYING_RPG"],
        themes: [],
        platforms: [],
        gameModes: [],
        perspectives: [],
      },
      relation: "refine",
    });
    expect(isSameIntent(a, b)).toBe(true);
  });

  it("null ≡ objeto con todo vacío (fresco vs fusionado)", () => {
    const fresh = makeIntent({ keywords: ["pirates"], excluded: null });
    const merged = makeIntent({
      keywords: ["pirates"],
      excluded: {
        keywords: null,
        genres: null,
        themes: null,
        platforms: null,
        gameModes: null,
        perspectives: null,
        releaseYear: null,
        yearFrom: null,
        yearTo: null,
      },
    });
    expect(isSameIntent(fresh, merged)).toBe(true);
  });

  it("detecta cambios en keywords, semánticas y excluidos", () => {
    const base = makeIntent({ keywords: ["pirates"] });
    expect(
      isSameIntent(base, makeIntent({ keywords: ["pirates", "mmo"] })),
    ).toBe(false);
    expect(
      isSameIntent(
        base,
        makeIntent({
          keywords: ["pirates"],
          semantic: { ...NULL_SEMANTIC, difficulty: 0.8 },
        }),
      ),
    ).toBe(false);
    expect(
      isSameIntent(
        { ...base, excluded: null },
        {
          ...base,
          excluded: {
            keywords: ["mods"],
            genres: null,
            themes: null,
            platforms: null,
            gameModes: null,
            perspectives: null,
            releaseYear: null,
            yearFrom: null,
            yearTo: null,
          },
        },
      ),
    ).toBe(false);
  });
});

describe("RecommendationOrchestrator", () => {
  it("búsqueda anónima: devuelve el match local, notices honestos y no llama a IGDB con presupuesto seco", async () => {
    const { orchestrator, igdb, catalog, composeExplanation } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: ANON,
    });

    expect(response.results).toHaveLength(1);
    expect(response.results[0].game.slug).toBe("pirates-cove");
    expect(response.results[0].tier).toBe("valid");
    expect(response.results[0].reasons.length).toBeGreaterThan(0);
    expect(response.results[0].reasons.map((reason) => reason.field)).toContain(
      "kw.pirates",
    );
    expect(response.results[0].reasons[0].block).toBeDefined();
    expect(response.results[0].reasons[0].kind).toBeDefined();
    expect(response.explanation).toBe("Explicación determinista de prueba");
    expect(composeExplanation).toHaveBeenCalledTimes(1);
    expect(response.requestedGames).toEqual([]);
    expect(response.intent).toEqual(PIRATES_INTENT);
    expect(response.notices).toContain("DISCOVERY_BUDGET_EXHAUSTED");
    expect(response.notices).toContain("PARTIAL_RESULTS");
    expect(response.notices).toContain("SEARCH_EXHAUSTED");
    expect(response.meta.exhaustedPool).toBe(true);
    expect(response.meta.partial).toBe(true);
    expect(response.meta.action).toBe("search");
    expect(response.meta.discoveryUnitsUsed).toBe(0);
    expect(igdb.calls).toHaveLength(0);
    expect(catalog.searchCountIncrements).toEqual([[1]]);
  });

  it("rellena por descubrimiento cuando el catálogo local no alcanza", async () => {
    const { orchestrator, catalog, budget, igdb } = setup({
      catalogGames: [
        makeGame({
          id: 2,
          slug: "football",
          title: "Football",
          genres: ["SPORT"],
          keywords: ["football"],
        }),
      ],
      intent: PIRATES_INTENT,
      limits: { igdb: 100, brave: 100, llm: 100 },
    });
    igdb.filteredResults = [
      makeRaw(101, "Pirate Gold", {
        genres: [{ id: 1, name: "Role-playing (RPG)" }],
      }),
      makeRaw(102, "Pirate Sea", {
        genres: [{ id: 1, name: "Role-playing (RPG)" }],
      }),
      makeRaw(103, "Some DLC", { game_type: 1 }),
    ];

    const { response } = await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: ANON,
    });

    expect(response.results.map((item) => item.game.slug)).toEqual([
      "pirate-gold",
      "pirate-sea",
    ]);
    // 1 unidad: "pirates rpg" (keyword+género, sin resultados) y "pirates"
    // (2 fichas nuevas). El football no entra al pool: falla el must y el
    // pre-filtro duro lo excluye antes del matcher.
    expect(response.meta.discoveryUnitsUsed).toBe(1);
    expect(response.meta.tierCounts.valid).toBe(2);
    expect(response.meta.evaluatedCandidates).toBe(2);
    expect(catalog.createCalls).toBe(2);
    expect(budget.remaining("igdb")).toBe(98);
    expect(budget.remaining("brave")).toBe(96);
    expect(budget.remaining("llm")).toBe(98);
    // Sin variantes restantes y sin llegar a 8: agotado honesto
    expect(response.notices).toContain("SEARCH_EXHAUSTED");
    expect(response.notices).not.toContain("DISCOVERY_BUDGET_EXHAUSTED");
  });

  it("more reusa la intención del cliente, excluye los mostrados y no llama al extractor", async () => {
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
    });

    const first = await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: USER,
    });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(first.response.meta.lifecycle).toBe("reset");

    const { response } = await orchestrator.handle({
      action: "more",
      message: "dame más",
      actor: USER,
      contextIntent: first.response.intent,
      shownGameIds: first.response.results.map((item) => item.game.id),
    });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(response.results).toHaveLength(0);
    expect(response.meta.action).toBe("more");
    expect(response.meta.lifecycle).toBe("continue");
    expect(response.meta.exhaustedPool).toBe(true);
  });

  it("more anónimo con contexto: ya NO exige login", async () => {
    const { orchestrator } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
    });

    const first = await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: ANON,
    });
    expect(first.response.results).toHaveLength(1);

    const { response } = await orchestrator.handle({
      action: "more",
      message: "dame más",
      actor: ANON,
      contextIntent: first.response.intent,
      shownGameIds: first.response.results.map((item) => item.game.id),
    });
    // El "more" anónimo está permitido: no lanza login.
    expect(response.results).toHaveLength(0);
    expect(response.meta.lifecycle).toBe("continue");
    expect(response.notices).not.toContain("REFINE_REQUIRES_LOGIN");
  });

  it("refine sin contexto previo cae a extracción fresca (sin crash)", async () => {
    const extractRefineDelta = vi.fn(async () => {
      throw new Error("no debería llamarse sin previo");
    });
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
      classifyRelation: vi.fn(async () => "refine" as const),
      extractRefineDelta,
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "y de piratas",
      actor: USER,
    });

    expect(extract).toHaveBeenCalledWith("y de piratas");
    expect(extractRefineDelta).not.toHaveBeenCalled();
    expect(response.intent).toEqual(PIRATES_INTENT);
    expect(response.meta.lifecycle).toBe("reset");
  });

  it("refine sobre intent vacío (contextIntent vacío) cae a extracción fresca", async () => {
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
      classifyRelation: vi.fn(async () => "refine" as const),
      extractRefineDelta: vi.fn(async () => ({
        add: {
          keywords: null,
          genres: null,
          themes: null,
          platforms: null,
          gameModes: null,
          perspectives: null,
          gameReferenced: null,
          releaseYear: null,
          yearFrom: null,
          yearTo: null,
          semantic: null,
        },
        remove: {
          keywords: null,
          genres: null,
          themes: null,
          platforms: null,
          gameModes: null,
          perspectives: null,
          gameReferenced: null,
          releaseYear: null,
          yearFrom: null,
          yearTo: null,
          semantic: null,
          excluded: null,
        },
        excluded: null,
      })),
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: USER,
      contextIntent: makeIntent(),
    });

    expect(extract).toHaveBeenCalledWith("un RPG de piratas");
    expect(response.intent).toEqual(PIRATES_INTENT);
    expect(response.meta.lifecycle).toBe("reset");
  });

  it("more sin contexto → EMPTY_INTENT reutilizado (sin error)", async () => {
    const { orchestrator } = setup({ intent: PIRATES_INTENT });

    const { response } = await orchestrator.handle({
      action: "more",
      message: "dame más",
      actor: USER,
    });

    expect(response.results).toHaveLength(0);
    expect(response.notices).toContain("EMPTY_INTENT");
    expect(response.meta.lifecycle).toBe("continue");
  });

  it("intención vacía: respuesta inmediata sin tocar catálogo ni IGDB", async () => {
    const { orchestrator, catalog, igdb, composeExplanation } = setup(
      {
        intent: makeIntent(),
      },
    );

    const { response } = await orchestrator.handle({
      action: "search",
      message: "???",
      actor: USER,
    });

    expect(response.results).toEqual([]);
    expect(response.notices).toContain("EMPTY_INTENT");
    expect(response.meta.exhaustedPool).toBe(true);
    expect(catalog.findCandidatesCalls).toBe(0);
    expect(igdb.calls).toHaveLength(0);
    // La intención vacía no gasta LLM: plantilla determinista
    expect(composeExplanation).not.toHaveBeenCalled();
    expect(response.explanation).toContain("No he llegado a entender");
  });

  it("search con sesión: sin intención previa no clasifica y extrae fresco", async () => {
    const extendedIntent = makeIntent({
      keywords: ["pirates", "pixel art"],
      objective: {
        genres: ["ROLE_PLAYING_RPG"],
        themes: null,
        platforms: null,
        gameModes: null,
        perspectives: null,
      },
    });
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
    });

    await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: USER,
    });

    extract.mockImplementation(async () => extendedIntent);
    const { response } = await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas en pixel art",
      actor: USER,
    });

    // Sin clasificador en deps se asume búsqueda nueva: extracción fresca.
    expect(extract).toHaveBeenLastCalledWith("un RPG de piratas en pixel art");
    expect(response.intent).toEqual(extendedIntent);
    expect(response.meta.lifecycle).toBe("reset");
  });

  it("search anónimo extrae sin contexto de sesión", async () => {
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
    });

    await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: ANON,
    });

    expect(extract).toHaveBeenCalledWith("un RPG de piratas");
  });

  it("search no excluye los ya mostrados: los mostrados re-compiten y vuelven si son los mejores", async () => {
    const { orchestrator } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
    });

    const first = await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: USER,
    });
    expect(first.response.results.map((item) => item.game.slug)).toEqual([
      "pirates-cove",
    ]);

    const second = await orchestrator.handle({
      action: "search",
      message: "otro RPG de piratas",
      actor: USER,
    });
    expect(second.response.results.map((item) => item.game.slug)).toEqual([
      "pirates-cove",
    ]);
  });

  it("INTENT_UNCHANGED: un mensaje sin intención nueva reutiliza el contexto del cliente", async () => {
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
    });

    await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: USER,
    });

    // El "modelo" devuelve un objective vacío pero presente (lo típico con
    // mensajes tipo "sí, quiero"): la salvaguarda debe recuperar el previo.
    extract.mockImplementation(async () =>
      makeIntent({
        objective: {
          genres: null,
          themes: null,
          platforms: null,
          gameModes: null,
          perspectives: null,
        },
      }),
    );

    const { response } = await orchestrator.handle({
      action: "search",
      message: "si que quiero",
      actor: USER,
      contextIntent: PIRATES_INTENT,
    });

    expect(response.notices).toContain("INTENT_UNCHANGED");
    expect(response.intent).toEqual(PIRATES_INTENT);
    expect(response.results.map((item) => item.game.slug)).toEqual([
      "pirates-cove",
    ]);
  });

  it("objective vacío pero presente cuenta como intención vacía (sin sesión previa)", async () => {
    const { orchestrator, igdb, catalog } = setup({
      intent: makeIntent({
        objective: {
          genres: null,
          themes: null,
          platforms: null,
          gameModes: null,
          perspectives: null,
        },
      }),
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "si",
      actor: ANON,
    });

    expect(response.notices).toContain("EMPTY_INTENT");
    expect(catalog.findCandidatesCalls).toBe(0);
    expect(igdb.calls).toHaveLength(0);
  });

  it("more pide una tanda nueva de hasta 8: excluye lo mostrado y descubre nuevos", async () => {
    const shelf = Array.from({ length: 8 }, (_, index) =>
      makeGame({
        id: index + 1,
        slug: `pirates-cove-${index + 1}`,
        title: `Pirates Cove ${index + 1}`,
        genres: ["ROLE_PLAYING_RPG"],
        keywords: ["pirates"],
      }),
    );
    const { orchestrator, catalog, igdb } = setup({
      catalogGames: shelf,
      intent: PIRATES_INTENT,
      // Aislamos el comportamiento de "more": sin trabajo orgánico en
      // background (re-enrich/descubrimiento) tras la primera búsqueda.
      config: { organicUnitsPerRequest: 0 },
      limits: { igdb: 100, brave: 100, llm: 100 },
    });
    igdb.filteredResults = [
      makeRaw(101, "Pirate Gold", {
        genres: [{ id: 1, name: "Role-playing (RPG)" }],
      }),
      makeRaw(102, "Pirate Sea", {
        genres: [{ id: 1, name: "Role-playing (RPG)" }],
      }),
    ];

    const first = await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: USER,
    });
    // Los 8 locales llenan los slots: no hay descubrimiento en la 1ª búsqueda
    expect(first.response.results).toHaveLength(8);
    expect(igdb.calls).toHaveLength(0);

    const { response } = await orchestrator.handle({
      action: "more",
      message: "dame más",
      actor: USER,
      contextIntent: first.response.intent,
      shownGameIds: first.response.results.map((item) => item.game.id),
    });

    // "more" NO re-muestra: exclusión estricta. La tanda nueva trae lo descubierto
    expect(response.results.map((item) => item.game.slug)).toEqual([
      "pirate-gold",
      "pirate-sea",
    ]);
    expect(catalog.createCalls).toBe(2);
    // 2 descubrimientos IGDB (filtrados): cada variante ("pirates rpg",
    // "pirates") dispara una consulta por atributos antes de rendirse.
    expect(igdb.filteredCalls).toHaveLength(2);
    expect(response.meta.exhaustedPool).toBe(true);
  });

  it("refine no-op (re-menciona lo pedido) excluye lo mostrado como more", async () => {
    const shelf = Array.from({ length: 10 }, (_, index) =>
      makeGame({
        id: index + 1,
        slug: `pirates-cove-${index + 1}`,
        title: `Pirates Cove ${index + 1}`,
        genres: ["ROLE_PLAYING_RPG"],
        keywords: ["pirates"],
        ...FULL_SEMANTIC,
      }),
    );
    const emptyAdd = {
      keywords: null,
      genres: null,
      themes: null,
      platforms: null,
      gameModes: null,
      perspectives: null,
      gameReferenced: null,
      releaseYear: null,
      yearFrom: null,
      yearTo: null,
      semantic: null,
    };
    const emptyRemove = { ...emptyAdd, excluded: null };
    // "mas mmo's?": el delta re-añade el género ya pedido → fusión idéntica.
    const extractRefineDelta = vi.fn(
      async (): Promise<RefineDelta> => ({
        add: { ...emptyAdd, genres: ["ROLE_PLAYING_RPG"] },
        remove: emptyRemove,
        excluded: null,
      }),
    );
    const classifyRelation = vi
      .fn()
      .mockResolvedValueOnce("new" as const)
      .mockResolvedValue("refine" as const);
    const { orchestrator } = setup({
      catalogGames: shelf,
      intent: PIRATES_INTENT,
      classifyRelation,
      extractRefineDelta,
      config: { organicUnitsPerRequest: 0 },
      limits: { igdb: 100, brave: 100, llm: 100 },
    });

    const first = await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: USER,
    });
    expect(first.response.results).toHaveLength(8);

    const { response } = await orchestrator.handle({
      action: "search",
      message: "mas RPG de piratas?",
      actor: USER,
      contextIntent: first.response.intent,
      shownGameIds: first.response.results.map((item) => item.game.id),
    });

    // No repite: excluye los 8 mostrados y trae los 2 restantes.
    expect(response.results).toHaveLength(2);
    const firstIds = new Set(first.response.results.map((item) => item.game.id));
    for (const item of response.results) {
      expect(firstIds.has(item.game.id)).toBe(false);
    }
    expect(response.intent.relation).toBe("refine");
  });

  it("refine cuya diferencia la lima el léxico excluye como more (no-op tardío)", async () => {
    const shelf = Array.from({ length: 10 }, (_, index) =>
      makeGame({
        id: index + 1,
        slug: `pirates-cove-${index + 1}`,
        title: `Pirates Cove ${index + 1}`,
        genres: ["ROLE_PLAYING_RPG"],
        keywords: ["pirates"],
        ...FULL_SEMANTIC,
      }),
    );
    const emptyAdd = {
      keywords: null,
      genres: null,
      themes: null,
      platforms: null,
      gameModes: null,
      perspectives: null,
      gameReferenced: null,
      releaseYear: null,
      yearFrom: null,
      yearTo: null,
      semantic: null,
    };
    // "más como este": el delta trae "more like this" como keyword, que el
    // léxico dropea. Pre-léxico parece distinto; post-léxico es idéntico.
    const extractRefineDelta = vi.fn(async () => ({
      add: { ...emptyAdd, keywords: ["more like this"] },
      remove: { ...emptyAdd, excluded: null },
      excluded: null,
    }));
    const classifyRelation = vi
      .fn()
      .mockResolvedValueOnce("new" as const)
      .mockResolvedValue("refine" as const);
    const { orchestrator } = setup({
      catalogGames: shelf,
      intent: PIRATES_INTENT,
      classifyRelation,
      extractRefineDelta,
      lexicon: {
        async canonicalizeIntent(intent: GameSearchIntent) {
          const keywords = (intent.keywords ?? []).filter(
            (k) => k !== "more like this",
          );
          return {
            ...intent,
            keywords: keywords.length > 0 ? keywords : null,
          };
        },
        drainDropped: () => [],
      },
      config: { organicUnitsPerRequest: 0 },
      limits: { igdb: 100, brave: 100, llm: 100 },
    });

    const first = await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: USER,
    });
    expect(first.response.results).toHaveLength(8);

    const { response } = await orchestrator.handle({
      action: "search",
      message: "más como este",
      actor: USER,
      contextIntent: first.response.intent,
      shownGameIds: first.response.results.map((item) => item.game.id),
    });

    expect(response.results).toHaveLength(2);
    const firstIds = new Set(first.response.results.map((item) => item.game.id));
    for (const item of response.results) {
      expect(firstIds.has(item.game.id)).toBe(false);
    }
  });

  it("more con pool fino rescata relajado: avisa qué soltó y guarda el original", async () => {
    const local = makeGame({
      id: 1,
      slug: "local-cowboy",
      title: "Local Cowboy",
      themes: ["ACTION", "OPEN_WORLD"],
      keywords: ["cowboys"],
      ...FULL_SEMANTIC,
    });
    const cowboysIntent = makeIntent({
      keywords: ["cowboys"],
      objective: {
        genres: null,
        themes: ["ACTION", "OPEN_WORLD"],
        platforms: null,
        gameModes: null,
        perspectives: null,
      },
    });
    const { orchestrator, igdb } = setup({
      catalogGames: [local],
      intent: cowboysIntent,
      // El estricto lo ve todo pero el must completo lo tumba: 0 creados.
      // El amplio devuelve lo mismo y la cascada lo rescata al soltar themes.
      limits: { igdb: 100, brave: 100, llm: 100 },
      config: { organicUnitsPerRequest: 0 },
    });
    igdb.filteredResults = [
      makeRaw(201, "Cowboy Action", {
        themes: [{ id: 1, name: "Action" }],
        keywords: [{ id: 5, name: "cowboys" }],
      }),
    ];

    const first = await orchestrator.handle({
      action: "search",
      message: "cowboys de acción y mundo abierto",
      actor: USER,
    });
    // Búsqueda normal: estricta y honesta, sin relajación ni aviso.
    expect(first.response.results).toHaveLength(1);
    expect(first.response.notices).not.toContain("RELAXED_FILTERS");
    expect(first.response.meta.relaxedFilters ?? []).toEqual([]);

    const { response } = await orchestrator.handle({
      action: "more",
      message: "dame más",
      actor: USER,
      contextIntent: first.response.intent,
      shownGameIds: first.response.results.map((item) => item.game.id),
    });

    expect(response.results.map((item) => item.game.slug)).toEqual([
      "cowboy-action",
    ]);
    expect(response.notices).toContain("RELAXED_FILTERS");
    expect(response.meta.relaxedFilters).toEqual(["themes"]);
    // Responde con el efectivo (sin OPEN_WORLD); el intent original lo
    // conserva el CLIENTE, no el servidor.
    expect(response.intent.objective?.themes).toBeNull();
    // El pool de request 1 deja el raw 201 (no promovido), pero no pasa el
    // must estricto del request 2 (falta OPEN_WORLD): se re-marca estricta
    // (#2) + amplia (#3) + where relajado (#4). Request 1 hizo 1 estricta.
    expect(igdb.filteredCalls).toHaveLength(4);
    // La estricta del 2º viene antes de la amplia ("cowboys") y el where.
    expect(igdb.filteredCalls[2]?.text).toBe("cowboys");
  });

  it("streaming: emite intent y un snapshot por tanda creada", async () => {
    const { orchestrator, igdb } = setup({
      catalogGames: [
        makeGame({
          id: 1,
          slug: "pirates-cove-1",
          title: "Pirates Cove 1",
          genres: ["ROLE_PLAYING_RPG"],
          keywords: ["pirates"],
          ...FULL_SEMANTIC,
        }),
      ],
      intent: PIRATES_INTENT,
      limits: { igdb: 100, brave: 100, llm: 100 },
      config: { organicUnitsPerRequest: 0 },
    });
    igdb.filteredResults = [
      makeRaw(101, "Pirate Gold", {
        genres: [{ id: 1, name: "Role-playing (RPG)" }],
      }),
      makeRaw(102, "Pirate Sea", {
        genres: [{ id: 1, name: "Role-playing (RPG)" }],
      }),
    ];

    const seen: string[] = [];
    const snapshotSizes: number[] = [];
    const { response } = await orchestrator.handle(
      { action: "search", message: "un RPG de piratas", actor: USER },
      (event) => {
        seen.push(event.event);
        if (event.event === "results") snapshotSizes.push(event.results.length);
        if (event.event === "intent") {
          expect(event.intent.keywords).toEqual(["pirates"]);
        }
      }
    );

    expect(seen[0]).toBe("intent");
    expect(seen).toContain("results");
    // Snapshot inicial (1 local) y uno por ficha creada (1+1, 1+2).
    expect(snapshotSizes).toEqual([1, 2, 3]);
    expect(response.results).toHaveLength(3);
  });

  it("refine sin cambios con pool fino también rescata (rama more completa)", async () => {
    const local = makeGame({
      id: 1,
      slug: "local-cowboy",
      title: "Local Cowboy",
      themes: ["ACTION", "OPEN_WORLD"],
      keywords: ["cowboys"],
      ...FULL_SEMANTIC,
    });
    const cowboysIntent = makeIntent({
      keywords: ["cowboys"],
      objective: {
        genres: null,
        themes: ["ACTION", "OPEN_WORLD"],
        platforms: null,
        gameModes: null,
        perspectives: null,
      },
    });
    const emptyDelta = {
      add: {
        keywords: null,
        genres: null,
        themes: null,
        platforms: null,
        gameModes: null,
        perspectives: null,
        gameReferenced: null,
        releaseYear: null,
        yearFrom: null,
        yearTo: null,
        semantic: null,
      },
      remove: {
        keywords: null,
        genres: null,
        themes: null,
        platforms: null,
        gameModes: null,
        perspectives: null,
        gameReferenced: null,
        releaseYear: null,
        yearFrom: null,
        yearTo: null,
        semantic: null,
        excluded: null,
      },
      excluded: null,
    };
    const classifyRelation = vi
      .fn()
      .mockResolvedValueOnce("new" as const)
      .mockResolvedValue("refine" as const);
    const { orchestrator, igdb } = setup({
      catalogGames: [local],
      intent: cowboysIntent,
      classifyRelation,
      extractRefineDelta: vi.fn(async () => emptyDelta),
      limits: { igdb: 100, brave: 100, llm: 100 },
      config: { organicUnitsPerRequest: 0 },
    });
    igdb.filteredResults = [
      makeRaw(201, "Cowboy Action", {
        themes: [{ id: 1, name: "Action" }],
        keywords: [{ id: 5, name: "cowboys" }],
      }),
    ];

    const first = await orchestrator.handle({
      action: "search",
      message: "cowboys de acción y mundo abierto",
      actor: USER,
    });
    expect(first.response.results).toHaveLength(1);
    expect(first.response.notices).not.toContain("RELAXED_FILTERS");

    const { response } = await orchestrator.handle({
      action: "search",
      message: "más como este",
      actor: USER,
      contextIntent: first.response.intent,
      shownGameIds: first.response.results.map((item) => item.game.id),
    });

    // No repite el mostrado y rescata relajado con aviso.
    expect(response.results.map((item) => item.game.slug)).toEqual([
      "cowboy-action",
    ]);
    expect(response.notices).toContain("RELAXED_FILTERS");
    expect(response.meta.relaxedFilters).toEqual(["themes"]);
  });

  it("juego pedido explícitamente: el ancla va a requestedGames y nunca a results", async () => {
    const anchor = makeGame({
      id: 1,
      slug: "dark-souls-3",
      title: "Dark Souls III",
      keywords: ["soulslike", "dark"],
    });
    const { orchestrator } = setup({
      catalogGames: [anchor],
      intent: makeIntent({ gameReferenced: ["Dark Souls III"] }),
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "quiero jugar a Dark Souls III",
      actor: ANON,
    });

    expect(response.requestedGames.map((game) => game.slug)).toEqual([
      "dark-souls-3",
    ]);
    expect(response.results).toHaveLength(0);
    expect(response.notices).toContain("EXPLICIT_GAME_REQUESTED");
  });

  it("ancla no resuelta en catálogo se descubre por nombre en IGDB", async () => {
    const { orchestrator, catalog } = setup({
      intent: makeIntent({ gameReferenced: ["Unknown Anchor"] }),
      igdbResults: { "Unknown Anchor": [makeRaw(77, "Unknown Anchor Game")] },
      limits: { igdb: 100, brave: 100, llm: 100 },
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "algo parecido a Unknown Anchor",
      actor: ANON,
    });

    expect(response.requestedGames.map((game) => game.slug)).toEqual([
      "unknown-anchor-game",
    ]);
    expect(response.notices).toContain("EXPLICIT_GAME_REQUESTED");
    expect(catalog.createCalls).toBe(1);
  });

  it("anon que REFINA con contextIntent y clasificador dedicado → CTA de login sin descubrir", async () => {
    const classify = vi.fn(async () => "refine" as const);
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
      classifyRelation: classify,
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "uno similar pero de jardineria?",
      actor: ANON,
      contextIntent: PIRATES_INTENT,
    });

    expect(response.notices).toContain("REFINE_REQUIRES_LOGIN");
    expect(response.results).toHaveLength(0);
    // La clasificación es un paso dedicado: extract no interpreta nada.
    expect(extract).not.toHaveBeenCalled();
  });

  it("anon con contextIntent que clasifica 'new' → búsqueda fresca (una extracción sin contexto)", async () => {
    const classify = vi.fn(async () => "new" as const);
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
      classifyRelation: classify,
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "quiero zombies",
      actor: ANON,
      contextIntent: PIRATES_INTENT,
    });

    // 1 clasificación + 1 extracción fresca (sin contexto)
    expect(classify).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledWith("quiero zombies");
    expect(response.results.map((item) => item.game.slug)).toEqual([
      "pirates-cove",
    ]);
  });

  it("anon SIN contextIntent → clasifica sin contexto y, si 'new', extracción fresca", async () => {
    const classify = vi.fn(async () => "new" as const);
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
      classifyRelation: classify,
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "quiero un juego de futbol en 2d",
      actor: ANON,
    });

    // Ahora SIEMPRE se clasifica (incluso sin contexto): el clasificador
    // decide entre new y nonsensical cuando no hay previousIntent.
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledWith("quiero un juego de futbol en 2d", undefined);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(response.notices).not.toContain("REFINE_REQUIRES_LOGIN");
  });

  it("logueado que REFINA → clasifica, extrae delta y fusiona deterministamente", async () => {
    const classify = vi.fn(async () => "refine" as const);
    const extractDelta = vi.fn(async () => ({
      add: {
        keywords: ["2d"],
        genres: null,
        themes: null,
        platforms: null,
        gameModes: null,
        perspectives: null,
        gameReferenced: null,
        releaseYear: null,
        yearFrom: null,
        yearTo: null,
        semantic: { ...NULL_SEMANTIC, violence: 0.9 },
      },
      remove: null,
      excluded: null,
    }));
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
      classifyRelation: classify,
      extractRefineDelta: extractDelta,
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "y en 2d, más violento",
      actor: USER,
      contextIntent: PIRATES_INTENT,
    });

    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledWith("y en 2d, más violento", PIRATES_INTENT);
    expect(extractDelta).toHaveBeenCalledTimes(1);
    // La extracción completa NO se llama: el merge es determinista.
    expect(extract).not.toHaveBeenCalled();
    // previo + delta: keywords fusionadas, género previo intacto, semántica override.
    expect(response.intent.keywords).toEqual(["pirates", "2d"]);
    expect(response.intent.objective?.genres).toEqual(["ROLE_PLAYING_RPG"]);
    expect(response.intent.semantic?.violence).toBe(0.9);
    expect(response.intent.relation).toBe("refine");
    expect(response.notices).not.toContain("REFINE_REQUIRES_LOGIN");
  });

  it("logueado con búsqueda NUEVA → extracción fresca, el intent previo es irrelevante", async () => {
    const classify = vi.fn(async () => "new" as const);
    const extractDelta = vi.fn();
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: makeIntent({ keywords: ["football"], relation: "new" }),
      classifyRelation: classify,
      extractRefineDelta: extractDelta,
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "quiero un juego de futbol en 2d",
      actor: USER,
      // El intent previo se envía pero se IGNORA: el clasificador dice "new".
      contextIntent: PIRATES_INTENT,
    });

    expect(classify).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledWith("quiero un juego de futbol en 2d");
    expect(extractDelta).not.toHaveBeenCalled();
    expect(response.intent.keywords).toEqual(["football"]);
    expect(response.intent.relation).toBe("new");
  });

  it("nonsensical (anon, sin contexto) → SENSELESS_INPUT, sin buscar ni extraer", async () => {
    const classify = vi.fn(async () => "nonsensical" as const);
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
      classifyRelation: classify,
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "¿por qué las gallinas no vuelan?",
      actor: ANON,
    });

    expect(classify).toHaveBeenCalledTimes(1);
    expect(extract).not.toHaveBeenCalled();
    expect(response.notices).toContain("SENSELESS_INPUT");
    expect(response.results).toHaveLength(0);
    expect(response.intent.relation).toBe("nonsensical");
  });

  it("nonsensical (anon, con contexto refine) → SENSELESS_INPUT, sin CTA de login", async () => {
    const classify = vi.fn(async () => "nonsensical" as const);
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
      classifyRelation: classify,
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "Hola, ¿cómo estás?",
      actor: ANON,
      contextIntent: PIRATES_INTENT,
    });

    expect(classify).toHaveBeenCalledTimes(1);
    expect(extract).not.toHaveBeenCalled();
    expect(response.notices).toContain("SENSELESS_INPUT");
    expect(response.notices).not.toContain("REFINE_REQUIRES_LOGIN");
    expect(response.results).toHaveLength(0);
  });

  it("nonsensical (logueado) → SENSELESS_INPUT, sin buscar", async () => {
    const classify = vi.fn(async () => "nonsensical" as const);
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
      classifyRelation: classify,
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "Cuéntame un chiste",
      actor: USER,
      contextIntent: PIRATES_INTENT,
    });

    expect(classify).toHaveBeenCalledTimes(1);
    expect(extract).not.toHaveBeenCalled();
    expect(response.notices).toContain("SENSELESS_INPUT");
    expect(response.results).toHaveLength(0);
    expect(response.intent.relation).toBe("nonsensical");
  });

  it("bajo weak nunca se muestra: los no conformes ni entran al pool", async () => {
    const { orchestrator } = setup({
      catalogGames: [PIRATES_GAME],
      // 1 de 3 keywords pedidas: señal insuficiente → el pre-filtro duro lo
      // excluye del pool (ya ni llega al matcher como invalid)
      intent: makeIntent({ keywords: ["pirates", "ninjas", "robots"] }),
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "piratas, ninjas o robots",
      actor: ANON,
    });

    expect(response.results).toHaveLength(0);
    expect(response.meta.evaluatedCandidates).toBe(0);
    expect(response.notices).toContain("PARTIAL_RESULTS");
  });

  it("respuesta llena dispara re-enrichment orgánico post-respuesta", async () => {
    const incompleteGame = makeGame({
      id: 1,
      slug: "pirates-cove",
      title: "Pirates!",
      genres: ["ROLE_PLAYING_RPG"],
      keywords: ["pirates"],
      sourceId: "55",
      difficulty: 0.7,
    });
    const enrichment = new FakeEnrichment(
      makeGameEnrichment({
        semantic: { ...NULL_SEMANTIC, horror: 0.8 },
        additionalKeywords: ["treasure"],
      }),
    );
    const { orchestrator, catalog } = setup({
      catalogGames: [incompleteGame],
      intent: PIRATES_INTENT,
      enrichment,
      igdbResults: { "Pirates!": [makeRaw(55, "Pirates!")] },
      config: { maxResults: 1 },
      limits: { igdb: 100, brave: 100, llm: 100 },
    });

    const { response, background } = await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: ANON,
    });

    expect(response.results).toHaveLength(1);
    expect(background).toBeDefined();
    await background;

    expect(catalog.updateCalls).toBe(1);
    const updated = catalog.get(1)!;
    expect(updated.difficulty).toBe(0.7);
    expect(updated.horror).toBe(0.8);
    // reEnrich mantiene el vocabulario IGDB (["pirates"]): la keyword
    // adicional del LLM ("treasure") es señal del gate, jamás persistida.
    expect(updated.keywords).toEqual(["pirates"]);
    expect(updated.keywords).not.toContain("treasure");
  });

  it("PG caída: degrada al pool del JSON cache con notice", async () => {
    const broken = setup({
      catalogGames: [PIRATES_GAME],
      cacheGames: [
        makeGame({
          id: 50,
          slug: "cached-pirates",
          title: "Cached Pirates",
          genres: ["ROLE_PLAYING_RPG"],
          keywords: ["pirates"],
          ...FULL_SEMANTIC,
        }),
      ],
      intent: PIRATES_INTENT,
    });
    broken.catalog.findCandidates = async () => {
      throw new Error("PG down");
    };

    const { response } = await broken.orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: ANON,
    });

    expect(response.notices).toContain("PG_DEGRADED");
    expect(response.results.map((item) => item.game.slug)).toEqual([
      "cached-pirates",
    ]);
  });

  it("circuito cerrado: lo descubierto matchea la intención que lo descubrió", async () => {
    // Caso real que falló en producción: la ficha descubierta no tenía la
    // keyword del término buscado → todos inválidos. El circuito descubre →
    // enriquece → guarda → matchea cuando IGDB etiqueta la ficha con el
    // término (keyword IGDB "batman"); la query nunca contamina las keywords.
    const { orchestrator, igdb } = setup({
      intent: makeIntent({ keywords: ["batman"] }),
      limits: { igdb: 100, brave: 100, llm: 100 },
    });
    igdb.filteredResults = [
      makeRaw(201, "Dark Knight Game", {
        keywords: [{ id: 1, name: "batman" }],
      }),
    ];

    const { response } = await orchestrator.handle({
      action: "search",
      message: "un juego de batman",
      actor: ANON,
    });

    expect(response.results.length).toBeGreaterThanOrEqual(1);
    expect(response.results[0].tier).toBe("valid");
    expect(response.results[0].reasons.map((r) => r.field)).toContain(
      "kw.batman",
    );
  });

  it("deadline de relleno: sin descubrimiento y parcial no-agotado", async () => {
    const { orchestrator, igdb } = setup({
      intent: PIRATES_INTENT,
      config: { fillDeadlineMs: 0 },
      limits: { igdb: 100, brave: 100, llm: 100 },
    });

    const { response } = await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: ANON,
    });

    expect(response.results).toHaveLength(0);
    expect(igdb.calls).toHaveLength(0);
    // deadline NO es agotamiento: "Más así" puede continuar
    expect(response.meta.exhaustedPool).toBe(false);
    expect(response.notices).toContain("PARTIAL_RESULTS");
  });

  it("el cap de juegos nuevos por petición limita el relleno aunque falten resultados", async () => {
    const { orchestrator, catalog, igdb } = setup({
      intent: PIRATES_INTENT,
      config: { maxNewGamesPerRequest: 4 },
      limits: { igdb: 100, brave: 100, llm: 100 },
    });
    igdb.filteredResults = [
      makeRaw(101, "Pirate Gold", {
        genres: [{ id: 1, name: "Role-playing (RPG)" }],
      }),
      makeRaw(102, "Pirate Sea", {
        genres: [{ id: 1, name: "Role-playing (RPG)" }],
      }),
      makeRaw(103, "Pirate Land", {
        genres: [{ id: 1, name: "Role-playing (RPG)" }],
      }),
      makeRaw(104, "Pirate Sky", {
        genres: [{ id: 1, name: "Role-playing (RPG)" }],
      }),
      makeRaw(105, "Pirate Fire", {
        genres: [{ id: 1, name: "Role-playing (RPG)" }],
      }),
      makeRaw(106, "Pirate Ice", {
        genres: [{ id: 1, name: "Role-playing (RPG)" }],
      }),
    ];

    const { response } = await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: ANON,
    });

    // Worst case contenido: 4 fichas creadas y se para aunque la lista
    // de IGDB aún tenía candidatos y faltaban slots por llenar.
    expect(catalog.createCalls).toBe(4);
    expect(response.results).toHaveLength(4);
    expect(response.meta.discoveryUnitsUsed).toBe(2);
    // games-cap NO es agotamiento: un "more" puede traer más
    expect(response.meta.exhaustedPool).toBe(false);
    expect(response.notices).toContain("PARTIAL_RESULTS");
  });
});
