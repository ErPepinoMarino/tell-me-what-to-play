import { describe, expect, it, vi } from "vitest";
// El mock va ANTES de los imports del código real (Vitest lo hoistea).
// Reproducimos la exportación de lib/ai.js con un vi.fn() que podemos configurar.
vi.mock("../../src/lib/ai.js", async () => ({
  gameIntentAIModel: vi.fn(),
}));
//Ahora sí importamos el código real que queremos testear.
import {
  intentService,
  createBudgetedIntentExtractor,
} from "../../src/services/intentService.js";
import { gameIntentAIModel } from "../../src/lib/ai.js";
import type { GameSearchIntent } from "../../src/types/GameSearchIntent.js";
import { InMemoryBudgetLedger } from "../../src/budget/budgetLedger.js";

const fakeIntent: GameSearchIntent = {
  gameReferenced: null,
  objective: null,

  keywords: null,
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

describe("intentService refine context", () => {
  it("includes the previous intent in the system message when refining", async () => {
    const invoke = vi.fn().mockResolvedValue(fakeIntent);
    vi.mocked(gameIntentAIModel).mockReturnValue({ invoke } as never);

    const previous: GameSearchIntent = {
      gameReferenced: null,
      objective: null,
      keywords: ["pirates"],
      semantic: null,
    };

    await intentService.extractIntent("menos violento", previous);

    const messages = invoke.mock.calls[0][0] as {
      role: string;
      content: string;
    }[];
    const system = messages.find((m) => m.role === "system");
    expect(system?.content).toContain("Conversation context");
    expect(system?.content).toContain("pirates");
  });
});
