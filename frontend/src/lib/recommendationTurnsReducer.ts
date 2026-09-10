import type {
  GameSearchIntent,
  NoticeCode,
  RecommendationMeta,
  RecommendationResponse,
  RecommendationResultItem,
  RecommendedGame,
} from "@/types/Recommendation";
import type { ChatStatus, TranscriptMessage } from "@/types/Conversation";

export interface TurnFailure {
  status: number;
  message?: string;
  notice?: string;
}

export interface TurnState {
  status: ChatStatus;
  transcript: TranscriptMessage[];
  results: RecommendationResultItem[];
  requestedGames: RecommendedGame[];
  intent: GameSearchIntent | null;
  meta: RecommendationMeta | null;
  notices: NoticeCode[];
  shownGameIds: number[];
  failure: TurnFailure | null;
}

export function initialTurnState(): TurnState {
  return {
    status: "idle",
    transcript: [],
    results: [],
    requestedGames: [],
    intent: null,
    meta: null,
    notices: [],
    shownGameIds: [],
    failure: null,
  };
}

export type TurnAction =
  | { type: "USER_SENT"; message: string }
  | { type: "INTENT_ARRIVED"; intent: GameSearchIntent }
  | { type: "RESULTS_ARRIVED"; results: RecommendationResultItem[] }
  | { type: "DONE"; response: RecommendationResponse }
  | { type: "STREAM_SETTLED"; failure?: TurnFailure };

function thisTurnShownIds(response: RecommendationResponse): number[] {
  return [
    ...response.results.map((item) => item.game.id),
    ...response.requestedGames.map((game) => game.id),
  ];
}

export function recommendationTurnsReducer(
  state: TurnState,
  action: TurnAction,
): TurnState {
  switch (action.type) {
    case "USER_SENT":
      return {
        ...state,
        status: "searching",
        failure: null,
        transcript: [
          ...state.transcript,
          { role: "user", text: action.message },
        ],
      };

    case "INTENT_ARRIVED":
      return { ...state, intent: action.intent };

    case "RESULTS_ARRIVED":
      return { ...state, results: action.results };

    case "DONE": {
      const response = action.response;
      const hasResults = response.results.length > 0;
      const thisTurnShown = thisTurnShownIds(response);
      // El status lo decide STREAM_SETTLED (el hook, tras resolver el
      // transporte), igual que el código original decide tras el await.
      return {
        ...state,
        results: response.results,
        requestedGames: response.requestedGames,
        meta: response.meta,
        notices: response.notices,
        transcript: hasResults
          ? [
              ...state.transcript,
              { role: "assistant", text: response.explanation },
            ]
          : state.transcript,
        intent: hasResults ? response.intent : state.intent,
        shownGameIds: hasResults
          ? response.meta.lifecycle === "reset"
            ? thisTurnShown
            : Array.from(new Set([...state.shownGameIds, ...thisTurnShown]))
          : state.shownGameIds,
      };
    }

    case "STREAM_SETTLED":
      return {
        ...state,
        status: action.failure ? "error" : "ready",
        failure: action.failure ?? null,
      };

    default:
      return state;
  }
}
