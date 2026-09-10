import { describe, expect, it } from "vitest";
import {
  initialTurnState,
  recommendationTurnsReducer,
  type TurnState,
} from "./recommendationTurnsReducer";
import type {
  GameSearchIntent,
  RecommendationResponse,
  RecommendationResultItem,
} from "@/types/Recommendation";

const intent: GameSearchIntent = {
  gameReferenced: null,
  objective: {
    genres: ["SHOOTER"],
    themes: null,
    platforms: null,
    gameModes: null,
    perspectives: null,
  },
  keywords: null,
  releaseYear: null,
  yearFrom: null,
  yearTo: null,
  excluded: null,
  relation: null,
  semantic: null,
};

function resultItem(id: number): RecommendationResultItem {
  return {
    game: {
      id,
      slug: `slug-${id}`,
      title: `Game ${id}`,
      coverUrl: null,
      releaseYear: 2020,
      genres: [],
      themes: [],
      platforms: [],
      gameModes: [],
      perspectives: [],
      description_es: null,
      description_en: null,
      keywords: [],
    },
    score: 0.5,
    tier: "valid",
    coverage: {
      semanticDims: 1,
      objectiveFields: 1,
      hasKeywords: true,
      hasAnchors: false,
    },
    reasons: [],
  };
}

function response(
  overrides: Partial<RecommendationResponse> = {},
): RecommendationResponse {
  return {
    results: [],
    requestedGames: [],
    intent,
    explanation: "explicacion",
    notices: [],
    meta: {
      action: "search",
      lifecycle: "reset",
      evaluatedCandidates: 10,
      partial: false,
      exhaustedPool: false,
      tierCounts: { invalid: 0, weak: 0, valid: 0, excellent: 0 },
      discoveryUnitsUsed: 1,
    },
    ...overrides,
  };
}

function sent(state: TurnState, message = "quiero un shooter"): TurnState {
  return recommendationTurnsReducer(state, { type: "USER_SENT", message });
}

function settled(
  state: TurnState,
  failure?: { status: number; message?: string; notice?: string },
): TurnState {
  return recommendationTurnsReducer(state, {
    type: "STREAM_SETTLED",
    failure,
  });
}

function metaWith(
  lifecycle: "reset" | "continue",
): RecommendationResponse["meta"] {
  return { ...response().meta, lifecycle };
}

describe("recommendationTurnsReducer", () => {
  it("initialTurnState devuelve el estado canónico de arranque", () => {
    expect(initialTurnState()).toEqual({
      status: "idle",
      transcript: [],
      results: [],
      requestedGames: [],
      intent: null,
      meta: null,
      notices: [],
      shownGameIds: [],
      failure: null,
    });
  });

  it("USER_SENT hace push optimista del mensaje y entra en searching", () => {
    const state = sent(initialTurnState(), "juego de piratas");
    expect(state.status).toBe("searching");
    expect(state.transcript).toEqual([
      { role: "user", text: "juego de piratas" },
    ]);
    expect(state.results).toEqual([]);
    expect(state.shownGameIds).toEqual([]);
  });

  it("USER_SENT limpia el error previo, el settle exitoso no lo reintroduce", () => {
    const failed = settled(initialTurnState(), { status: 502 });
    const state = settled(sent(failed));
    expect(state.status).toBe("ready");
    expect(state.failure).toBeNull();
  });

  it("INTENT_ARRIVED actualiza el intent sin tocar nada más", () => {
    const state = recommendationTurnsReducer(initialTurnState(), {
      type: "INTENT_ARRIVED",
      intent,
    });
    expect(state.intent).toEqual(intent);
    expect(state.status).toBe("idle");
    expect(state.transcript).toEqual([]);
  });

  it("RESULTS_ARRIVED pinta la tanda parcial sin tocar transcript ni meta", () => {
    const state = recommendationTurnsReducer(initialTurnState(), {
      type: "RESULTS_ARRIVED",
      results: [resultItem(1)],
    });
    expect(state.results).toHaveLength(1);
    expect(state.meta).toBeNull();
    expect(state.transcript).toEqual([]);
    expect(state.status).toBe("idle");
  });

  it("DONE aplica la respuesta pero NO decide el status (queda searching)", () => {
    const state = recommendationTurnsReducer(sent(initialTurnState()), {
      type: "DONE",
      response: response({ results: [resultItem(1)] }),
    });
    expect(state.status).toBe("searching");
    expect(state.results).toHaveLength(1);
  });

  it("camino feliz completo: sent → intent → results → done → settled", () => {
    let state = sent(initialTurnState());
    state = recommendationTurnsReducer(state, { type: "INTENT_ARRIVED", intent });
    state = recommendationTurnsReducer(state, {
      type: "RESULTS_ARRIVED",
      results: [resultItem(1)],
    });
    state = recommendationTurnsReducer(state, {
      type: "DONE",
      response: response({ results: [resultItem(1), resultItem(2)] }),
    });
    state = settled(state);

    expect(state.status).toBe("ready");
    expect(state.failure).toBeNull();
    expect(state.transcript).toEqual([
      { role: "user", text: "quiero un shooter" },
      { role: "assistant", text: "explicacion" },
    ]);
    expect(state.meta).not.toBeNull();
    expect(state.shownGameIds).toEqual([1, 2]);
    expect(state.intent).toEqual(intent);
  });

  it("cierre limpio del stream sin done → ready (contrato de postStream)", () => {
    const state = settled(sent(initialTurnState()));
    expect(state.status).toBe("ready");
    expect(state.failure).toBeNull();
    expect(state.transcript).toEqual([
      { role: "user", text: "quiero un shooter" },
    ]);
  });

  it("reset devuelve solo los ids del turno (no acumula)", () => {
    const state1 = sent(initialTurnState(), "a");
    const afterFirst = recommendationTurnsReducer(state1, {
      type: "DONE",
      response: response({
        results: [resultItem(1)],
        meta: metaWith("reset"),
      }),
    });
    expect(afterFirst.shownGameIds).toEqual([1]);

    const state2 = sent(afterFirst, "b");
    const afterSecond = recommendationTurnsReducer(state2, {
      type: "DONE",
      response: response({
        results: [resultItem(9), resultItem(10)],
        requestedGames: [{ ...resultItem(9).game, id: 42 }],
        meta: metaWith("reset"),
      }),
    });

    expect(afterSecond.shownGameIds).toEqual([9, 10, 42]);
  });

  it("continue acumula los mostrados eliminando duplicados", () => {
    const base = recommendationTurnsReducer(
      { ...initialTurnState(), status: "searching", shownGameIds: [1, 2] },
      {
        type: "DONE",
        response: response({
          results: [resultItem(2), resultItem(3)],
          requestedGames: [resultItem(1).game],
          meta: metaWith("continue"),
        }),
      },
    );
    expect(base.shownGameIds).toEqual([1, 2, 3]);
  });

  it("done sin resultados conserva contexto: sin intent nuevo ni reset de mostrados", () => {
    const prior: TurnState = {
      ...initialTurnState(),
      status: "searching",
      intent,
      shownGameIds: [7, 8],
      transcript: [{ role: "user", text: "x" }],
    };
    let state = recommendationTurnsReducer(prior, {
      type: "DONE",
      response: response({ results: [], explanation: "vacio" }),
    });
    state = settled(state);

    expect(state.shownGameIds).toEqual([7, 8]);
    expect(state.intent).toEqual(intent);
    expect(state.transcript).toEqual([{ role: "user", text: "x" }]);
    expect(state.status).toBe("ready");
  });

  it("lifecycle reset sin resultados no limpia los mostrados", () => {
    const prior: TurnState = {
      ...initialTurnState(),
      status: "searching",
      shownGameIds: [5],
    };
    const state = recommendationTurnsReducer(prior, {
      type: "DONE",
      response: response({ results: [], meta: metaWith("reset") }),
    });
    expect(state.shownGameIds).toEqual([5]);
  });

  it("fallo de transporte tras tanda parcial: error y conserva lo ya mostrado", () => {
    let state = sent(initialTurnState());
    state = recommendationTurnsReducer(state, {
      type: "RESULTS_ARRIVED",
      results: [resultItem(4)],
    });
    state = settled(state, { status: 0, message: "network-error" });

    expect(state.status).toBe("error");
    expect(state.failure).toEqual({ status: 0, message: "network-error" });
    expect(state.results).toHaveLength(1);
    expect(state.transcript).toEqual([
      { role: "user", text: "quiero un shooter" },
    ]);
  });

  it("fallo settled después de DONE: error prevalece y los datos del done se aplican", () => {
    let state = sent(initialTurnState());
    state = recommendationTurnsReducer(state, {
      type: "DONE",
      response: response({ results: [resultItem(2)] }),
    });
    state = settled(state, { status: 503 });

    expect(state.status).toBe("error");
    expect(state.failure).toEqual({ status: 503 });
    expect(state.results).toHaveLength(1);
    expect(state.shownGameIds).toEqual([2]);
    expect(state.transcript).toEqual([
      { role: "user", text: "quiero un shooter" },
      { role: "assistant", text: "explicacion" },
    ]);
  });

  it("settle exitoso tras un fallo anterior reestablece ready sin failure", () => {
    let state = settled(initialTurnState(), { status: 502 });
    state = recommendationTurnsReducer(state, {
      type: "USER_SENT",
      message: "reintento",
    });
    state = recommendationTurnsReducer(state, {
      type: "DONE",
      response: response({ results: [resultItem(3)] }),
    });
    state = settled(state);

    expect(state.status).toBe("ready");
    expect(state.failure).toBeNull();
    expect(state.shownGameIds).toEqual([3]);
  });

  it("acción desconocida devuelve el mismo estado sin mutar", () => {
    const state = initialTurnState();
    const next = recommendationTurnsReducer(state, {
      type: "NONSENSE",
    } as never);
    expect(next).toBe(state);
    expect(next.transcript).toEqual([]);
  });
});
