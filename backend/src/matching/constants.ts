// Constantes del matcher: filtros duros (must/red flags) y ranking semántico.
//
// Modelo (decisión de producto): TODO lo no-semántico que el usuario pide
// explícitamente es FILTRO DURO — los resultados deben tenerlo todo (pueden
// tener más, nunca menos). Las red flags excluyen siempre, aunque el juego
// sea ideal. La ÚNICA ponderación numérica es la semántica: cuánto de
// oscuro/rápido/cozy es el juego frente a lo pedido.

// Umbral de score para el tier excellent (requiere además cobertura mínima).
// El resto de candidatos que pasan los filtros son "valid".
export const MATCH_THRESHOLDS = {
  excellent: 0.75,
} as const;

// Cobertura semántica mínima (dims comparables / 13) para excellent:
// confianza alta requiere ficha conocida.
export const COV_MIN = {
  excellent: 0.5,
} as const;

// |intent - game| a partir del cual el acuerdo se amplifica (acuerdo²):
// contradecir de plano lo pedido debe hundir el ranking, no solo restar.
export const AMPLIFICATION_THRESHOLD = 0.5;

// Acuerdo a partir del cual la razón se clasifica como bonus (si no, penalty).
export const AGREEMENT_BONUS_THRESHOLD = 0.5;

// Valor del juego a partir del cual, con intent = 0 (ausencia explícita),
// se viola el gate absence-violated.
export const ABSENCE_GATE_MIN = 0.5;

// Límites defensivos del score: media de acuerdos con contradicciones
// amplificadas negadas → rango natural [-1, 1] (negativo = peor que
// desconocido; 0 = sin señal semántica).
export const SCORE_MIN = -1;
export const SCORE_MAX = 1;

export const EPSILON = 1e-9;

/*
 * Orden de iteración de las dimensiones semánticas = orden del schema
 * (mismo que SEMANTIC_ATTRIBUTES en gameService.ts). NO reordenar:
 * garantiza sums en coma flotante reproducibles.
 */
export const SEMANTIC_FIELDS = [
  "difficulty",
  "pace",
  "narrative",
  "complexity",
  "coziness",
  "strategy",
  "exploration",
  "violence",
  "horror",
  "darkness",
  "tension",
  "humor",
  "isolation",
] as const;

export type SemanticField = (typeof SEMANTIC_FIELDS)[number];

// Orden de tiers para el desempate del ranking.
export const TIER_RANK = {
  excellent: 4,
  valid: 3,
  weak: 2,
  invalid: 1,
} as const;

// Identificadores de gates (también usados como note en sus razones).
// must-violated: falta un elemento pedido explícitamente (keyword, enum, año).
export const GATE_MUST_VIOLATED = "must-violated";
// red-flag-violated: el juego contiene un elemento excluido explícitamente.
export const GATE_RED_FLAG_VIOLATED = "red-flag-violated";
// absence-violated: el usuario pidió la AUSENCIA total de una semántica (0).
export const GATE_ABSENCE_VIOLATED = "absence-violated";
