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
  | "SENSELESS_INPUT"
  | "PARTIAL_RESULTS"
  | "SEARCH_EXHAUSTED"
  | "DISCOVERY_BUDGET_EXHAUSTED"
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
  /*
   * Ciclo de vida conversacional (el cliente es el dueño del contexto):
   * "reset" = el turno empezó UNA BÚSQUEDA NUEVA (el cliente vacía su
   * listado de mostrados y adopta el intent devuelto como contexto nuevo);
   * "continue" = el turno siguió el mismo hilo (refine, more o ningún
   * resultado) y el cliente acumula mostrados.
   */
  lifecycle: "reset" | "continue";
  evaluatedCandidates: number;
  partial: boolean;
  exhaustedPool: boolean;
  tierCounts: Record<MatchTier, number>;
  discoveryUnitsUsed: number;
  /*
   * Grupos de requisitos soltados por la criba relajada (solo "more"):
   * "years" | "perspectives" | "platforms" | "gameModes" | "themes" |
   * "genres" | "keywords". Ausente o vacío = búsqueda estricta.
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
 * Eventos del stream POST /api/recommendations/stream (SSE por trozos):
 * intent nada más resolverse, snapshots rankeados por tanda creada y done
 * con la respuesta completa final. El endpoint clásico sigue intacto.
 */
export type RecommendationStreamEvent =
  | { event: "intent"; intent: GameSearchIntent }
  | { event: "results"; results: RecommendationResultItem[] }
  | { event: "done"; response: RecommendationResponse }
  | { event: "error"; status: number; message?: string; notice?: string };

export type RecommendationStreamSink = (
  event: RecommendationStreamEvent,
) => void;
