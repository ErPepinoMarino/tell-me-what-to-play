/*
 * Espejo del contrato de POST /api/recommendations del backend
 * (backend/src/types/Recommendation.ts). El frontend es una capa de
 * presentación: recibe strings del backend y no conoce los enums internos.
 *
 * "search" es cualquier mensaje nuevo: el backend (LLM) decide con el
 * contexto de sesión si el mensaje extiende la búsqueda anterior o empieza
 * otra. Afinar o cambiar de tema NO es decisión del cliente.
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
  | "DISCOVERY_BUDGET_EXHAUSTED"
  | "DISCOVERY_UNAVAILABLE"
  | "CATALOG_FULL"
  | "PG_DEGRADED"
  | "RELAXED_FILTERS";

export type MatchTier = "invalid" | "weak" | "valid" | "excellent";
export type MatchBlock = "semantic" | "objective" | "keywords" | "reference";
export type MatchReasonKind = "bonus" | "penalty" | "gate" | "skipped";

export interface RecommendedGame {
  id: number;
  slug: string;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  genres: string[];
  themes: string[];
  platforms: string[];
  gameModes: string[];
  perspectives: string[];
  description_es: string | null;
  description_en: string | null;
  keywords: string[];
}

export interface MatchReason {
  block: MatchBlock;
  field: string;
  contribution: number;
  kind: MatchReasonKind;
  note: string;
}

export interface RecommendationResultItem {
  game: RecommendedGame;
  score: number;
  tier: MatchTier;
  coverage: {
    semanticDims: number;
    objectiveFields: number;
    hasKeywords: boolean;
    hasAnchors: boolean;
  };
  reasons: MatchReason[];
}

export interface RecommendationMeta {
  action: RecommendationAction;
  /*
   * Ciclo de vida conversacional (el CLIENTE es el dueño del contexto):
   * "reset" = el turno empezó una búsqueda NUEVA → vacía sus mostrados y
   * adopta response.intent como contexto nuevo; "continue" = siguió el
   * mismo hilo (refine, more o sin resultados) → acumula mostrados.
   */
  lifecycle: "reset" | "continue";
  evaluatedCandidates: number;
  partial: boolean;
  exhaustedPool: boolean;
  tierCounts: Record<MatchTier, number>;
  discoveryUnitsUsed: number;
  // Grupos soltados por la criba relajada (espejo del backend). Ausente = estricta.
  relaxedFilters?: string[];
}

export interface GameSearchIntent {
  gameReferenced: string[] | null;
  objective: {
    genres: string[] | null;
    themes: string[] | null;
    platforms: string[] | null;
    gameModes: string[] | null;
    perspectives: string[] | null;
  } | null;
  keywords: string[] | null;
  // Año exacto pedido ("del 2004"); rangos ("de los 90")
  releaseYear: number | null;
  yearFrom: number | null;
  yearTo: number | null;
  // Red flags: elementos excluidos explícitamente ("que no sea X")
  excluded: {
    keywords: string[] | null;
    genres: string[] | null;
    themes: string[] | null;
    platforms: string[] | null;
    gameModes: string[] | null;
    perspectives: string[] | null;
    releaseYear: number | null;
    yearFrom: number | null;
    yearTo: number | null;
  } | null;
  // Relación con la intención previa (solo con contexto): refine | new | nonsensical | null
  relation: "new" | "refine" | "nonsensical" | null;
  semantic: Partial<Record<string, number | null>> | null;
}

export interface RecommendationResponse {
  results: RecommendationResultItem[];
  requestedGames: RecommendedGame[];
  intent: GameSearchIntent;
  explanation: string;
  notices: NoticeCode[];
  meta: RecommendationMeta;
}

/*
 * Espejo de los eventos de POST /api/recommendations/stream del backend.
 * intent nada más resolverse, snapshots rankeados por tanda creada y done
 * con la respuesta completa final.
 */
export type RecommendationStreamEvent =
  | { event: "intent"; intent: GameSearchIntent }
  | { event: "results"; results: RecommendationResultItem[] }
  | { event: "done"; response: RecommendationResponse }
  | { event: "error"; status: number; message?: string; notice?: string };
