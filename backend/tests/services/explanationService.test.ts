import { describe, expect, it, vi, afterEach } from "vitest";
// El mock va ANTES de los imports del código real (Vitest lo hoistea).
vi.mock("../../src/lib/explanationAi.js", async () => ({
  gameExplanationAIModel: vi.fn(),
}));
import { gameExplanationAIModel } from "../../src/lib/explanationAi.js";
import {
  createExplanationComposer,
  fallbackExplanation,
  type ExplanationInput,
} from "../../src/services/explanationService.js";
import { InMemoryBudgetLedger } from "../../src/budget/budgetLedger.js";
import { makeIntent } from "../helpers/fakes.js";

const PIRATES_INTENT = makeIntent({ keywords: ["pirates"] });

function makeInput(
  overrides: Partial<ExplanationInput> = {},
): ExplanationInput {
  return {
    action: "search",
    userMessage: "quiero un juego de piratas",
    intent: PIRATES_INTENT,
    results: [{ title: "Pirates Cove", tier: "valid", topReasons: [] }],
    requestedGames: [],
    notices: [],
    meta: {
      evaluatedCandidates: 10,
      partial: false,
      exhaustedPool: false,
      tierCounts: { excellent: 1, valid: 2, weak: 0, invalid: 3 },
    },
    ...overrides,
  };
}

function makeComposer(
  options: { text?: string; error?: boolean; llmLimit?: number } = {},
) {
  const invoke = vi.fn(async () => {
    if (options.error) throw new Error("model down");
    return { content: options.text ?? "Texto del modelo" };
  });
  vi.mocked(gameExplanationAIModel).mockReturnValue({ invoke } as never);
  const budget = new InMemoryBudgetLedger({
    igdb: 10,
    brave: 10,
    llm: options.llmLimit ?? 10,
  });
  const composer = createExplanationComposer(budget);
  return { composer, budget, invoke };
}

describe("createExplanationComposer", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("devuelve el texto del LLM y contabiliza el presupuesto", async () => {
    const { composer, budget, invoke } = makeComposer({
      text: "Te recomiendo Pirates Cove.",
    });

    const text = await composer.compose(makeInput());

    expect(text).toBe("Te recomiendo Pirates Cove.");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(budget.remaining("llm")).toBe(9);
  });

  it("fallback determinista si el modelo falla, con presupuesto liberado", async () => {
    const { composer, budget, invoke } = makeComposer({ error: true });

    const text = await composer.compose(makeInput());

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(text).toContain("He entendido");
    expect(budget.remaining("llm")).toBe(10);
  });

  it("fallback determinista si el modelo devuelve texto vacío", async () => {
    const { composer } = makeComposer({ text: "" });

    const text = await composer.compose(makeInput());

    expect(text).toContain("He entendido");
  });

  it("fallback sin llamar al modelo cuando no hay presupuesto LLM", async () => {
    const { composer, invoke } = makeComposer({ llmLimit: 0 });

    const text = await composer.compose(makeInput());

    expect(text).toContain("He entendido");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("fallbackExplanation", () => {
  it("con intención vacía pide más detalle en lugar de inventar", () => {
    const text = fallbackExplanation(
      makeInput({ intent: makeIntent(), results: [] }),
    );

    expect(text).toContain("Cuéntame");
  });

  it("describe intención, candidatos, anclas y pool agotado", () => {
    const text = fallbackExplanation(
      makeInput({
        intent: makeIntent({
          keywords: ["pirates"],
          objective: {
            genres: ["ROLE_PLAYING_RPG"],
            themes: null,
            platforms: null,
            gameModes: null,
            perspectives: null,
          },
          semantic: null,
        }),
        requestedGames: ["GTA V"],
        results: [
          { title: "A", tier: "valid", topReasons: [] },
          { title: "B", tier: "valid", topReasons: [] },
        ],
        meta: {
          evaluatedCandidates: 42,
          partial: true,
          exhaustedPool: true,
          tierCounts: { excellent: 0, valid: 2, weak: 1, invalid: 5 },
        },
      }),
    );

    expect(text).toContain("He entendido que buscas");
    expect(text).toContain("role playing rpg");
    expect(text).toContain("pirates");
    expect(text).toContain("GTA V");
    // Sin jerga interna para el usuario
    expect(text).not.toContain("pool");
    expect(text).not.toContain("parcial");
  });

  it("con acción more cambia el verbo", () => {
    const text = fallbackExplanation(makeInput({ action: "more" }));

    expect(text).toContain("He buscado más juegos de");
  });
});
