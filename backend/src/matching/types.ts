import type {
  GameMode,
  Genre,
  Perspective,
  Platform,
  Theme,
} from "../types/enums.js";
import type { GameSearchIntent } from "../types/GameSearchIntent.js";

// Los bloques que se comparan.
export type MatchBlock = "semantic" | "objective" | "keywords" | "reference";
// Tipo de match, si suma, resta, viola una condicion dura o se salta un bloque (no computable).
export type MatchReasonKind = "bonus" | "penalty" | "gate" | "skipped";
// Calidad del resultado
export type MatchTier = "invalid" | "weak" | "valid" | "excellent";

/*
 * Razón explicable: cada comparación que aportó (o no) al score.
 * En caso de match puedes ver los detalles.
 */
export interface MatchReason {
  block: MatchBlock;
  field: string;
  intentValue: number | string | null;
  gameValue: number | string | null;
  contribution: number;
  kind: MatchReasonKind;
  note: string;
}

export interface MatchCoverage {
  // Dimensiones semánticas comparables (0..13): base del ranking
  semanticDims: number;
  // Informativo: grupos objetivo (genres/platforms/gameModes/perspectives)
  // con datos conocidos en el juego (0..4)
  objectiveFields: number;
  // El juego tiene keywords con las que comparar
  hasKeywords: boolean;
  // Hay juegos referenciados resueltos (anclas)
  hasAnchors: boolean;
}

export interface MatchResult {
  score: number;
  tier: MatchTier;
  coverage: MatchCoverage;
  gatesViolated: string[];
  reasons: MatchReason[];
}

/*
 * Subconjunto estructural del dominio Game que el matching necesita.
 * El título y el releaseYear participan de los filtros duros: las
 * keywords/red flags también se verifican contra el título y el año
 * pedido es obligatorio.
 */
export interface MatchableGame {
  id: number;
  slug: string;
  sourceId: string | null;
  title: string;
  releaseYear: number | null;
  genres: Genre[];
  themes: Theme[];
  platforms: Platform[];
  gameModes: GameMode[];
  perspectives: Perspective[];
  keywords: string[];
  difficulty: number | null;
  pace: number | null;
  narrative: number | null;
  complexity: number | null;
  coziness: number | null;
  strategy: number | null;
  exploration: number | null;
  violence: number | null;
  horror: number | null;
  darkness: number | null;
  tension: number | null;
  humor: number | null;
  isolation: number | null;
}

export interface MatchInput {
  intent: GameSearchIntent; //el juego que el usuario busca
  game: MatchableGame; //el juego candidato a match, lo sacamos de la BDD (o la cache, o IGDB, etc.)
  /*
   * Juegos referenciados resueltos (anclas).
   * Por ejemplo "Algo parecido al GTA con mecanicas del Project Zomboid" -> GTA y Project Zomboid son anclas.
   */
  anchors?: MatchableGame[];
}

export type ExcludedReason =
  "already-shown" | "referenced-anchor" | "duplicate-input";

export interface ExcludedGame {
  gameId: number;
  slug: string;
  reason: ExcludedReason;
}

export interface RankOptions {
  anchors?: MatchableGame[];
  // Ids ya mostrados al usuario en esta sesión
  excludeGameIds?: number[];
  // Default true (decisión de producto): el ancla no se recomienda
  excludeReferenced?: boolean;
}

/*
 * Genérico sobre el tipo de juego de entrada: el orquestador entra con Game[]
 * y necesita recuperar Game (con title/sourceId/descripciones) en la salida,
 * no solo la vista MatchableGame.
 */
export interface RankedMatch<
  T extends MatchableGame = MatchableGame,
> extends MatchResult {
  game: T;
}

export interface RankResult<T extends MatchableGame = MatchableGame> {
  // TODOS los tiers, ordenados; el orquestador decide qué mostrar y cuándo buscar más
  ranked: RankedMatch<T>[];
  excluded: ExcludedGame[];
}
