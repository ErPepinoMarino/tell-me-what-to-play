// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRecommendationTurns } from "./useRecommendationTurns";
import type {
  GameSearchIntent,
  RecommendationResponse,
  RecommendationResultItem,
  RecommendationStreamEvent,
} from "@/types/Recommendation";

type ApiOutcome =
  | { ok: true }
  | { ok: false; status: number; message?: string; notice?: string };

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

interface FakeStreamCall {
  path: string;
  body: unknown;
  token: string | null;
}

function makeFakeStream(outcome: ApiOutcome, events: RecommendationStreamEvent[] = []) {
  const call: FakeStreamCall = { path: "", body: null, token: null };
  const stream = async (
    path: string,
    body: unknown,
    token: string | null,
    onEvent: (event: RecommendationStreamEvent) => void,
  ) => {
    call.path = path;
    call.body = body;
    call.token = token;
    for (const event of events) onEvent(event);
    return outcome;
  };
  return { stream, call };
}

async function sendAndFlush(
  render: ReturnType<typeof renderHook>,
  message: string,
  action: "search" | "more" = "search",
) {
  await act(async () => {
    await render.result.current.send(message, action);
  });
}

describe("useRecommendationTurns", () => {
  it("camino feliz: evento→acción y settle a ready", async () => {
    const events: RecommendationStreamEvent[] = [
      { event: "intent", intent },
      { event: "results", results: [resultItem(1)] },
      {
        event: "done",
        response: response({
          results: [resultItem(1), resultItem(2)],
        }),
      },
    ];
    const { stream } = makeFakeStream({ ok: true }, events);
    const render = renderHook(() => useRecommendationTurns({ token: "t-1", stream }));

    await sendAndFlush(render, "quiero un shooter");

    expect(render.result.current.status).toBe("ready");
    expect(render.result.current.failure).toBeNull();
    expect(render.result.current.transcript).toEqual([
      { role: "user", text: "quiero un shooter" },
      { role: "assistant", text: "explicacion" },
    ]);
    expect(render.result.current.results).toHaveLength(2);
    expect(render.result.current.canMore).toBe(true);
    expect(render.result.current.busy).toBe(false);
  });

  it("send construye el body con contexto previo y pasa el token", async () => {
    const { stream, call } = makeFakeStream({ ok: true }, [
      {
        event: "done",
        response: response({
          results: [resultItem(5)],
          intent: { ...intent, keywords: ["zombies"] },
        }),
      },
    ]);
    const render = renderHook(() => useRecommendationTurns({ token: "abc", stream }));

    await sendAndFlush(render, "primera");
    const contextIntentFirst = (call.body as { contextIntent: unknown }).contextIntent;
    expect(contextIntentFirst).toBeNull();
    expect((call.body as { shownGameIds: number[] }).shownGameIds).toEqual([]);
    expect(call.token).toBe("abc");

    await sendAndFlush(render, "más así", "more");
    expect((call.body as { action: string }).action).toBe("more");
    expect((call.body as { contextIntent: unknown }).contextIntent).toEqual({
      ...intent,
      keywords: ["zombies"],
    });
    expect((call.body as { shownGameIds: number[] }).shownGameIds).toEqual([5]);
  });

  it("fallo de transporte → failure canónico y lo ya mostrado se conserva", async () => {
    const events: RecommendationStreamEvent[] = [
      { event: "results", results: [resultItem(7)] },
    ];
    const { stream } = makeFakeStream(
      { ok: false, status: 0, message: "network-error" },
      events,
    );
    const render = renderHook(() => useRecommendationTurns({ token: null, stream }));

    await sendAndFlush(render, "algo");

    expect(render.result.current.status).toBe("error");
    expect(render.result.current.failure).toEqual({
      status: 0,
      message: "network-error",
    });
    expect(render.result.current.results).toHaveLength(1);
    expect(render.result.current.transcript).toEqual([
      { role: "user", text: "algo" },
    ]);
  });

  it("settle exitoso tras error reintroduce ready y limpia el failure", async () => {
    const failing = makeFakeStream({ ok: false, status: 502 });
    const ok = makeFakeStream({ ok: true }, [
      { event: "done", response: response({ results: [resultItem(3)] }) },
    ]);
    let currentStream = failing.stream;
    const render = renderHook(() =>
      useRecommendationTurns({
        token: null,
        stream: ((...args: Parameters<typeof currentStream>) => currentStream(...args)) as typeof currentStream,
      }),
    );

    await sendAndFlush(render, "x");
    expect(render.result.current.status).toBe("error");

    currentStream = ok.stream;
    render.rerender();
    await sendAndFlush(render, "reintento");

    expect(render.result.current.status).toBe("ready");
    expect(render.result.current.failure).toBeNull();
    expect(render.result.current.results).toHaveLength(1);
  });

  it("more con continue acumula mostrados y canMore respeta exhaustedPool", async () => {
    const events: RecommendationStreamEvent[] = [
      {
        event: "done",
        response: response({
          results: [resultItem(1)],
          meta: {
            ...response().meta,
            action: "more",
            lifecycle: "continue",
            exhaustedPool: true,
          },
        }),
      },
    ];
    const { stream } = makeFakeStream({ ok: true }, events);
    const render = renderHook(() => useRecommendationTurns({ token: null, stream }));

    await sendAndFlush(render, "más", "more");

    expect(render.result.current.canMore).toBe(false);
    expect(render.result.current.requestedGames).toEqual([]);
  });

  it("settle sin eventos (cierre limpio sin done) → ready", async () => {
    const { stream } = makeFakeStream({ ok: true });
    const render = renderHook(() => useRecommendationTurns({ token: null, stream }));

    await sendAndFlush(render, "hola");

    expect(render.result.current.status).toBe("ready");
    expect(render.result.current.failure).toBeNull();
    expect(render.result.current.transcript).toEqual([
      { role: "user", text: "hola" },
    ]);
  });

  it("evento error con settle posterior: error prevalece y el done se aplica", async () => {
    const events: RecommendationStreamEvent[] = [
      {
        event: "error",
        status: 503,
        message: "legacy",
        notice: "PG_DEGRADED",
      },
      {
        event: "done",
        response: response({ results: [resultItem(9)] }),
      },
    ];
    const { stream } = makeFakeStream({ ok: true }, events);
    const render = renderHook(() => useRecommendationTurns({ token: null, stream }));

    await sendAndFlush(render, "algo");

    expect(render.result.current.status).toBe("error");
    expect(render.result.current.failure).toEqual({
      status: 503,
      message: "legacy",
      notice: "PG_DEGRADED",
    });
    expect(render.result.current.results).toHaveLength(1);
    expect(render.result.current.transcript).toEqual([
      { role: "user", text: "algo" },
      { role: "assistant", text: "explicacion" },
    ]);
  });

  it("doble send solapado: el segundo se ignora", async () => {
    let resolveFirst!: (value: ApiOutcome) => void;
    const pendingStream = () =>
      new Promise<ApiOutcome>((resolve) => {
        resolveFirst = resolve;
      });
    const stream = vi.fn(pendingStream);
    const render = renderHook(() => useRecommendationTurns({ token: null, stream }));

    let firstPromise: Promise<void>;
    act(() => {
      firstPromise = render.result.current.send("primero");
    });
    await act(async () => {
      await render.result.current.send("segundo");
    });

    expect(stream).toHaveBeenCalledTimes(1);

    resolveFirst({ ok: true });
    await act(async () => {
      await firstPromise;
    });
    expect(render.result.current.status).toBe("ready");
  });
});
