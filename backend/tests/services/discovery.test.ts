import { describe, expect, it } from "vitest";
import {
  DiscoveryManager,
  knownSemanticsCount,
} from "../../src/orchestrator/discovery.js";
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
  } = {},
) {
  const catalog = opts.catalog ?? new FakeCatalogLayer();
  const igdb = new FakeIgdbClient(opts.igdbResults ?? {}, opts.igdbError);
  igdb.filteredResults = opts.filteredResults ?? [];
  const enrichment = opts.enrichment ?? new FakeEnrichment();
  const budget = new InMemoryBudgetLedger({
    igdb: opts.limits?.igdb ?? 100,
    brave: opts.limits?.brave ?? 100,
    llm: opts.limits?.llm ?? 100,
  });
  const discovery = new DiscoveryManager(
    igdb,
    enrichment,
    catalog,
    budget,
    RECOMMENDATION_CONFIG,
  );
  return { discovery, catalog, igdb, enrichment, budget };
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

    const attempt = await discovery.discoverByQuery("pirates", 2);

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

    const attempt = await discovery.discoverByQuery("pirates", 2);

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

    const attempt = await discovery.discoverByQuery("pirates", 2);

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

    const attempt = await discovery.discoverByQuery("pirates", 2);

    expect(attempt.outcome).toBe("ok");
    expect(attempt.newGames).toHaveLength(1);
    expect(attempt.budgetExhausted).toBe(true);
  });

  it("reutiliza la lista de la misma query sin repetir la llamada IGDB", async () => {
    const { discovery, igdb, catalog } = makeSetup({
      igdbResults: {
        pirates: [
          makeRaw(2, "A"),
          makeRaw(3, "B"),
          makeRaw(103, "DLC", { game_type: 1 }),
          makeRaw(4, "C"),
        ],
      },
    });

    const first = await discovery.discoverByQuery("pirates", 2);
    const second = await discovery.discoverByQuery("pirates", 2);

    // Una sola llamada IGDB para las dos unidades
    expect(igdb.calls).toHaveLength(1);
    expect(first.newGames.map((g) => g.sourceId)).toEqual(["2", "3"]);
    expect(second.newGames.map((g) => g.sourceId)).toEqual(["4"]);
    expect(first.variantExhausted).toBe(false);
    expect(second.variantExhausted).toBe(true);
    expect(catalog.createCalls).toBe(3);
  });

  it("marca variantExhausted y no llama a IGDB cuando la lista ya está consumida", async () => {
    const { discovery, igdb } = makeSetup({
      igdbResults: { pirates: [makeRaw(2, "A")] },
    });

    await discovery.discoverByQuery("pirates", 2);
    const exhausted = await discovery.discoverByQuery("pirates", 2);

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
    const { discovery, igdb } = makeSetup({
      igdbResults: {
        pirates: [makeRaw(2, "A")],
        "pirates action": [makeRaw(3, "B")],
      },
    });

    await discovery.discoverByQuery("pirates", 2);
    const second = await discovery.discoverByQuery("pirates action", 2);

    expect(igdb.calls).toHaveLength(2);
    expect(second.newGames.map((g) => g.sourceId)).toEqual(["3"]);
    expect(second.variantExhausted).toBe(true);
  });

  it("pre-filtro must: los candidatos condenados se saltan sin gastar Brave/LLM", async () => {
    const { discovery, catalog, enrichment } = makeSetup({
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

    const attempt = await discovery.discoverByQuery("pirates", 2);

    expect(attempt.newGames).toHaveLength(1);
    expect(catalog.createCalls).toBe(1);
  });

  it("siembra las palabras de la query en las keywords de la ficha creada", async () => {
    const { discovery, catalog } = makeSetup({
      igdbResults: {
        batman: [makeRaw(201, "Dark Knight Game", { keywords: [] })],
      },
    });

    await discovery.discoverByQuery("batman", 1);

    expect(catalog.createCalls).toBe(1);
    // Ficha guardada = IGDB (sin keywords) ∪ búsqueda ("batman") + enrichment
    const created = catalog.all()[0];
    expect(created.keywords).toContain("batman");
  });

  it("siembra la query completa como UNA keyword además de sus palabras", async () => {
    const { discovery, catalog } = makeSetup({
      igdbResults: {
        "car wash": [makeRaw(301, "Washy Game", { keywords: [] })],
      },
    });

    await discovery.discoverByQuery("car wash", 1);

    // El intent pedirá "car wash" como frase: debe casar con la ficha
    expect(catalog.createCalls).toBe(1);
    const created = catalog.all()[0];
    expect(created.keywords).toContain("car wash");
    expect(created.keywords).toContain("wash");
  });

  it("una lista IGDB vacía no se cachea como agotada: la query se reintenta", async () => {
    const { discovery, igdb } = makeSetup({
      igdbResults: { pirates: [] },
    });

    const first = await discovery.discoverByQuery("pirates", 2);
    expect(first.newGames).toHaveLength(0);
    expect(first.variantExhausted).toBe(true);

    const second = await discovery.discoverByQuery("pirates", 2);
    expect(second.newGames).toHaveLength(0);
    expect(second.variantExhausted).toBe(true);
    // Dos búsquedas: el cursor vacío NO envenena la query
    expect(igdb.calls).toHaveLength(2);
  });

  it("gate de calidad: salta candidatos sin señal comunitaria y conserva los desconocidos", async () => {
    const { discovery, catalog } = makeSetup({
      igdbResults: {
        pirates: [
          makeRaw(2, "Has Ratings", { total_rating_count: 3 }),
          makeRaw(3, "Too Few", { total_rating_count: 2 }),
          makeRaw(4, "Unknown Rating"),
        ],
      },
    });

    const attempt = await discovery.discoverByQuery("pirates", 3);

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
