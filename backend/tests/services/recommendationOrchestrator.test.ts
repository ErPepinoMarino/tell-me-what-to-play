import { describe, expect, it, vi } from "vitest";
import { RecommendationOrchestrator } from "../../src/orchestrator/recommendationOrchestrator.js";
import { DiscoveryManager } from "../../src/orchestrator/discovery.js";
import { InMemoryBudgetLedger } from "../../src/budget/budgetLedger.js";
import { InMemorySessionStore } from "../../src/sessions/sessionStore.js";
import {
  RECOMMENDATION_CONFIG,
  type RecommendationConfig,
} from "../../src/recommendation/constants.js";
import type { IntentExtractor } from "../../src/orchestrator/types.js";
import {
  LoginRequiredError,
  SessionExpiredError,
} from "../../src/orchestrator/errors.js";
import type { IgdbGameRaw } from "../../src/igdb/types.js";
import type { Game } from "../../src/types/Game.js";
import type { GameSearchIntent } from "../../src/types/GameSearchIntent.js";
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
}

function setup(options: SetupOptions) {
  const catalog = new FakeCatalogLayer();
  catalog.seed(options.catalogGames ?? []);
  const cache = new FakeCacheLayer(options.cacheGames ?? []);
  const extract = vi.fn(async () => options.intent);
  const intents: IntentExtractor = { extract };
  const igdb = new FakeIgdbClient(options.igdbResults ?? {});
  const enrichment = options.enrichment ?? new FakeEnrichment();
  const budget = new InMemoryBudgetLedger({
    igdb: options.limits?.igdb ?? 0,
    brave: options.limits?.brave ?? 0,
    llm: options.limits?.llm ?? 0,
  });
  const discovery = new DiscoveryManager(igdb, enrichment, catalog, budget);
  const sessions = new InMemorySessionStore({
    ttlMs: 30 * 60 * 1000,
    maxEntries: 100,
  });
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
      sessions,
      explainer: { compose: composeExplanation },
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
    sessions,
    composeExplanation,
  };
}

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

  it("more reusa la intención de sesión, excluye los mostrados y no llama al extractor", async () => {
    const { orchestrator, extract, sessions } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
    });

    await orchestrator.handle({
      action: "search",
      message: "un RPG de piratas",
      actor: USER,
    });
    expect(extract).toHaveBeenCalledTimes(1);

    const { response } = await orchestrator.handle({
      action: "more",
      message: "dame más",
      actor: USER,
    });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(response.results).toHaveLength(0);
    expect(response.meta.action).toBe("more");
    expect(response.meta.exhaustedPool).toBe(true);

    const session = sessions.get(1);
    expect(session?.shownGameIds).toEqual([1]);
  });

  it("more anónimo exige login", async () => {
    const { orchestrator } = setup({ intent: PIRATES_INTENT });

    await expect(
      orchestrator.handle({
        action: "more",
        message: "dame más",
        actor: ANON,
      }),
    ).rejects.toThrow(LoginRequiredError);
  });

  it("more sin sesión previa o expirada devuelve SessionExpiredError", async () => {
    const { orchestrator } = setup({ intent: PIRATES_INTENT });

    await expect(
      orchestrator.handle({
        action: "more",
        message: "dame más",
        actor: USER,
      }),
    ).rejects.toThrow(SessionExpiredError);
  });

  it("intención vacía: respuesta inmediata sin tocar catálogo ni IGDB", async () => {
    const { orchestrator, catalog, igdb, sessions, composeExplanation } = setup(
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
    expect(sessions.get(1)?.currentIntent).toEqual(makeIntent());
  });

  it("search con sesión pasa la intención previa al extractor (el LLM decide extender o reemplazar)", async () => {
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
    const { orchestrator, extract, sessions } = setup({
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

    expect(extract).toHaveBeenLastCalledWith(
      "un RPG de piratas en pixel art",
      PIRATES_INTENT,
    );
    expect(response.intent).toEqual(extendedIntent);
    expect(sessions.get(1)?.currentIntent).toEqual(extendedIntent);
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

    expect(extract).toHaveBeenCalledWith("un RPG de piratas", undefined);
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

  it("INTENT_UNCHANGED: un mensaje sin intención nueva reutiliza la intención previa de sesión", async () => {
    const { orchestrator, extract, sessions } = setup({
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
    });

    expect(response.notices).toContain("INTENT_UNCHANGED");
    expect(response.intent).toEqual(PIRATES_INTENT);
    expect(sessions.get(1)?.currentIntent).toEqual(PIRATES_INTENT);
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

  it("anon que intenta REFINAR (relation refine con contextIntent) → CTA de login sin descubrir", async () => {
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
    });
    // El "modelo" clasifica el mensaje como continuación de la anterior
    extract.mockImplementation(async () =>
      makeIntent({ relation: "refine" }),
    );

    const { response } = await orchestrator.handle({
      action: "search",
      message: "uno similar pero de jardineria?",
      actor: ANON,
      contextIntent: PIRATES_INTENT,
    });

    expect(response.notices).toContain("REFINE_REQUIRES_LOGIN");
    expect(response.results).toHaveLength(0);
    // Solo la llamada de clasificación: ni descubrimiento ni explicación
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("anon con contextIntent que clasifica 'new' → búsqueda fresca (re-extrae sin contexto)", async () => {
    const { orchestrator, extract } = setup({
      catalogGames: [PIRATES_GAME],
      intent: PIRATES_INTENT,
    });
    extract.mockImplementation(async () =>
      makeIntent({ relation: "new", keywords: ["pirates"] }),
    );

    const { response } = await orchestrator.handle({
      action: "search",
      message: "quiero zombies",
      actor: ANON,
      contextIntent: PIRATES_INTENT,
    });

    // 1 clasificación + 1 re-extracción fresca (sin contexto)
    expect(extract).toHaveBeenCalledTimes(2);
    expect(extract).toHaveBeenLastCalledWith("quiero zombies", undefined);
    expect(response.results.map((item) => item.game.slug)).toEqual([
      "pirates-cove",
    ]);
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
    expect(updated.keywords).toContain("treasure");
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
    // keyword del término buscado → todos inválidos. Con la siembra, el
    // circuito descubre → enriquece → guarda → matchea.
    const { orchestrator, igdb } = setup({
      intent: makeIntent({ keywords: ["batman"] }),
      limits: { igdb: 100, brave: 100, llm: 100 },
    });
    igdb.filteredResults = [makeRaw(201, "Dark Knight Game", { keywords: [] })];

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
