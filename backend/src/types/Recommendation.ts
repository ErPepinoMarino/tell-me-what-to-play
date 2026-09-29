import type {
  GameMode,
  Genre,
  Perspective,
  Platform,
  Theme,
} from "./enums.js";
import type { GameSearchIntent } from "./GameSearchIntent.js";
import type {
  MatchTier,
  MatchBlock,
  MatchReasonKind,
} from "../matching/types.js";

/*
 * search = mensaje nuevo: con sesión activa el LLM ve el intent previo y decide
 * si lo EXTIENDE (afinar) o lo REEMPLAZA (otra búsqueda).
 * more = repite el intent de sesión excluyendo lo ya mostrado.
 */
export type RecommendationAction = "search" | "more";

export type NoticeCode =
  | "EXPLICIT_GAME_REQUESTED"
  | "ANCHOR_NOT_FOUND"
  | "EMPTY_INTENT"
  | "INTENT_UNCHANGED"
  | "REFINE_REQUIRES_LOGIN"
  | "SENSELESS_INPUT"
  | "PARTIAL_RESULTS"
  | "SEARCH_EXHAUSTED"
  | "DISCOVERY_UNAVAILABLE"
  | "CATALOG_FULL"
  | "PG_DEGRADED"
  | "RELAXED_FILTERS";

export interface RecommendedGameDTO {
  id: number;
  slug: string;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  genres: Genre[];
  themes: Theme[];
  platforms: Platform[];
  gameModes: GameMode[];
  perspectives: Perspective[];
  description_es: string | null;
  description_en: string | null;
  keywords: string[];
}

/*
 * Razón explicable para la UI: block+kind pintan los chips ✓ (bonus) / ~
 * (parcial) / ✗ (penalty); field+note es el vocabulario que el frontend
 * humaniza, y contribution solo se muestra en el modo demo/técnico.
 */
export interface MatchReasonDTO {
  block: MatchBlock;
  field: string;
  contribution: number;
  kind: MatchReasonKind;
  note: string;
}

export interface RecommendationResultItem {
  game: RecommendedGameDTO;
  score: number;
  tier: MatchTier;
  coverage: {
    semanticDims: number;
    objectiveFields: number;
    hasKeywords: boolean;
    hasAnchors: boolean;
  };
  reasons: MatchReasonDTO[];
}

export interface RecommendationMeta {
  action: RecommendationAction;
  /*
   * "reset" = el turno empezó UNA BÚSQUEDA NUEVA: el cliente vacía su listado de
   * mostrados y adopta el intent devuelto; "continue" = mismo hilo (refine/more),
   * así que el cliente acumula los mostrados.
   */
  lifecycle: "reset" | "continue";
  evaluatedCandidates: number;
  partial: boolean;
  exhaustedPool: boolean;
  tierCounts: Record<MatchTier, number>;
  discoveryUnitsUsed: number;
  /*
   * Grupos soltados por la criba relajada cuando no hay matches (solo "more"), en
   * orden: years, perspectives, platforms, gameModes, themes, genres, keywords.
   * Ausente o vacío = búsqueda estricta.
   */
  relaxedFilters?: string[];
}

export interface RecommendationResponse {
  results: RecommendationResultItem[];
  requestedGames: RecommendedGameDTO[];
  intent: GameSearchIntent;
  // Explicación global en lenguaje natural (LLM; plantilla determinista si
  // el LLM falla o no hay presupuesto). Campo separado de results para que
  // el día de SSE pueda llegar después sin cambiar el contrato.
  explanation: string;
  notices: NoticeCode[];
  meta: RecommendationMeta;
}

/*
 * Eventos del stream SSE (POST /api/recommendations/stream), en tandas para no
 * hacer esperar al frontend: intent al resolverse, results por tanda y done con
 * la respuesta final. El endpoint clásico sigue intacto.
 */
export type RecommendationStreamEvent =
  | { event: "intent"; intent: GameSearchIntent }
  | { event: "results"; results: RecommendationResultItem[] }
  | { event: "done"; response: RecommendationResponse }
  | { event: "error"; status: number; message?: string; notice?: string };

export type RecommendationStreamSink = (
  event: RecommendationStreamEvent,
) => void;
