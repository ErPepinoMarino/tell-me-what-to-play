import { useCallback, useEffect, useReducer, useRef } from "react";
import { postStream } from "@/lib/api";
import {
  initialTurnState,
  recommendationTurnsReducer,
  type TurnFailure,
} from "./recommendationTurnsReducer";
import type { RecommendationStreamEvent } from "@/types/Recommendation";

// Misma firma que postStream: (path, body, token, onEvent, retried?) → ApiResult.
type StreamFn = typeof postStream;

interface UseRecommendationTurnsOptions {
  token: string | null;
  stream?: StreamFn;
}

function useLatestState<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export function useRecommendationTurns({
  token,
  stream = postStream,
}: UseRecommendationTurnsOptions) {
  const [state, dispatch] = useReducer(
    recommendationTurnsReducer,
    undefined,
    initialTurnState,
  );
  const stateRef = useLatestState(state);
  const inFlight = useRef(false);

  const send = useCallback(
    async (message: string, action: "search" | "more" = "search") => {
      if (inFlight.current) return;
      inFlight.current = true;

      // Contexto PREVIO a este envío (el reducer no toca intent/mostrados).
      const contextIntent = stateRef.current.intent;
      const shownGameIds = stateRef.current.shownGameIds;

      dispatch({ type: "USER_SENT", message });

      const t0 = performance.now();
      let streamError: TurnFailure | null = null;

      const result = await stream(
        "/api/recommendations/stream",
        { message, action, contextIntent, shownGameIds },
        token,
        (event: RecommendationStreamEvent) => {
          if (event.event === "intent") {
            console.debug("[stream] event", {
              event: "intent",
              t: Math.round(performance.now() - t0),
            });
            dispatch({ type: "INTENT_ARRIVED", intent: event.intent });
          } else if (event.event === "results") {
            console.debug("[stream] event", {
              event: "results",
              count: event.results.length,
              ids: event.results.map((item) => item.game.id),
              t: Math.round(performance.now() - t0),
            });
            dispatch({ type: "RESULTS_ARRIVED", results: event.results });
          } else if (event.event === "done") {
            console.debug("[stream] event", {
              event: "done",
              count: event.response.results.length,
              t: Math.round(performance.now() - t0),
            });
            dispatch({ type: "DONE", response: event.response });
          } else if (event.event === "error") {
            streamError = {
              status: event.status,
              message: event.message,
              notice: event.notice,
            };
          }
        },
      );

      const failure: TurnFailure | null = !result.ok
        ? {
            status: result.status,
            message: result.message,
            notice: result.notice,
          }
        : streamError;

      dispatch({ type: "STREAM_SETTLED", failure: failure ?? undefined });
      inFlight.current = false;
    },
    [stream, token, stateRef],
  );

  const canMore =
    state.results.length > 0 && state.meta !== null && !state.meta.exhaustedPool;

  return {
    send,
    status: state.status,
    transcript: state.transcript,
    results: state.results,
    requestedGames: state.requestedGames,
    intent: state.intent,
    meta: state.meta,
    notices: state.notices,
    failure: state.failure,
    canMore,
    busy: state.status === "searching",
  };
}
