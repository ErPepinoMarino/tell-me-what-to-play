import { describe, expect, it, vi } from "vitest";
// El mock va ANTES de los imports del cÃ³digo real (Vitest lo hoistea).
// Reproducimos la exportaciÃ³n de lib/ai.js con un vi.fn() que podemos configurar.
vi.mock("../../src/lib/ai.js", async () => ({
  gameIntentAIModel: vi.fn(),
  gameRelationAIModel: vi.fn(),
}));
//Ahora sÃ­ importamos el cÃ³digo real que queremos testear.
import {
  intentService,
  applyRefineDelta,
  classifyRelation,
  createBudgetedIntentExtractor,
} from "../../src/services/intentService.js";
import { gameIntentAIModel, gameRelationAIModel } from "../../src/lib/ai.js";
import type {
  GameSearchIntent,
  RefineDelta,
} from "../../src/types/GameSearchIntent.js";
import { InMemoryBudgetLedger } from "../../src/budget/budgetLedger.js";
import { makeIntent, NULL_SEMANTIC } from "../helpers/fakes.js";

const fakeIntent: GameSearchIntent = {
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
//Puesto que basicamente devuelve lo que le pasamos ha poco que testear:
//Testearemos que devuelve lo que le da el modelo y que propaga los errores del modelo.
describe("intentService.extractIntent", () => {
  it("Returns the model output as is", async () => {
    // 1. Configura el fake: cuando el servicio pida el modelo, entrega este
    vi.mocked(gameIntentAIModel).mockReturnValue({
      invoke: vi.fn().mockResolvedValue(fakeIntent),
    } as never);
    // 2. Llama al servicio
    const result = await intentService.extractIntent("some input");

    // 3. Comprueba que el resultado sea el fakeIntent
    expect(result).toEqual(fakeIntent);
  });
  it("propagates model errors", async () => {
    // ARRANGE: el "modelo" no responde, revienta
    vi.mocked(gameIntentAIModel).mockReturnValue({
      invoke: vi.fn().mockRejectedValue(new Error("model unavailable")),
    } as never);

    // ACT + ASSERT en uno: el servicio NO captura, deja pasar el error
    await expect(intentService.extractIntent("any text")).rejects.toThrow(
      "model unavailable",
    );
  });
});

describe("createBudgetedIntentExtractor", () => {
  it("returns the intent and commits 1 LLM call", async () => {
    vi.mocked(gameIntentAIModel).mockReturnValue({
      invoke: vi.fn().mockResolvedValue(fakeIntent),
    } as never);
    const budget = new InMemoryBudgetLedger({ igdb: 10, brave: 10, llm: 5 });
    const extractor = createBudgetedIntentExtractor(budget);

    const result = await extractor.extract("quiero un RPG de piratas");

    expect(result).toEqual(fakeIntent);
    expect(budget.remaining("llm")).toBe(4);
  });

  it("releases the reservation when the model fails", async () => {
    vi.mocked(gameIntentAIModel).mockReturnValue({
      invoke: vi.fn().mockRejectedValue(new Error("model down")),
    } as never);
    const budget = new InMemoryBudgetLedger({ igdb: 10, brave: 10, llm: 5 });
    const extractor = createBudgetedIntentExtractor(budget);

    await expect(extractor.extract("anything")).rejects.toThrow("model down");
    expect(budget.remaining("llm")).toBe(5);
  });

  it("throws without calling the model when the LLM budget is dry", async () => {
    const invoke = vi.fn();
    vi.mocked(gameIntentAIModel).mockReturnValue({ invoke } as never);
    const budget = new InMemoryBudgetLedger({ igdb: 10, brave: 10, llm: 0 });
    const extractor = createBudgetedIntentExtractor(budget);

    await expect(extractor.extract("anything")).rejects.toThrow(
      "LLM daily budget exhausted",
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("intentService fresh extraction", () => {
  it("extraction is ALWAYS fresh: no session context in the system message", async () => {
    const invoke = vi.fn().mockResolvedValue(fakeIntent);
    vi.mocked(gameIntentAIModel).mockReturnValue({ invoke } as never);

    await intentService.extractIntent("un RPG de piratas");

    const messages = invoke.mock.calls[0][0] as {
      role: string;
      content: string;
    }[];
    const system = messages.find((m) => m.role === "system");
    // Reglas base del contrato presenteâ€¦
    expect(system?.content).toContain("SEMANTIC attributes, NEVER keywords");
    // â€¦y el contexto de sesiÃ³n vive en el clasificador/delta, no aquÃ­.
    expect(system?.content).not.toContain("Conversation context");
  });
});

describe("applyRefineDelta", () => {
  const PREVIOUS: GameSearchIntent = {
    gameReferenced: null,
    objective: {
      genres: ["ROLE_PLAYING_RPG"],
      themes: null,
      platforms: null,
      gameModes: null,
      perspectives: null,
    },
    keywords: ["pirates"],
    releaseYear: null,
    yearFrom: null,
    yearTo: null,
    excluded: null,
    relation: null,
    semantic: null,
  };

  const delta = (overrides: Partial<RefineDelta> = {}): RefineDelta => ({
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
    },
    excluded: null,
    ...overrides,
  });

  it("delta vacÃ­o = intent previo intacto (relation refine)", () => {
    const out = applyRefineDelta(PREVIOUS, delta());
    expect(out.keywords).toEqual(["pirates"]);
    expect(out.objective?.genres).toEqual(["ROLE_PLAYING_RPG"]);
    expect(out.relation).toBe("refine");
  });

  it("add keywords: uniÃ³n sin duplicados y conserva lo previo", () => {
    const out = applyRefineDelta(
      PREVIOUS,
      delta({ add: { ...delta().add!, keywords: ["2d", "Pirates"] } }),
    );
    expect(out.keywords).toEqual(["pirates", "2d"]);
    expect(out.objective?.genres).toEqual(["ROLE_PLAYING_RPG"]);
  });

  it("remove keywords: quita el pedido y conserva el resto", () => {
    const withTwo = { ...PREVIOUS, keywords: ["pirates", "2d"] };
    const out = applyRefineDelta(
      withTwo,
      delta({ remove: { ...delta().remove!, keywords: ["2d"] } }),
    );
    expect(out.keywords).toEqual(["pirates"]);
  });

  it("override semÃ¡ntico y anulaciÃ³n por remove.semantic", () => {
    const out = applyRefineDelta(
      PREVIOUS,
      delta({
        add: {
          ...delta().add!,
          semantic: { ...NULL_SEMANTIC, violence: 0.9 },
        },
      }),
    );
    expect(out.semantic?.violence).toBe(0.9);

    const out2 = applyRefineDelta(
      out,
      delta({ remove: { ...delta().remove!, semantic: ["violence"] } }),
    );
    expect(out2.semantic?.violence).toBeNull();
  });

  it("remove de aÃ±os y exclusiÃ³n nueva", () => {
    const withYears = { ...PREVIOUS, yearFrom: 1990, yearTo: 1999 };
    const out = applyRefineDelta(
      withYears,
      delta({
        remove: { ...delta().remove!, yearFrom: true, yearTo: true },
        excluded: {
          keywords: null,
          genres: null,
          themes: ["HORROR"],
          platforms: null,
          gameModes: null,
          perspectives: null,
          releaseYear: null,
          yearFrom: null,
          yearTo: null,
        },
      }),
    );
    expect(out.yearFrom).toBeNull();
    expect(out.yearTo).toBeNull();
    expect(out.excluded?.themes).toEqual(["HORROR"]);
  });
});


describe("classifyRelation", () => {
  it("devuelve la relaciÃ³n que decide el modelo", async () => {
    const invoke = vi.fn().mockResolvedValue({ relation: "refine" });
    vi.mocked(gameRelationAIModel).mockReturnValue({ invoke } as never);

    const relation = await classifyRelation(
      "mÃ¡s violento",
      makeIntent({ keywords: ["violence"] }),
    );

    expect(relation).toBe("refine");
    const messages = invoke.mock.calls[0][0] as { role: string; content: string }[];
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("Previous search intent");
    expect(messages[1].content).toContain("mÃ¡s violento");
  });

  it("el extractor con presupuesto clasifica y gasta 1 llamada LLM", async () => {
    const invoke = vi.fn().mockResolvedValue({ relation: "new" });
    vi.mocked(gameRelationAIModel).mockReturnValue({ invoke } as never);
    const budget = new InMemoryBudgetLedger({ igdb: 10, brave: 10, llm: 5 });
    const extractor = createBudgetedIntentExtractor(budget);

    const relation = await extractor.classifyRelation!("futbol", makeIntent());

    expect(relation).toBe("new");
    expect(budget.remaining("llm")).toBe(4);
  });

  it("sin presupuesto de LLM asume bÃºsqueda nueva (no bloquea la bÃºsqueda fresca)", async () => {
    const budget = new InMemoryBudgetLedger({ igdb: 10, brave: 10, llm: 0 });
    const extractor = createBudgetedIntentExtractor(budget);

    const relation = await extractor.classifyRelation!("mÃ¡s violento", makeIntent());

    expect(relation).toBe("new");
  });
});
