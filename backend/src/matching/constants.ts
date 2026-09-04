// Pesos, umbrales y constantes del matcher.
// TODOS los números del scoring viven aquí: nada de literales en matchGame
// ni rankMatches. Son valores INICIALES sujetos a calibración (fase 2).

// Peso de cada bloque. Deben sumar 1.
/*
 * CALIBRACIÓN (cerrada con los dos escenarios de producto):
 *
 * 1) "juego oscuro de piratas": A (piratas, oscuridad desconocida o media)
 *    debe ganar CLARAMENTE a B (cowboys, oscuridad perfecta). Peor caso:
 *    A contradice 1 dimensión (acuerdo 0.09 amplificado) y B clava la
 *    semántica (0.9):
 *        k + 0.09·s > 0.9·s   ⟺   k > 0.81·s
 *
 * 2) "lento, cozy en pixel art" (giro): A (pixel art) que CONTRADICE las dos
 *    dimensiones pedidas (cozy 0.1, pace 0.9 → acuerdo 0.04) debe PERDER
 *    contra B (3D, pace 0.1, cozy 1 → 0.95):
 *        0.95·s > k + 0.04·s   ⟺   k < 0.91·s
 *
 * Banda válida: k ∈ (0.81·s, 0.91·s) → k/s = 0.85.
 * La temática precede a las semánticas mientras no las contradiga;
 * una contradicción fuerte y múltiple puede invertir el orden.
 */
export const MATCH_WEIGHTS = {
  semantic: 0.4,
  objective: 0.16,
  keywords: 0.34,
  reference: 0.1,
} as const;

// Sub-pesos internos del bloque objetivo. Deben sumar 1.
export const OBJ_SUBWEIGHTS = {
  genres: 0.5,
  gameModes: 0.3,
  perspectives: 0.2,
} as const;

// Bonus fijo por overlap de plataformas (no depende de cuántas coincidan).
export const PLATFORM_BONUS = 0.1;

// Penalización cuando el usuario pidió algo y el juego tiene cero overlap.
// perspectives = 0: la ausencia de bonus ya es señal suficiente.
export const ZERO_OVERLAP_PENALTIES = {
  genres: 0.25,
  gameModes: 0.5,
  perspectives: 0,
} as const;

// Umbrales de score para los tiers.
// valid = 0.45: con los nuevos pesos, el caso canónico "género + keyword
// match" puntúa 0.5 (0.32·0.5 + 0.68·1.0 renormalizado) y debe ser válido.
export const MATCH_THRESHOLDS = {
  weak: 0.35,
  valid: 0.45,
  excellent: 0.75,
} as const;

// Cobertura semántica mínima (dims comparables / 13) para alcanzar cada tier.
/*
 * valid NO exige cobertura semántica por sí sola: el camino alternativo de
 * validez es el overlap de keywords/objetivo (regla de producto: un juego
 * con 0 semánticas conocidas puede ser válido si sus keywords u objetivos
 * lo justifican y no hay contradicción semántica amplificada).
 * La cobertura sí limita excellent (confianza alta requiere ficha conocida).
 */
export const COV_MIN = {
  valid: 0.25,
  excellent: 0.5,
} as const;

// |intent - game| a partir del cual el acuerdo se amplifica (acuerdo²).
export const AMPLIFICATION_THRESHOLD = 0.5;

// Valor del juego a partir del cual, con intent = 0 (ausencia explícita),
// se viola el gate absence-violated.
export const ABSENCE_GATE_MIN = 0.5;

// Acuerdo a partir del cual la razón se clasifica como bonus (si no, penalty).
export const AGREEMENT_BONUS_THRESHOLD = 0.5;

// Límites del score final.
export const SCORE_MIN = 0;
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
export const GATE_PLATFORMS_DISJOINT = "platforms-disjoint";
export const GATE_ABSENCE_VIOLATED = "absence-violated";
