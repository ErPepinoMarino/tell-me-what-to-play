import { describe, expect, it, vi } from "vitest";
// El mock va ANTES de los imports del código real (Vitest lo hoistea).
// Reproducimos la exportación de lib/ai.js con un vi.fn() que podemos configurar.
vi.mock("../../src/lib/ai.js", async () => ({
  gameIntentAIModel: vi.fn(),
  gameRelationAIModel: vi.fn(),
}));
//Ahora sí importamos el código real que queremos testear.
import {
  intentService,
  applyYearGuard,
  applyThemeGuard,
  classifyRelation,
  createBudgetedIntentExtractor,
} from "../../src/services/intentService.js";
import { gameIntentAIModel, gameRelationAIModel } from "../../src/lib/ai.js";
import type { GameSearchIntent } from "../../src/types/GameSearchIntent.js";
import { InMemoryBudgetLedger } from "../../src/budget/budgetLedger.js";
import { makeIntent } from "../helpers/fakes.js";

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

describe("intentService session context", () => {
  it("includes the previous intent and the merge rules in the system message", async () => {
    const invoke = vi.fn().mockResolvedValue(fakeIntent);
    vi.mocked(gameIntentAIModel).mockReturnValue({ invoke } as never);

    const previous: GameSearchIntent = {
      gameReferenced: null,
      objective: null,
      keywords: ["pirates"],
      releaseYear: null,
      yearFrom: null,
      yearTo: null,
      excluded: null,
      relation: null,
      semantic: null,
    };

    await intentService.extractIntent("con combates navales", previous);

    const messages = invoke.mock.calls[0][0] as {
      role: string;
      content: string;
    }[];
    const system = messages.find((m) => m.role === "system");
    expect(system?.content).toContain("Conversation context");
    expect(system?.content).toContain("pirates");
    // Reglas de merge conservador: extender no borra el tema; mensaje sin
    // contenido devuelve la intención previa.
    expect(system?.content).toContain("KEEP the previous keywords");
    expect(system?.content).toContain("STARTING A NEW search");
    expect(system?.content).toContain("UNCHANGED");
    // Reglas de clasificación (ERROR 2): atmósfera → semánticas, nunca keywords
    expect(system?.content).toContain("SEMANTIC attributes, NEVER keywords");
    expect(system?.content).toContain("NOT keywords");
  });

  it("does not include session context without a previous intent", async () => {
    const invoke = vi.fn().mockResolvedValue(fakeIntent);
    vi.mocked(gameIntentAIModel).mockReturnValue({ invoke } as never);

    await intentService.extractIntent("un RPG de piratas");

    const messages = invoke.mock.calls[0][0] as {
      role: string;
      content: string;
    }[];
    const system = messages.find((m) => m.role === "system");
    expect(system?.content).not.toContain("Conversation context");
  });
});

describe("applyYearGuard", () => {
  it("posteriores al año 2000 → yearFrom 2001", () => {
    const out = applyYearGuard("busco juegos posteriores al año 2000", makeIntent());
    expect(out.yearFrom).toBe(2001);
    expect(out.releaseYear).toBeNull();
  });

  it("anteriores a 2010 → yearTo 2009", () => {
    const out = applyYearGuard("juegos anteriores a 2010", makeIntent());
    expect(out.yearTo).toBe(2009);
  });

  it("del año 2004 → releaseYear 2004", () => {
    const out = applyYearGuard("un juego del año 2004", makeIntent());
    expect(out.releaseYear).toBe(2004);
  });

  it("de los 90 → rango 1990-1999", () => {
    const out = applyYearGuard("juegos de los 90", makeIntent());
    expect(out.yearFrom).toBe(1990);
    expect(out.yearTo).toBe(1999);
  });

  it("nunca pisa lo que la LLM ya capturó", () => {
    const base = makeIntent({ yearFrom: 2010, yearTo: 2019 });
    const out = applyYearGuard("anteriores a 2000", base);
    expect(out.yearFrom).toBe(2010);
    expect(out.yearTo).toBe(2019);
  });
});

describe("applyThemeGuard", () => {
  it("mueve una palabra-theme de keywords a objective.themes", () => {
    const out = applyThemeGuard(makeIntent({ keywords: ["horror"] }));
    expect(out.objective?.themes).toEqual(["HORROR"]);
    expect(out.keywords).toBeNull();
  });

  it("mueve variantes por slug (open world) y conserva keywords reales", () => {
    const out = applyThemeGuard(
      makeIntent({ keywords: ["open world", "steampunk"] }),
    );
    expect(out.objective?.themes).toEqual(["OPEN_WORLD"]);
    expect(out.keywords).toEqual(["steampunk"]);
  });

  it("no duplica themes ya presentes ni toca intents sin keywords", () => {
    const withTheme = makeIntent({
      keywords: ["horror"],
      objective: { genres: null, themes: ["HORROR"], platforms: null, gameModes: null, perspectives: null },
    });
    const out = applyThemeGuard(withTheme);
    expect(out.objective?.themes).toEqual(["HORROR"]);
    expect(applyThemeGuard(makeIntent())).toEqual(makeIntent());
  });
});

describe("classifyRelation", () => {
  it("devuelve la relación que decide el modelo", async () => {
    const invoke = vi.fn().mockResolvedValue({ relation: "refine" });
    vi.mocked(gameRelationAIModel).mockReturnValue({ invoke } as never);

    const relation = await classifyRelation(
      "más violento",
      makeIntent({ keywords: ["violence"] }),
    );

    expect(relation).toBe("refine");
    const messages = invoke.mock.calls[0][0] as { role: string; content: string }[];
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("Previous search intent");
    expect(messages[1].content).toContain("más violento");
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

  it("sin presupuesto de LLM asume búsqueda nueva (no bloquea la búsqueda fresca)", async () => {
    const budget = new InMemoryBudgetLedger({ igdb: 10, brave: 10, llm: 0 });
    const extractor = createBudgetedIntentExtractor(budget);

    const relation = await extractor.classifyRelation!("más violento", makeIntent());

    expect(relation).toBe("new");
  });
});
