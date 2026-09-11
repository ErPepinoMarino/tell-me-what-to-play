import { describe, expect, it } from "vitest";
import {
  createDiscoveryRun,
  DiscoveryManager,
  dropRelaxGroup,
  knownSemanticsCount,
  RELAX_ORDER,
} from "../../src/orchestrator/discovery.js";
import {
  InMemoryDiscoveryCacheRepository,
  type DiscoveryCacheRepository,
} from "../../src/orchestrator/discoveryCache.js";
import { InMemoryBudgetLedger } from "../../src/budget/budgetLedger.js";
import { RECOMMENDATION_CONFIG } from "../../src/recommendation/constants.js";
import type { IgdbGameRaw } from "../../src/igdb/types.js";
import {
  FakeCatalogLayer,
  FakeEnrichment,
  FakeIgdbClient,
  makeGame,
  makeGameEnrichment,
  makeIntent,
  makeRaw,
  NULL_SEMANTIC,
} from "../helpers/fakes.js";

function makeSetup(
  opts: {
    limits?: { igdb?: number; brave?: number; llm?: number };
    igdbResults?: Record<string, IgdbGameRaw[]>;
    igdbError?: Error;
    filteredResults?: IgdbGameRaw[];
    enrichment?: FakeEnrichment;
    catalog?: FakeCatalogLayer;
    cache?: DiscoveryCacheRepository;
  } = {},
) {
  const catalog = opts.catalog ?? new FakeCatalogLayer();
  const igdb = new FakeIgdbClient(opts.igdbResults ?? {}, opts.igdbError);
  igdb.filteredResults = opts.filteredResults ?? [];
  const enrichment = opts.enrichment ?? new FakeEnrichment();
  const cache = opts.cache ?? new InMemoryDiscoveryCacheRepository();
  const budget = new InMemoryBudgetLedger({
    igdb: opts.limits?.igdb ?? 100,
    brave: opts.limits?.brave ?? 100,
    llm: opts.limits?.llm ?? 100,
  });
  const discovery = new DiscoveryManager(
    igdb,
    enrichment,
    catalog,
    cache,
    budget,
    RECOMMENDATION_CONFIG,
  );
  return {
    discovery,
    catalog,
    igdb,
    enrichment,
    budget,
    cache,
    // Estado de UNA ejecución: cada petición crea el suyo; los tests de
    // llamadas consecutivas reutilizan el mismo (y los de concurrencia,
    // no).
    run: createDiscoveryRun(),
  };
}

describe("DiscoveryManager.discoverByQuery", () => {
  it("crea hasta maxNew juegos, saltando los existentes y los DLC", async () => {
    const catalog = new FakeCatalogLayer();
    catalog.seed([makeGame({ id: 1 })]);
    const { discovery, igdb, budget } = makeSetup({
      catalog,
      igdbResults: {
        pirates: [
          makeRaw(1, "Existing"),
          makeRaw(2, "Pirate Gold"),
          makeRaw(103, "Some DLC", { game_type: 1 }),
          makeRaw(3, "Pirate Sea"),
          makeRaw(4, "Pirate Land"),
        ],
      },
    });

    const attempt = await discovery.discoverByQuery("pirates", 2, undefined, undefined, [], undefined, createDiscoveryRun());

    expect(attempt.outcome).toBe("ok");
    expect(attempt.newGames.map((game) => game.sourceId)).toEqual(["2", "3"]);
    expect(attempt.budgetExhausted).toBe(false);
    // Límite de candidatos por búsqueda: margen para encontrar juegos NUEVOS
    expect(igdb.calls).toEqual([{ query: "pirates", limit: 30 }]);
    // 1 IGDB + 2 enrich (2 Brave y 1 LLM cada uno)
    expect(budget.remaining("igdb")).toBe(99);
    expect(budget.remaining("brave")).toBe(96);
    expect(budget.remaining("llm")).toBe(98);
  });

  it("devuelve budget-exhausted sin llamar a IGDB si no hay presupuesto", async () => {
    const { discovery, igdb } = makeSetup({ limits: { igdb: 0 } });

    const attempt = await discovery.discoverByQuery("pirates", 2, undefined, undefined, [], undefined, createDiscoveryRun());

    expect(attempt).toEqual({
      outcome: "budget-exhausted",
      newGames: [],
      budgetExhausted: true,
      variantExhausted: false,
      enrichmentErrors: 0,
    });
    expect(igdb.calls).toHaveLength(0);
  });

  it("devuelve error y libera la reserva si IGDB falla", async () => {
    const { discovery, budget } = makeSetup({
      igdbError: new Error("boom"),
    });

    const attempt = await discovery.discoverByQuery("pirates", 2, undefined, undefined, [], undefined, createDiscoveryRun());

    expect(attempt.outcome).toBe("error");
    expect(attempt.newGames).toHaveLength(0);
    expect(budget.remaining("igdb")).toBe(100);
  });

  it("aprovecha un presupuesto parcial para un enrich y marca budgetExhausted", async () => {
    const { discovery } = makeSetup({
      limits: { igdb: 100, brave: 2, llm: 100 },
      igdbResults: {
        pirates: [makeRaw(2, "A"), makeRaw(3, "B"), makeRaw(4, "C")],
      },
    });

    const attempt = await discovery.discoverByQuery("pirates", 2, undefined, undefined, [], undefined, createDiscoveryRun());

    expect(attempt.outcome).toBe("ok");
    expect(attempt.newGames).toHaveLength(1);
    expect(attempt.budgetExhausted).toBe(true);
  });

  it("reutiliza la lista de la misma query sin repetir la llamada IGDB", async () => {
    const { discovery, igdb, catalog, run } = makeSetup({
      igdbResults: {
        pirates: [
          makeRaw(2, "A"),
          makeRaw(3, "B"),
          makeRaw(103, "DLC", { game_type: 1 }),
          makeRaw(4, "C"),
        ],
      },
    });

    const first = await discovery.discoverByQuery("pirates", 2, undefined, undefined, [], undefined, run);
    const second = await discovery.discoverByQuery("pirates", 2, undefined, undefined, [], undefined, run);

    // Una sola llamada IGDB para las dos unidades
    expect(igdb.calls).toHaveLength(1);
    expect(first.newGames.map((g) => g.sourceId)).toEqual(["2", "3"]);
    expect(second.newGames.map((g) => g.sourceId)).toEqual(["4"]);
    expect(first.variantExhausted).toBe(false);
    expect(second.variantExhausted).toBe(true);
    expect(catalog.createCalls).toBe(3);
  });

  it("ejecuciones concurrentes comparten el pool sin duplicar raws ni llamadas", async () => {
    // Pool precargado con raws compatibles disjuntos por intent: cada
    // ejecución reutiliza SOLO los suyos (el pool es global entre
    // peticiones, pero el run de cada una sigue siendo independiente).
    const cache = new InMemoryDiscoveryCacheRepository();
    await cache.addMany([
      makeRaw(11, "Alpha A1", { keywords: [{ id: 1, name: "a" }] }),
      makeRaw(12, "Alpha A2", { keywords: [{ id: 1, name: "a" }] }),
      makeRaw(21, "Beta B1", { keywords: [{ id: 2, name: "b" }] }),
      makeRaw(22, "Beta B2", { keywords: [{ id: 2, name: "b" }] }),
      makeRaw(99, "Noise", { keywords: [] }),
    ]);
    const { discovery, igdb, catalog } = makeSetup({
      cache,
      igdbResults: {},
      limits: { igdb: 10, brave: 300, llm: 300 },
    });

    const runA = createDiscoveryRun();
    const runB = createDiscoveryRun();
    const intentA = makeIntent({ keywords: ["a"] });
    const intentB = makeIntent({ keywords: ["b"] });

    const [countsA, countsB] = await Promise.all([
      (async () => {
        const attempt = await discovery.discoverByQuery(
          "qa",
          2,
          undefined,
          intentA,
          [],
          undefined,
          runA,
        );
        return { ids: attempt.newGames.map((g) => g.sourceId), attempt };
      })(),
      (async () => {
        const attempt = await discovery.discoverByQuery(
          "qb",
          2,
          undefined,
          intentB,
          [],
          undefined,
          runB,
        );
        return { ids: attempt.newGames.map((g) => g.sourceId), attempt };
      })(),
    ]);

    // Cada una consumió SUS raws compatibles del pool, sin robarse el run
    // ni los candidatos de la otra: el run sigue siendo estado por
    // ejecución, solo el pool (raws) es compartido.
    expect(countsA.ids).toEqual(["11", "12"]);
    expect(countsB.ids).toEqual(["21", "22"]);
    expect(countsA.attempt.variantExhausted).toBe(true);
    expect(countsB.attempt.variantExhausted).toBe(true);
    // El pool absorbió ambas ejecuciones: cero llamadas IGDB nuevas.
    expect(igdb.calls).toHaveLength(0);
    expect(catalog.createCalls).toBe(4);
    // Los promovidos salieron del pool; solo queda el raw incompatible.
    expect((await cache.readAll()).map((raw) => String(raw.id))).toEqual(["99"]);
  });

  it("marca variantExhausted y no llama a IGDB cuando la lista ya está consumida", async () => {
    const { discovery, igdb, run } = makeSetup({
      igdbResults: { pirates: [makeRaw(2, "A")] },
    });

    await discovery.discoverByQuery("pirates", 2, undefined, undefined, [], undefined, run);
    const exhausted = await discovery.discoverByQuery("pirates", 2, undefined, undefined, [], undefined, run);

    expect(igdb.calls).toHaveLength(1);
    expect(exhausted).toEqual({
      outcome: "ok",
      newGames: [],
      budgetExhausted: false,
      variantExhausted: true,
      enrichmentErrors: 0,
    });
  });

  it("una query distinta fuerza una nueva búsqueda IGDB", async () => {
    const { discovery, igdb, run } = makeSetup({
      igdbResults: {
        pirates: [makeRaw(2, "A")],
        "pirates action": [makeRaw(3, "B")],
      },
    });

    await discovery.discoverByQuery("pirates", 2, undefined, undefined, [], undefined, run);
    const second = await discovery.discoverByQuery("pirates action", 2, undefined, undefined, [], undefined, run);

    expect(igdb.calls).toHaveLength(2);
    expect(second.newGames.map((g) => g.sourceId)).toEqual(["3"]);
    expect(second.variantExhausted).toBe(true);
  });

  it("una segunda petición (run nuevo) reutiliza el pool y no repite IGDB", async () => {
    const { discovery, igdb, catalog, cache } = makeSetup({
      igdbResults: {
        pirates: [makeRaw(2, "A"), makeRaw(3, "B"), makeRaw(4, "C"), makeRaw(5, "D")],
      },
    });

    const firstRun = createDiscoveryRun();
    const first = await discovery.discoverByQuery(
      "pirates",
      2,
      undefined,
      undefined,
      [],
      undefined,
      firstRun,
    );
    expect(first.newGames.map((g) => g.sourceId)).toEqual(["2", "3"]);
    expect(igdb.calls).toHaveLength(1);

    // Segunda petición: mismo query, run nuevo. El pool ahorra la llamada.
    const secondRun = createDiscoveryRun();
    const second = await discovery.discoverByQuery(
      "pirates",
      2,
      undefined,
      undefined,
      [],
      undefined,
      secondRun,
    );
    expect(second.newGames.map((g) => g.sourceId)).toEqual(["4", "5"]);
    expect(igdb.calls).toHaveLength(1);
    expect(catalog.createCalls).toBe(4);
    // Los promovidos salieron del pool: no queda nada reutilizable.
    expect(await cache.readAll()).toHaveLength(0);
  });

  it("retira del pool los raws que detecta ya existentes en el catálogo", async () => {
    const catalog = new FakeCatalogLayer();
    catalog.seed([makeGame({ id: 1, sourceId: "2" })]);
    const cache = new InMemoryDiscoveryCacheRepository();
    await cache.addMany([makeRaw(2, "Already Exists"), makeRaw(3, "Brand New")]);
    const { discovery, igdb } = makeSetup({
      catalog,
      cache,
      igdbResults: {},
    });

    const attempt = await discovery.discoverByQuery(
      "pirates",
      2,
      undefined,
      undefined,
      [],
      undefined,
      createDiscoveryRun(),
    );

    // El raw 2 ya estaba en PG: se detecta y se retira del pool sin gastar
    // enrichment; el 3 se promueve y también sale del pool.
    expect(attempt.newGames.map((g) => g.sourceId)).toEqual(["3"]);
    expect(igdb.calls).toHaveLength(0);
    expect(await cache.readAll()).toHaveLength(0);
  });

  it("misma query con distinto intent refetchea: el pool no tiene raws del intent nuevo", async () => {
    const { discovery, igdb, run } = makeSetup({
      filteredResults: [makeRaw(2, "A")],
    });
    const intentA = makeIntent({ keywords: ["x"] });
    const intentB = makeIntent({ keywords: ["y"] });

    await discovery.discoverByQuery("q", 2, undefined, intentA, [], undefined, run);
    const second = await discovery.discoverByQuery("q", 2, undefined, intentB, [], undefined, run);

    // Intent distinto → nueva llamada IGDB aunque el texto coincida: el raw
    // del pool no pasa las puertas duras del intent nuevo y se re-busca.
    expect(igdb.filteredCalls).toHaveLength(2);
    expect(second.variantExhausted).toBe(true);
  });

  it("misma query con el mismo intent no refetchea cuando la lista está consumida", async () => {
    const { discovery, igdb, run } = makeSetup({
      filteredResults: [makeRaw(2, "A")],
    });
    const intent = makeIntent({ keywords: ["x"] });

    await discovery.discoverByQuery("q", 2, undefined, intent, [], undefined, run);
    const second = await discovery.discoverByQuery("q", 2, undefined, intent, [], undefined, run);

    expect(igdb.filteredCalls).toHaveLength(1);
    expect(second.variantExhausted).toBe(true);
    expect(second.newGames).toHaveLength(0);
  });

  it("pre-filtro must: los candidatos condenados se saltan sin gastar Brave/LLM", async () => {
    const { discovery, catalog, enrichment, run } = makeSetup({
      filteredResults: [
        makeRaw(10, "Random Horror", {
          genres: [{ id: 1, name: "Horror" }],
        }),
        makeRaw(11, "Cozy Horror", {
          genres: [{ id: 1, name: "Horror" }],
          keywords: [{ id: 11, name: "cozy" }],
        }),
      ],
    });

    // El intent exige la keyword "cozy" (must): "Random Horror" no la tendrá
    // ni sembrada; "Cozy Horror" sí (la query "horror" siembra "horror" y la
    // keyword IGDB aporta "cozy").
    const intent = makeIntent({
      keywords: ["cozy"],
      semantic: { ...NULL_SEMANTIC, coziness: 0.9 },
    });
    const attempt = await discovery.discoverByQuery(
      "horror",
      2,
      undefined,
      intent,
      [],
      undefined,
      run,
    );

    expect(attempt.newGames.map((game) => game.title)).toEqual([
      "Cozy Horror",
    ]);
    // El condenado no consumió enriquecimiento
    expect(enrichment.enrichCalls).toHaveLength(1);
    expect(catalog.createCalls).toBe(1);
  });

  it("sin intent no hay pre-filtro must (comportamiento previo intacto)", async () => {
    const { discovery, catalog } = makeSetup({
      igdbResults: {
        pirates: [makeRaw(2, "Pirate Gold", { keywords: [] })],
      },
    });

    const attempt = await discovery.discoverByQuery("pirates", 2, undefined, undefined, [], undefined, createDiscoveryRun());

    expect(attempt.newGames).toHaveLength(1);
    expect(catalog.createCalls).toBe(1);
  });

  it("siembra las palabras de la query en las keywords de la ficha creada", async () => {
    const { discovery, catalog, run } = makeSetup({
      igdbResults: {
        batman: [makeRaw(201, "Dark Knight Game", { keywords: [] })],
      },
    });

    await discovery.discoverByQuery("batman", 1, undefined, undefined, [], undefined, run);

    expect(catalog.createCalls).toBe(1);
    // Ficha guardada = IGDB (sin keywords) ∪ búsqueda ("batman") + enrichment
    const created = catalog.all()[0];
    expect(created.keywords).toContain("batman");
  });

  it("siembra la query completa como UNA keyword además de sus palabras", async () => {
    const { discovery, catalog, run } = makeSetup({
      igdbResults: {
        "car wash": [makeRaw(301, "Washy Game", { keywords: [] })],
      },
    });

    await discovery.discoverByQuery("car wash", 1, undefined, undefined, [], undefined, run);

    // El intent pedirá "car wash" como frase: debe casar con la ficha
    expect(catalog.createCalls).toBe(1);
    const created = catalog.all()[0];
    expect(created.keywords).toContain("car wash");
    expect(created.keywords).toContain("wash");
  });

  it("una lista IGDB vacía no se cachea como agotada: la query se reintenta", async () => {
    const { discovery, igdb, run } = makeSetup({
      igdbResults: { pirates: [] },
    });

    const first = await discovery.discoverByQuery("pirates", 2, undefined, undefined, [], undefined, run);
    expect(first.newGames).toHaveLength(0);
    expect(first.variantExhausted).toBe(true);

    const second = await discovery.discoverByQuery("pirates", 2, undefined, undefined, [], undefined, run);
    expect(second.newGames).toHaveLength(0);
    expect(second.variantExhausted).toBe(true);
    // Dos búsquedas: el cursor vacío NO envenena la query
    expect(igdb.calls).toHaveLength(2);
  });

  it("gate de calidad: salta candidatos sin señal comunitaria y conserva los desconocidos", async () => {
    const { discovery, catalog, run } = makeSetup({
      igdbResults: {
        pirates: [
          makeRaw(2, "Has Ratings", { total_rating_count: 3 }),
          makeRaw(3, "Too Few", { total_rating_count: 2 }),
          makeRaw(4, "Unknown Rating"),
        ],
      },
    });

    const attempt = await discovery.discoverByQuery("pirates", 3, undefined, undefined, [], undefined, run);

    expect(attempt.newGames.map((game) => game.title)).toEqual([
      "Has Ratings",
      "Unknown Rating",
    ]);
    // El descartado no consume Brave/LLM
    expect(catalog.createCalls).toBe(2);
  });
});

describe("DiscoveryManager.discoverByName", () => {
  it("devuelve la ficha existente sin gastar enrichment", async () => {
    const catalog = new FakeCatalogLayer();
    catalog.seed([makeGame({ id: 7 })]);
    const { discovery, enrichment, budget } = makeSetup({
      catalog,
      igdbResults: { "Dark Souls III": [makeRaw(7, "Other Name")] },
    });

    const result = await discovery.discoverByName("Dark Souls III");

    expect(result).toEqual({ status: "found", game: catalog.get(7) });
    expect(enrichment.enrichCalls).toHaveLength(0);
    expect(budget.remaining("brave")).toBe(100);
  });

  it("crea y enriquece la ficha cuando no existe", async () => {
    const { discovery, catalog } = makeSetup({
      igdbResults: { "Unknown Game": [makeRaw(9, "Brand New Game")] },
    });

    const result = await discovery.discoverByName("Unknown Game");

    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.game.sourceId).toBe("9");
    }
    expect(catalog.createCalls).toBe(1);
  });

  it("las anclas no pasan por el gate de calidad (petición explícita del usuario)", async () => {
    const { discovery, catalog } = makeSetup({
      igdbResults: {
        "Obscure Game": [makeRaw(9, "Obscure Game", { total_rating_count: 0 })],
      },
    });

    const result = await discovery.discoverByName("Obscure Game");

    expect(result.status).toBe("found");
    expect(catalog.createCalls).toBe(1);
  });

  it("devuelve not-found cuando IGDB no devuelve nada", async () => {
    const { discovery, budget } = makeSetup({});

    const result = await discovery.discoverByName("Nothing");

    expect(result.status).toBe("not-found");
    expect(budget.remaining("igdb")).toBe(99);
  });

  it("devuelve budget-exhausted sin llamadas si no hay presupuesto IGDB", async () => {
    const { discovery, igdb } = makeSetup({ limits: { igdb: 0 } });

    const result = await discovery.discoverByName("Whatever");

    expect(result.status).toBe("budget-exhausted");
    expect(igdb.calls).toHaveLength(0);
  });
});

describe("DiscoveryManager.reEnrich", () => {
  it("actualiza semánticas conservando valores conocidos y datos objetivos", async () => {
    const game = makeGame({
      id: 5,
      sourceId: "55",
      title: "Pirates!",
      keywords: ["pirates"],
      genres: ["ROLE_PLAYING_RPG"],
      difficulty: 0.9,
    });
    const catalog = new FakeCatalogLayer();
    catalog.seed([game]);
    const enrichment = new FakeEnrichment(
      makeGameEnrichment({
        semantic: { ...NULL_SEMANTIC, difficulty: null, horror: 0.8 },
        additionalKeywords: ["treasure"],
        description_es: "Descripción nueva",
      }),
    );
    const { discovery } = makeSetup({
      catalog,
      enrichment,
      igdbResults: { "Pirates!": [makeRaw(55, "Whatever Name")] },
    });

    const result = await discovery.reEnrich(game);

    expect(result.status).toBe("updated");
    const updated = catalog.get(5)!;
    expect(updated.difficulty).toBe(0.9); // null del enrichment = conservar
    expect(updated.horror).toBe(0.8); // evidencia nueva = actualizar
    expect(updated.keywords).toEqual(["pirates", "treasure"]);
    expect(updated.description_es).toBe("Descripción nueva");
    expect(updated.genres).toEqual(["ROLE_PLAYING_RPG"]); // objetivos estables
    expect(updated.title).toBe("Pirates!");
  });

  it("fichas sin sourceId (seed): re-enrich por título, adopción de objetivos y compañías", async () => {
    const game = makeGame({
      id: 5,
      sourceId: null,
      title: "Elden Ring",
      developers: [],
      publishers: [],
    });
    const catalog = new FakeCatalogLayer();
    catalog.seed([game]);
    const { discovery } = makeSetup({
      catalog,
      igdbResults: {
        "Elden Ring": [
          makeRaw(77, "Elden Ring", {
            genres: [{ id: 1, name: "Role-playing (RPG)" }],
            involved_companies: [
              {
                id: 1,
                company: { id: 10, name: "FromSoftware" },
                developer: true,
                publisher: false,
              },
              {
                id: 2,
                company: { id: 11, name: "Bandai Namco" },
                developer: false,
                publisher: true,
              },
            ],
          }),
        ],
      },
    });

    const result = await discovery.reEnrich(game);

    expect(result.status).toBe("updated");
    const updated = catalog.get(5)!;
    // Identidad y objetivo adoptados de IGDB (la ficha no tenía source_id)
    expect(updated.sourceId).toBe("77");
    expect(updated.genres).toContain("ROLE_PLAYING_RPG");
    // Compañías rellenadas desde involved_companies
    expect(updated.developers).toContain("FromSoftware");
    expect(updated.publishers).toContain("Bandai Namco");
    // Semánticas del enrichment aplicadas
    expect(updated.difficulty).toBe(0.6);
  });

  it("fichas con compañías conocidas: nunca se degradan", async () => {
    const game = makeGame({
      id: 5,
      sourceId: "55",
      title: "Pirates!",
      developers: ["Akella"],
      publishers: ["1C Company"],
    });
    const catalog = new FakeCatalogLayer();
    catalog.seed([game]);
    const { discovery } = makeSetup({
      catalog,
      igdbResults: {
        "Pirates!": [
          makeRaw(55, "Pirates!", {
            involved_companies: [
              {
                id: 1,
                company: { id: 99, name: "Otra Studio" },
                developer: true,
                publisher: true,
              },
            ],
          }),
        ],
      },
    });

    const result = await discovery.reEnrich(game);

    expect(result.status).toBe("updated");
    const updated = catalog.get(5)!;
    expect(updated.developers).toEqual(["Akella"]);
    expect(updated.publishers).toEqual(["1C Company"]);
  });

  it("match por título tolera apóstrofes tipográficos y numeración romana (Baldur’s Gate III)", async () => {
    // El seed guarda "Baldur's Gate 3"; IGDB usa "Baldur’s Gate III"
    const game = makeGame({ id: 6, sourceId: null, title: "Baldur's Gate 3" });
    const catalog = new FakeCatalogLayer();
    catalog.seed([game]);
    const { discovery } = makeSetup({
      catalog,
      igdbResults: {
        "Baldur's Gate 3": [
          makeRaw(88, "Baldur’s Gate III", {
            involved_companies: [
              {
                id: 1,
                company: { id: 12, name: "Larian Studios" },
                developer: true,
                publisher: true,
              },
            ],
          }),
        ],
      },
    });

    const result = await discovery.reEnrich(game);

    expect(result.status).toBe("updated");
    const updated = catalog.get(6)!;
    expect(updated.sourceId).toBe("88");
    expect(updated.developers).toContain("Larian Studios");
  });

  it("match por título con título canónico más largo (The Witcher 3: Wild Hunt)", async () => {
    const game = makeGame({ id: 7, sourceId: null, title: "The Witcher 3" });
    const catalog = new FakeCatalogLayer();
    catalog.seed([game]);
    const { discovery } = makeSetup({
      catalog,
      igdbResults: {
        "The Witcher 3": [
          makeRaw(89, "The Witcher 3: Wild Hunt", {
            involved_companies: [
              {
                id: 1,
                company: { id: 13, name: "CD Projekt Red" },
                developer: true,
                publisher: true,
              },
            ],
          }),
        ],
      },
    });

    const result = await discovery.reEnrich(game);

    expect(result.status).toBe("updated");
    expect(catalog.get(7)!.developers).toContain("CD Projekt Red");
  });

  it("devuelve not-found cuando IGDB no encuentra el juego y consume la llamada", async () => {
    const game = makeGame({ id: 5, sourceId: "55", title: "Pirates!" });
    const { discovery, budget } = makeSetup({
      igdbResults: { "Pirates!": [makeRaw(99, "Unrelated")] },
    });

    const result = await discovery.reEnrich(game);

    expect(result.status).toBe("not-found");
    expect(budget.remaining("igdb")).toBe(99);
  });

  it("se salta cuando no hay updater disponible", async () => {
    const game = makeGame({ id: 5, sourceId: "55", title: "Pirates!" });
    const catalog = new FakeCatalogLayer();
    catalog.seed([game]);
    const igdb = new FakeIgdbClient({ "Pirates!": [makeRaw(55, "X")] });
    const budget = new InMemoryBudgetLedger({ igdb: 10, brave: 10, llm: 10 });
    const discovery = new DiscoveryManager(
      igdb,
      {
        enrich: async () => {
          throw new Error("not used");
        },
      },
      catalog,
      new InMemoryDiscoveryCacheRepository(),
      budget,
      RECOMMENDATION_CONFIG,
    );

    const result = await discovery.reEnrich(game);

    expect(result.status).toBe("skipped");
    expect(budget.remaining("brave")).toBe(10);
  });
});

describe("knownSemanticsCount", () => {
  it("cuenta solo las semánticas no nulas", () => {
    expect(knownSemanticsCount(makeGame({ id: 1 }))).toBe(0);
    expect(
      knownSemanticsCount(makeGame({ id: 2, difficulty: 0.5, horror: 0.1 })),
    ).toBe(2);
  });
});

describe("RELAX_ORDER y dropRelaxGroup", () => {
  it("suelta en orden años → perspectives → platforms → modes → themes → genres → keywords", () => {
    expect(RELAX_ORDER).toEqual([
      "years",
      "perspectives",
      "platforms",
      "gameModes",
      "themes",
      "genres",
      "keywords",
    ]);
  });

  it("suelta solo el grupo pedido y jamás toca los excluidos", () => {
    const intent = makeIntent({
      keywords: ["cowboys"],
      objective: {
        genres: ["ADVENTURE"],
        themes: ["ACTION", "OPEN_WORLD"],
        platforms: ["PC"],
        gameModes: null,
        perspectives: null,
      },
      releaseYear: 2010,
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
    });
    const dropped = dropRelaxGroup(intent, "themes");
    expect(dropped.objective?.themes).toBeNull();
    expect(dropped.objective?.genres).toEqual(["ADVENTURE"]);
    expect(dropped.keywords).toEqual(["cowboys"]);
    expect(dropped.releaseYear).toBe(2010);
    expect(dropped.excluded?.keywords).toEqual(["mods"]);
  });
});

describe("DiscoveryManager.discoverRelaxed", () => {
  const COWBOYS_INTENT = makeIntent({
    keywords: ["cowboys"],
    objective: {
      genres: null,
      themes: ["ACTION", "OPEN_WORLD"],
      platforms: null,
      gameModes: null,
      perspectives: null,
    },
  });

  it("criba en cascada: lo que falla el must completo pasa al soltar themes", async () => {
    const { discovery, catalog, igdb, budget } = makeSetup({
      filteredResults: [
        makeRaw(201, "Cowboy Action", {
          themes: [{ id: 1, name: "Action" }],
          keywords: [{ id: 5, name: "cowboys" }],
        }),
      ],
    });

    const attempt = await discovery.discoverRelaxed(
      "cowboys",
      8,
      undefined,
      COWBOYS_INTENT,
    );

    expect(attempt.outcome).toBe("ok");
    expect(attempt.newGames).toHaveLength(1);
    // Grupos vacíos (años, perspectives, platforms, modes) se saltan sin ruido.
    expect(attempt.droppedGroups).toEqual(["themes"]);
    expect(attempt.relaxedIntent.objective?.themes).toBeNull();
    expect(attempt.relaxedIntent.keywords).toEqual(["cowboys"]);
    // 1 llamada estricta previa no hay (fresco): amplia + where relajado.
    // (la rica no existe aquí: 1 raw < 2*8).
    expect(igdb.filteredCalls).toHaveLength(2);
    expect(catalog.createCalls).toBe(1);
    expect(budget.remaining("igdb")).toBe(98);
  });

  it("sin red flags relajados: los excluidos nunca se crean", async () => {
    const { discovery, catalog } = makeSetup({
      filteredResults: [
        makeRaw(202, "Cowboy Mods", {
          themes: [{ id: 1, name: "Action" }],
          keywords: [{ id: 5, name: "cowboys" }],
        }),
      ],
    });
    const intent = makeIntent({
      keywords: ["cowboys"],
      objective: {
        genres: null,
        themes: ["ACTION", "OPEN_WORLD"],
        platforms: null,
        gameModes: null,
        perspectives: null,
      },
      excluded: {
        keywords: ["cowboys"],
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

    const attempt = await discovery.discoverRelaxed(
      "cowboys",
      8,
      undefined,
      intent,
    );

    expect(attempt.newGames).toHaveLength(0);
    expect(catalog.createCalls).toBe(0);
  });

  it("sin presupuesto IGDB no llama y marca budget-exhausted", async () => {
    const { discovery, igdb } = makeSetup({ limits: { igdb: 0 } });

    const attempt = await discovery.discoverRelaxed(
      "cowboys",
      8,
      undefined,
      COWBOYS_INTENT,
    );

    expect(attempt.outcome).toBe("budget-exhausted");
    expect(attempt.budgetExhausted).toBe(true);
    expect(igdb.filteredCalls).toHaveLength(0);
  });

  it("recicla la lista estricta y completa con amplia + where relajado", async () => {
    const { discovery, igdb, run } = makeSetup({
      filteredResults: [
        makeRaw(201, "Cowboy Action", {
          themes: [{ id: 1, name: "Action" }],
          keywords: [{ id: 5, name: "cowboys" }],
        }),
      ],
    });

    // La pasada estricta la tumba el must pero deja el raw en el pool.
    const strict = await discovery.discoverByQuery(
      "cowboys",
      2,
      undefined,
      COWBOYS_INTENT,
      [],
      undefined,
      run,
    );
    expect(strict.newGames).toHaveLength(0);
    expect(igdb.filteredCalls).toHaveLength(1);

    const attempt = await discovery.discoverRelaxed(
      "cowboys cowgirls",
      8,
      undefined,
      COWBOYS_INTENT,
    );

    // 1 estricta + amplia + where relajado (los raws del pool no llenan).
    expect(igdb.filteredCalls).toHaveLength(3);
    expect(attempt.newGames).toHaveLength(1);
    expect(attempt.droppedGroups).toEqual(["themes"]);
  });

  it("sin caché la amplia usa el PRIMER keyword como texto (no la frase)", async () => {
    const { discovery, igdb } = makeSetup({
      filteredResults: [
        makeRaw(201, "Cowboy Action", {
          themes: [{ id: 1, name: "Action" }],
          keywords: [{ id: 5, name: "cowboys" }],
        }),
      ],
    });

    const attempt = await discovery.discoverRelaxed(
      "cowboys cowgirls",
      8,
      undefined,
      COWBOYS_INTENT,
    );

    expect(igdb.filteredCalls).toHaveLength(2);
    expect(igdb.filteredCalls[0]?.text).toBe("cowboys");
    expect(igdb.filteredCalls[1]?.text).toBeUndefined();
    expect(attempt.newGames).toHaveLength(1);
  });

  it("lista agotada con mismo intent pide la página siguiente (offset)", async () => {
    const raws = Array.from({ length: 35 }, (_, index) =>
      makeRaw(300 + index, `Pirate ${index}`),
    );
    const { discovery, igdb, run } = makeSetup({
      filteredResults: raws,
      limits: { igdb: 10, brave: 300, llm: 300 },
    });
    const intent = makeIntent({ keywords: ["pirates"] });

    const first = await discovery.discoverByQuery(
      "pirates",
      100,
      undefined,
      intent,
      [],
      undefined,
      run,
    );
    expect(first.newGames).toHaveLength(30);
    expect(igdb.filteredCalls).toHaveLength(1);
    expect(igdb.filteredCalls[0]?.offset).toBeUndefined();

    const second = await discovery.discoverByQuery(
      "pirates",
      100,
      undefined,
      intent,
      [],
      undefined,
      run,
    );
    expect(second.newGames).toHaveLength(5);
    expect(igdb.filteredCalls).toHaveLength(2);
    expect(igdb.filteredCalls[1]?.offset).toBe(30);

    // Tercera: tope de 60 por lista → agotada sin más llamadas.
    const third = await discovery.discoverByQuery(
      "pirates",
      100,
      undefined,
      intent,
      [],
      undefined,
      run,
    );
    expect(third.newGames).toHaveLength(0);
    expect(igdb.filteredCalls).toHaveLength(2);
  });
});
