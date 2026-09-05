/*
 * Espejo del contrato de POST /api/recommendations del backend
 * (backend/src/types/Recommendation.ts). Mantener sincronizados a mano:
 * el frontend NO comparte código con el backend a propósito (clientes
 * independientes de la API pública).
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
  | "PARTIAL_RESULTS"
  | "SEARCH_EXHAUSTED"
  | "DISCOVERY_BUDGET_EXHAUSTED"
  | "DISCOVERY_UNAVAILABLE"
  | "CATALOG_FULL"
  | "PG_DEGRADED";

export type MatchTier = "invalid" | "weak" | "valid" | "excellent";
export type MatchBlock = "semantic" | "objective" | "keywords" | "reference";
export type MatchReasonKind = "bonus" | "penalty" | "gate" | "skipped";

export type Genre =
  | "ADVENTURE"
  | "ARCADE"
  | "CARD_AND_BOARD_GAME"
  | "FIGHTING"
  | "HACK_AND_SLASH_BEAT_EM_UP"
  | "INDIE"
  | "MOBA"
  | "MUSIC"
  | "PINBALL"
  | "PLATFORM"
  | "POINT_AND_CLICK"
  | "PUZZLE"
  | "QUIZ_TRIVIA"
  | "RACING"
  | "REAL_TIME_STRATEGY"
  | "ROLE_PLAYING_RPG"
  | "SHOOTER"
  | "SIMULATOR"
  | "SPORT"
  | "STRATEGY"
  | "TACTICAL"
  | "TURN_BASED_STRATEGY"
  | "VISUAL_NOVEL"
  | "UNKNOWN";

// Themes de IGDB (/v4/themes): mundo/tono/ambientación. Capa MUST.
export type Theme =
  | "ACTION"
  | "BUSINESS"
  | "COMEDY"
  | "DRAMA"
  | "EDUCATIONAL"
  | "EROTIC"
  | "FANTASY"
  | "FOUR_X"
  | "HISTORICAL"
  | "HORROR"
  | "KIDS"
  | "MYSTERY"
  | "NON_FICTION"
  | "OPEN_WORLD"
  | "PARTY"
  | "ROMANCE"
  | "SANDBOX"
  | "SCIENCE_FICTION"
  | "STEALTH"
  | "SURVIVAL"
  | "THRILLER"
  | "WARFARE"
  | "UNKNOWN";

export type Platform =
  | "PC"
  | "MAC"
  | "LINUX"
  | "PS5"
  | "PS4"
  | "PS3"
  | "PS2"
  | "PS1"
  | "PS_VITA"
  | "PSP"
  | "XBOX_SERIES"
  | "XBOX_ONE"
  | "XBOX_360"
  | "XBOX"
  | "SWITCH"
  | "WII_U"
  | "WII"
  | "GAMECUBE"
  | "N64"
  | "SNES"
  | "NES"
  | "NINTENDO_3DS"
  | "DS"
  | "GAME_BOY"
  | "GAME_BOY_ADVANCE"
  | "IOS"
  | "ANDROID"
  | "UNKNOWN";

export type GameMode =
  | "SINGLE_PLAYER"
  | "MULTIPLAYER"
  | "COOPERATIVE"
  | "COMPETITIVE"
  | "MASSIVELY_MULTIPLAYER"
  | "UNKNOWN";

export type Perspective =
  | "FIRST_PERSON"
  | "THIRD_PERSON"
  | "TOP_DOWN"
  | "ISOMETRIC"
  | "SIDE_VIEW"
  | "TEXT"
  | "UNKNOWN";

export interface RecommendedGame {
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
  evaluatedCandidates: number;
  partial: boolean;
  exhaustedPool: boolean;
  tierCounts: Record<MatchTier, number>;
  discoveryUnitsUsed: number;
}

export interface GameSearchIntent {
  gameReferenced: string[] | null;
  objective: {
    genres: Genre[] | null;
    themes: Theme[] | null;
    platforms: Platform[] | null;
    gameModes: GameMode[] | null;
    perspectives: Perspective[] | null;
  } | null;
  keywords: string[] | null;
  // Año exacto pedido ("del 2004"); rangos ("de los 90")
  releaseYear: number | null;
  yearFrom: number | null;
  yearTo: number | null;
  // Red flags: elementos excluidos explícitamente ("que no sea X")
  excluded: {
    keywords: string[] | null;
    genres: Genre[] | null;
    themes: Theme[] | null;
    platforms: Platform[] | null;
    gameModes: GameMode[] | null;
    perspectives: Perspective[] | null;
    releaseYear: number | null;
    yearFrom: number | null;
    yearTo: number | null;
  } | null;
  // Relación con la intención previa (solo con contexto): refine | new | null
  relation: "new" | "refine" | null;
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
