import type {
  GameMode,
  Genre,
  Perspective,
  Platform,
  Theme,
} from "../generated/prisma/enums.js";
import type { GameSearchIntent } from "./GameSearchIntent.js";
import type {
  MatchTier,
  MatchBlock,
  MatchReasonKind,
} from "../matching/types.js";

/*
 * Acciones del contrato. "search" es cualquier mensaje nuevo: si hay sesión,
 * el LLM recibe el intent previo y decide si lo EXTIENDE o lo REEMPLAZA
 * (afinar o cambiar de tema es decisión del intérprete, no del cliente).
 * "more" repite la intención de sesión excluyendo lo ya mostrado.
 */
export type RecommendationAction = "search" | "more";

export type NoticeCode =
  | "EXPLICIT_GAME_REQUESTED"
  | "ANCHOR_NOT_FOUND"
  | "EMPTY_INTENT"
  | "INTENT_UNCHANGED"
  | "REFINE_REQUIRES_LOGIN"
  | "PARTIAL_RESULTS"
  | "SEARCH_EXHAUSTED"
  | "DISCOVERY_BUDGET_EXHAUSTED"
  | "DISCOVERY_UNAVAILABLE"
  | "CATALOG_FULL"
  | "PG_DEGRADED";

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
 * Razón explicable para la UI. block+kind permiten renderizar los chips
 * ✓ (bonus) / ~ (parcial) / ✗ (penalty/gate) y agrupar por bloque; field
 * y note son el vocabulario que el frontend humaniza. contribution solo
 * se muestra en el modo demo/técnico.
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
  evaluatedCandidates: number;
  partial: boolean;
  exhaustedPool: boolean;
  tierCounts: Record<MatchTier, number>;
  discoveryUnitsUsed: number;
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
