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
  createIntentExtractor,
} from "../../src/services/intentService.js";
import { gameIntentAIModel, gameRelationAIModel } from "../../src/lib/ai.js";
import type {
  GameSearchIntent,
  RefineDelta,
} from "../../src/types/GameSearchIntent.js";
import { makeIntent, NULL_SEMANTIC } from "../helpers/fakes.js";

const fakeIntent: GameSearchIntent = {
  gameReferenced: null,
  objective: null,
  keywords: null,
  releaseYear: null,
  yearFrom: null,
  yearTo: null,
  excluded: null,
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

  it("envía el mensaje del usuario tal cual al modelo (sin contexto)", async () => {
    const invoke = vi.fn().mockResolvedValue(fakeIntent);
    vi.mocked(gameIntentAIModel).mockReturnValue({ invoke } as never);

    await intentService.extractIntent("un RPG de piratas");

    const messages = invoke.mock.calls[0][0] as {
      role: string;
      content: string;
    }[];
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("un RPG de piratas");
  });

  it("extractIntent acepta únicamente el mensaje (aridad 1)", () => {
    expect(intentService.extractIntent.length).toBe(1);
  });
});

describe("createIntentExtractor", () => {
  it("delegates extract to intentService", async () => {
    vi.mocked(gameIntentAIModel).mockReturnValue({
      invoke: vi.fn().mockResolvedValue(fakeIntent),
    } as never);
    const extractor = createIntentExtractor();

    const result = await extractor.extract("quiero un RPG de piratas");

    expect(result).toEqual(fakeIntent);
  });

  it("propaga los errores del modelo", async () => {
    vi.mocked(gameIntentAIModel).mockReturnValue({
      invoke: vi.fn().mockRejectedValue(new Error("model down")),
    } as never);
    const extractor = createIntentExtractor();

    await expect(extractor.extract("anything")).rejects.toThrow("model down");
  });
});

/*
 * Contrato de classifyRelation: formatea el contexto (con/sin intent previo),
 * pasa el mensaje al modelo y devuelve la relación del modelo. El modelo está
 * mockeado (sin llamadas reales): la relación esperada es la que devuelve el
 * mock; aquí se verifica el contrato del servicio.
 */
describe("classifyRelation", () => {
  const previous = makeIntent({
    objective: {
      genres: ["ROLE_PLAYING_RPG"],
      themes: null,
      platforms: ["SWITCH"],
      gameModes: null,
      perspectives: null,
    },
  });

  function mockRelation(relation: "new" | "refine" | "nonsensical") {
    const invoke = vi.fn().mockResolvedValue({ relation });
    vi.mocked(gameRelationAIModel).mockReturnValue({ invoke } as never);
    return invoke;
  }

  function messagesOf(invoke: ReturnType<typeof vi.fn>) {
    return invoke.mock.calls[0][0] as { role: string; content: string }[];
  }

  it('sin intención previa → "new"', async () => {
    const invoke = mockRelation("new");

    const relation = await classifyRelation("Quiero un RPG para Switch");

    expect(relation).toBe("new");
    const messages = messagesOf(invoke);
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("No previous search context");
    expect(messages[1].content).toContain("Quiero un RPG para Switch");
  });

  it('con intención previa y ajuste → "refine"', async () => {
    const invoke = mockRelation("refine");

    const relation = await classifyRelation("que sea más tranquilo", previous);

    expect(relation).toBe("refine");
    const messages = messagesOf(invoke);
    expect(messages[1].content).toContain("Previous search intent");
    expect(messages[1].content).toContain(JSON.stringify(previous));
    expect(messages[1].content).toContain("que sea más tranquilo");
  });

  it('con intención previa y tema distinto → "new"', async () => {
    const invoke = mockRelation("new");

    const relation = await classifyRelation(
      "mejor busca juegos de terror",
      previous,
    );

    expect(relation).toBe("new");
    const messages = messagesOf(invoke);
    expect(messages[1].content).toContain("Previous search intent");
    expect(messages[1].content).toContain("mejor busca juegos de terror");
  });

  it('con intención previa y mensaje sin sentido → "nonsensical"', async () => {
    const invoke = mockRelation("nonsensical");

    const relation = await classifyRelation("asdf qwerty 123", previous);

    expect(relation).toBe("nonsensical");
    const messages = messagesOf(invoke);
    expect(messages[1].content).toContain("Previous search intent");
    expect(messages[1].content).toContain("asdf qwerty 123");
  });

  it('con intención previa y criterio añadido → "refine"', async () => {
    const invoke = mockRelation("refine");

    const relation = await classifyRelation(
      "y que tenga buena historia",
      previous,
    );

    expect(relation).toBe("refine");
    const messages = messagesOf(invoke);
    expect(messages[1].content).toContain("Previous search intent");
    expect(messages[1].content).toContain("y que tenga buena historia");
  });

  it('sin intención previa y mensaje sin sentido → "nonsensical"', async () => {
    const invoke = mockRelation("nonsensical");

    const relation = await classifyRelation("asdf qwerty 123");

    expect(relation).toBe("nonsensical");
    const messages = messagesOf(invoke);
    expect(messages[1].content).toContain("No previous search context");
    expect(messages[1].content).toContain("asdf qwerty 123");
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
      excluded: null,
    },
    excluded: null,
    ...overrides,
  });

  it("delta vacÃ­o = intent previo intacto", () => {
    const out = applyRefineDelta(PREVIOUS, delta());
    expect(out.keywords).toEqual(["pirates"]);
    expect(out.objective?.genres).toEqual(["ROLE_PLAYING_RPG"]);
  });

  it("add keywords: uniÃ³n sin duplicados y conserva lo previo", () => {
    const out = applyRefineDelta(
      PREVIOUS,
      delta({ add: { ...delta().add!, keywords: ["2d", "Pirates"] } }),
    );
    expect(out.keywords).toEqual(["pirates", "2d"]);
    expect(out.objective?.genres).toEqual(["ROLE_PLAYING_RPG"]);
  });

  it("unicidad tolerancia-cero: caso, espacios y repetidos colapsan", () => {
    const out = applyRefineDelta(
      PREVIOUS,
      delta({
        add: { ...delta().add!, keywords: ["Pirates ", "PIRATES", "pirates"] },
      }),
    );
    expect(out.keywords).toEqual(["pirates"]);
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

  it("remove.excluded revoca una exclusión previa (los mods son irrelevantes)", () => {
    const withExclusion: GameSearchIntent = {
      ...PREVIOUS,
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
    };
    const out = applyRefineDelta(
      withExclusion,
      delta({
        remove: {
          ...delta().remove!,
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
      }),
    );
    expect(out.excluded?.keywords).toBeNull();
    expect(out.keywords).toEqual(["pirates"]);
  });

  it("add revoca la exclusión del mismo término (ok, con mods)", () => {
    const withExclusion: GameSearchIntent = {
      ...PREVIOUS,
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
    };
    const out = applyRefineDelta(
      withExclusion,
      delta({ add: { ...delta().add!, keywords: ["mods"] } }),
    );
    expect(out.excluded?.keywords).toBeNull();
    expect(out.keywords).toEqual(["pirates", "mods"]);
  });

  it("solo X: el delta quita el resto de grupos y el ancla", () => {
    const cluttered: GameSearchIntent = {
      gameReferenced: ["Red Dead Redemption"],
      objective: {
        genres: ["ADVENTURE"],
        themes: ["ACTION", "OPEN_WORLD"],
        platforms: null,
        gameModes: ["SINGLE_PLAYER"],
        perspectives: null,
      },
      keywords: ["cowboys"],
      releaseYear: null,
      yearFrom: null,
      yearTo: null,
      excluded: null,
      semantic: null,
    };
    const out = applyRefineDelta(
      cluttered,
      delta({
        remove: {
          ...delta().remove!,
          genres: ["ADVENTURE"],
          themes: ["ACTION", "OPEN_WORLD"],
          gameModes: ["SINGLE_PLAYER"],
          gameReferenced: ["Red Dead Redemption"],
        },
      }),
    );
    expect(out.keywords).toEqual(["cowboys"]);
    expect(out.objective?.genres).toBeNull();
    expect(out.objective?.themes).toBeNull();
    expect(out.objective?.gameModes).toBeNull();
    expect(out.gameReferenced).toBeNull();
  });
});

/*
 * Casos representativos de Prompt 1.
 *
 * AVISO: con el modelo mockeado NO se puede observar la interpretación REAL
 * del LLM — el mock devuelve exactamente lo que se le pasa. Estos tests fijan
 * el CONTRATO determinista del extractor:
 *   1. el mensaje en lenguaje natural llega literal al modelo;
 *   2. la salida estructurada se devuelve sin transformar;
 *   3. el system prompt (Prompt 1) contiene las reglas que gobiernan la
 *      interpretación (no inferencia, inglés canónico).
 * La validación semántica (¿devuelve "farming"? ¿añade KIDS?) exige una
 * ejecución real contra el modelo, fuera del alcance determinista.
 */
const PROMPT1_CASES = [
  "¿algún juego de gestión muy tranquilo tipo granja?",
  "Quiero un juego de granjas muy relajado.",
  "Busco un juego de gestión tranquilo.",
  "Quiero algo cozy donde pueda cultivar y gestionar una granja.",
];

function captureMessages(invoke: ReturnType<typeof vi.fn>) {
  return invoke.mock.calls[0][0] as { role: string; content: string }[];
}

describe("Prompt 1 — contrato de interpretación (modelo mockeado)", () => {
  for (const [index, message] of PROMPT1_CASES.entries()) {
    it(`caso ${index + 1}: envía el mensaje literal al modelo`, async () => {
      const invoke = vi.fn().mockResolvedValue(fakeIntent);
      vi.mocked(gameIntentAIModel).mockReturnValue({ invoke } as never);

      await intentService.extractIntent(message);

      const messages = captureMessages(invoke);
      expect(messages[0].role).toBe("system");
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toContain(message);
    });
  }

  it("devuelve la salida estructurada del modelo sin transformarla", async () => {
    // Sonda de plumbing con valores sintéticos A PROPÓSITO: comprueba que el
    // extractor no reinterpreta ni reescribe keywords/objective/semantic.
    // NO representa una interpretación esperada de ningún caso.
    const structured = makeIntent({
      keywords: ["sentinel-a", "sentinel-b"],
      objective: {
        genres: ["SIMULATOR"],
        themes: null,
        platforms: null,
        gameModes: null,
        perspectives: null,
      },
      semantic: { ...NULL_SEMANTIC, coziness: 0.9 },
    });
    const invoke = vi.fn().mockResolvedValue(structured);
    vi.mocked(gameIntentAIModel).mockReturnValue({ invoke } as never);

    const result = await intentService.extractIntent(PROMPT1_CASES[0]);

    // Identidad: la salida no se transforma en el camino.
    expect(result).toBe(structured);
  });

  it("el system prompt prohíbe inferir KIDS/COMEDY/OPEN_WORLD y exige inglés canónico", async () => {
    const invoke = vi.fn().mockResolvedValue(fakeIntent);
    vi.mocked(gameIntentAIModel).mockReturnValue({ invoke } as never);

    await intentService.extractIntent(PROMPT1_CASES[0]);
    const system =
      captureMessages(invoke).find((m) => m.role === "system")?.content ?? "";

    // No inferencia no solicitada (farming ≠ KIDS/BUSINESS/COMEDY; open-world ≠ SANDBOX).
    expect(system).toContain("farming does not imply KIDS");
    expect(system).toContain(
      "a request for farming does not automatically mean KIDS, BUSINESS or COMEDY",
    );
    expect(system).toContain("open-world does not imply SANDBOX");
    // Inglés canónico ANTES del léxico/embeddings.
    expect(system).toContain(
      "The canonical English representation must be produced BEFORE the intent reaches the lexicon and embedding system",
    );
  });

  it("el system prompt fija el contrato de keywords y no depende de relation/previousIntent", async () => {
    const invoke = vi.fn().mockResolvedValue(fakeIntent);
    vi.mocked(gameIntentAIModel).mockReturnValue({ invoke } as never);

    await intentService.extractIntent(PROMPT1_CASES[0]);
    const system =
      captureMessages(invoke).find((m) => m.role === "system")?.content ?? "";

    // roguelite -> keywords; no existe campo secondaryTags.
    expect(system).toContain('return "roguelite" in keywords');
    expect(system).toContain("Do not invent a secondaryTags field");
    expect(system).toContain(
      'There is no separate "secondary tags" field in the schema',
    );
    expect(system).not.toContain("return ROGUELITE");
    expect(system).not.toContain("Secondary tags represent");

    // Ya no hay responsabilidad de relation/refine/nonsensical/previousIntent.
    expect(system).not.toContain("relation");
    expect(system).not.toContain("refine");
    expect(system).not.toContain("nonsensical");
    expect(system).not.toContain("previous intent");
    expect(system).not.toContain("Previous search intent");
  });

  it("la salida cumple las invariantes de forma del schema", async () => {
    const structured = makeIntent({
      keywords: ["sentinel-a", "sentinel-b"],
      semantic: { ...NULL_SEMANTIC, coziness: 0.9, pace: 0.2 },
    });
    const invoke = vi.fn().mockResolvedValue(structured);
    vi.mocked(gameIntentAIModel).mockReturnValue({ invoke } as never);

    const result = await intentService.extractIntent(PROMPT1_CASES[3]);

    for (const keyword of result.keywords ?? []) {
      expect(keyword).toBe(keyword.toLowerCase());
    }
    for (const value of Object.values(result.semantic ?? {})) {
      if (value !== null) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});
