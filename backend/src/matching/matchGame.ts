import {
  ABSENCE_GATE_MIN,
  AGREEMENT_BONUS_THRESHOLD,
  AMPLIFICATION_THRESHOLD,
  COV_MIN,
  EPSILON,
  GATE_ABSENCE_VIOLATED,
  GATE_PLATFORMS_DISJOINT,
  MATCH_THRESHOLDS,
  MATCH_WEIGHTS,
  OBJ_SUBWEIGHTS,
  PLATFORM_BONUS,
  SCORE_MAX,
  SCORE_MIN,
  SEMANTIC_FIELDS,
  ZERO_OVERLAP_PENALTIES,
  type SemanticField,
} from "./constants.js";
import { keywordStem } from "./keywords.js";
import type {
  MatchBlock,
  MatchCoverage,
  MatchInput,
  MatchReason,
  MatchResult,
  MatchTier,
  MatchableGame,
} from "./types.js";
import type { GameSearchIntent } from "../types/GameSearchIntent.js";

// Orden fijo de bloques: cálculo, razones y suma en coma flotante reproducible.
const BLOCK_ORDER: MatchBlock[] = [
  "semantic",
  "objective",
  "keywords",
  "reference",
];

/*
 * Parte de razón en unidades del bloque (share). El peso efectivo del bloque
 * se aplica al materializar la razón, así la renormalización toca solo aquí.
 */
interface BlockPart {
  field: string;
  intentValue: number | string | null;
  gameValue: number | string | null;
  share: number;
  kind: "bonus" | "penalty";
  note: string;
}

interface BlockComputation {
  available: boolean;
  // Puntuación cruda del bloque, a escala propia (diagnóstico; puede ser negativa).
  score: number | null;
  parts: BlockPart[];
  comparableFields: number;
  positiveOverlap: boolean;
  // Solo semántico: dims comparables en contradicción amplificada
  // (distancia >= AMPLIFICATION_THRESHOLD). Un match por keywords no da
  // validez si la ficha contradice así las semánticas pedidas.
  amplifiedContradictions: number;
  // Razón "skipped" a emitir cuando el bloque computa a cero por falta de solape.
  zeroOverlap: {
    intentValue: string;
    gameValue: string;
    note: string;
  } | null;
}

function unavailableBlock(): BlockComputation {
  return {
    available: false,
    score: null,
    parts: [],
    comparableFields: 0,
    positiveOverlap: false,
    amplifiedContradictions: 0,
    zeroOverlap: null,
  };
}

// Tiene datos clasificables: no vacío y no solo UNKNOWN.
function hasKnownValues(values: string[]): boolean {
  return values.length > 0 && !values.every((value) => value === "UNKNOWN");
}

function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase();
}

// Normaliza y deduplica preservando el orden (determinismo).
function uniqueNormalized(keywords: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const keyword of keywords) {
    const normalized = normalizeKeyword(keyword);
    if (normalized.length > 0 && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

// Compartido con rankMatches: ¿es este juego uno de los referenciados (anclas)?
export function isAnchorGame(
  game: MatchableGame,
  anchors: MatchableGame[],
): boolean {
  return anchors.some(
    (anchor) =>
      anchor.slug === game.slug ||
      (game.sourceId !== null && anchor.sourceId === game.sourceId),
  );
}

function checkPlatformGate(
  intent: GameSearchIntent,
  game: MatchableGame,
  gatesViolated: string[],
  reasons: MatchReason[],
): void {
  const requested = intent.objective?.platforms ?? [];
  // Sin plataformas pedidas o juego sin datos clasificables → no comparable.
  if (requested.length === 0 || !hasKnownValues(game.platforms)) return;

  const overlap = requested.filter((platform) =>
    game.platforms.includes(platform),
  );
  if (overlap.length === 0) {
    if (!gatesViolated.includes(GATE_PLATFORMS_DISJOINT)) {
      gatesViolated.push(GATE_PLATFORMS_DISJOINT);
    }
    reasons.push({
      block: "objective",
      field: "platforms",
      intentValue: requested.join(","),
      gameValue: game.platforms.join(","),
      contribution: 0,
      kind: "gate",
      note: GATE_PLATFORMS_DISJOINT,
    });
  }
}

function checkAbsenceGate(
  intent: GameSearchIntent,
  game: MatchableGame,
  gatesViolated: string[],
  reasons: MatchReason[],
): void {
  const semantic = intent.semantic;
  if (!semantic) return;

  for (const field of SEMANTIC_FIELDS) {
    const intentValue = semantic[field];
    const gameValue = game[field];
    if (intentValue === null || gameValue === null) continue;
    // 0 es ausencia explícita (contrato del intent), nunca "poco".
    if (intentValue > EPSILON) continue;
    if (gameValue < ABSENCE_GATE_MIN) continue;

    if (!gatesViolated.includes(GATE_ABSENCE_VIOLATED)) {
      gatesViolated.push(GATE_ABSENCE_VIOLATED);
    }
    reasons.push({
      block: "semantic",
      field,
      intentValue,
      gameValue,
      contribution: 0,
      kind: "gate",
      note: GATE_ABSENCE_VIOLATED,
    });
  }
}

function computeSemanticBlock(
  intent: GameSearchIntent,
  game: MatchableGame,
): BlockComputation {
  const semantic = intent.semantic;
  if (!semantic) return unavailableBlock();

  interface Comparable {
    field: SemanticField;
    intentValue: number;
    gameValue: number;
    agreement: number;
    note: string;
  }

  const comparable: Comparable[] = [];
  let amplifiedContradictions = 0;
  for (const field of SEMANTIC_FIELDS) {
    const intentValue = semantic[field];
    const gameValue = game[field];
    // null = desconocido en cualquiera de las partes → no comparable.
    if (intentValue === null || gameValue === null) continue;

    const distance = Math.abs(intentValue - gameValue);
    let agreement = 1 - distance;
    let note = "semantic-agreement";
    if (distance >= AMPLIFICATION_THRESHOLD) {
      // Casi-opuestos duelen más que lineal.
      agreement = agreement * agreement;
      note = "amplified-contradiction";
      amplifiedContradictions++;
    }
    comparable.push({ field, intentValue, gameValue, agreement, note });
  }

  if (comparable.length === 0) return unavailableBlock();

  const parts: BlockPart[] = comparable.map((c): BlockPart => ({
    field: c.field,
    intentValue: c.intentValue,
    gameValue: c.gameValue,
    share: c.agreement / comparable.length,
    kind: c.agreement >= AGREEMENT_BONUS_THRESHOLD ? "bonus" : "penalty",
    note: c.note,
  }));
  const score =
    comparable.reduce((sum, c) => sum + c.agreement, 0) / comparable.length;

  return {
    available: true,
    score,
    parts,
    comparableFields: comparable.length,
    positiveOverlap: false,
    amplifiedContradictions,
    zeroOverlap: null,
  };
}

function computeObjectiveBlock(
  intent: GameSearchIntent,
  game: MatchableGame,
): BlockComputation {
  const parts: BlockPart[] = [];
  let comparableFields = 0;
  let positiveOverlap = false;
  let score = 0;
  const objective = intent.objective;

  // Géneros: overlap proporcional; cero overlap penaliza (suave), no es gate.
  const requestedGenres = objective?.genres ?? [];
  if (requestedGenres.length > 0 && hasKnownValues(game.genres)) {
    comparableFields++;
    const present = requestedGenres.filter((genre) =>
      game.genres.includes(genre),
    );
    if (present.length === 0) {
      const share = OBJ_SUBWEIGHTS.genres * -ZERO_OVERLAP_PENALTIES.genres;
      score += share;
      parts.push({
        field: "genres",
        intentValue: requestedGenres.join(","),
        gameValue: game.genres.join(","),
        share,
        kind: "penalty",
        note: "no-overlap",
      });
    } else {
      for (const genre of present) {
        const share = OBJ_SUBWEIGHTS.genres / requestedGenres.length;
        score += share;
        positiveOverlap = true;
        parts.push({
          field: `genres.${genre}`,
          intentValue: genre,
          gameValue: genre,
          share,
          kind: "bonus",
          note: "genre-match",
        });
      }
    }
  }

  // Modos de juego: cero overlap penaliza fuerte (soft-gate).
  const requestedModes = objective?.gameModes ?? [];
  if (requestedModes.length > 0 && hasKnownValues(game.gameModes)) {
    comparableFields++;
    const present = requestedModes.filter((mode) =>
      game.gameModes.includes(mode),
    );
    if (present.length === 0) {
      const share =
        OBJ_SUBWEIGHTS.gameModes * -ZERO_OVERLAP_PENALTIES.gameModes;
      score += share;
      parts.push({
        field: "gameModes",
        intentValue: requestedModes.join(","),
        gameValue: game.gameModes.join(","),
        share,
        kind: "penalty",
        note: "no-overlap",
      });
    } else {
      for (const mode of present) {
        const share = OBJ_SUBWEIGHTS.gameModes / requestedModes.length;
        score += share;
        positiveOverlap = true;
        parts.push({
          field: `gameModes.${mode}`,
          intentValue: mode,
          gameValue: mode,
          share,
          kind: "bonus",
          note: "mode-match",
        });
      }
    }
  }

  // Perspectivas: cero overlap no penaliza (solo ausencia de bonus).
  const requestedPerspectives = objective?.perspectives ?? [];
  if (requestedPerspectives.length > 0 && hasKnownValues(game.perspectives)) {
    comparableFields++;
    const present = requestedPerspectives.filter((perspective) =>
      game.perspectives.includes(perspective),
    );
    for (const perspective of present) {
      const share = OBJ_SUBWEIGHTS.perspectives / requestedPerspectives.length;
      score += share;
      positiveOverlap = true;
      parts.push({
        field: `perspectives.${perspective}`,
        intentValue: perspective,
        gameValue: perspective,
        share,
        kind: "bonus",
        note: "perspective-match",
      });
    }
  }

  // Plataformas: overlap → bonus fijo. El disjoint lo detecta el gate previo.
  const requestedPlatforms = objective?.platforms ?? [];
  if (requestedPlatforms.length > 0 && hasKnownValues(game.platforms)) {
    comparableFields++;
    const overlap = requestedPlatforms.filter((platform) =>
      game.platforms.includes(platform),
    );
    if (overlap.length > 0) {
      score += PLATFORM_BONUS;
      positiveOverlap = true;
      parts.push({
        field: "platforms",
        intentValue: requestedPlatforms.join(","),
        gameValue: game.platforms.join(","),
        share: PLATFORM_BONUS,
        kind: "bonus",
        note: "platform-overlap",
      });
    }
  }

  if (comparableFields === 0) return unavailableBlock();

  return {
    available: true,
    score,
    parts,
    comparableFields,
    positiveOverlap,
    amplifiedContradictions: 0,
    zeroOverlap: null,
  };
}

function computeKeywordsBlock(
  intent: GameSearchIntent,
  game: MatchableGame,
): BlockComputation {
  const requested = uniqueNormalized(intent.keywords ?? []);
  const gameKeywords = uniqueNormalized(game.keywords);
  // La intención pide keywords y el juego tiene con qué comparar.
  if (requested.length === 0 || gameKeywords.length === 0) {
    return unavailableBlock();
  }

  // Match por talo: "zombie" casa con "Zombies", "stories" con "story".
  const gameStems = new Set(gameKeywords.map(keywordStem));
  const matched = requested.filter((keyword) =>
    gameStems.has(keywordStem(keyword)),
  );
  const parts: BlockPart[] = matched.map((keyword): BlockPart => ({
    field: `kw.${keyword}`,
    intentValue: keyword,
    gameValue: keyword,
    share: 1 / requested.length,
    kind: "bonus",
    note: "keyword-match",
  }));

  return {
    available: true,
    score: matched.length / requested.length,
    parts,
    comparableFields: 1,
    positiveOverlap: matched.length > 0,
    amplifiedContradictions: 0,
    zeroOverlap:
      matched.length === 0
        ? {
            intentValue: requested.join(","),
            gameValue: gameKeywords.join(","),
            note: "no-keyword-overlap",
          }
        : null,
  };
}

function computeReferenceBlock(
  game: MatchableGame,
  anchors: MatchableGame[],
): BlockComputation {
  if (anchors.length === 0) return unavailableBlock();

  const anchorKeywords = uniqueNormalized(
    anchors.flatMap((anchor) => anchor.keywords),
  );
  if (anchorKeywords.length === 0) return unavailableBlock();

  // El candidato ES el ancla: bloque pleno (nunca se muestra;
  // rankMatches lo excluye con motivo "referenced-anchor").
  if (isAnchorGame(game, anchors)) {
    return {
      available: true,
      score: 1,
      parts: [
        {
          field: "reference",
          intentValue: null,
          gameValue: game.slug,
          share: 1,
          kind: "bonus",
          note: "is-anchor",
        },
      ],
      comparableFields: 1,
      positiveOverlap: false,
      amplifiedContradictions: 0,
      zeroOverlap: null,
    };
  }

  const candidateKeywords = uniqueNormalized(game.keywords);
  const matched = anchorKeywords.filter((keyword) =>
    candidateKeywords.includes(keyword),
  );

  return {
    available: true,
    score: matched.length / anchorKeywords.length,
    parts: matched.map((keyword): BlockPart => ({
      field: `ref.${keyword}`,
      intentValue: keyword,
      gameValue: keyword,
      share: 1 / anchorKeywords.length,
      kind: "bonus",
      note: "reference-keyword",
    })),
    comparableFields: 1,
    positiveOverlap: false,
    amplifiedContradictions: 0,
    zeroOverlap:
      matched.length === 0
        ? {
            intentValue: anchorKeywords.join(","),
            gameValue: candidateKeywords.join(","),
            note: "no-reference-overlap",
          }
        : null,
  };
}

function assignTier(params: {
  gatesViolated: number;
  anyAvailable: boolean;
  score: number;
  covSem: number;
  objectiveOverlap: boolean;
  /*
   * Camino de validez por keywords (regla de producto: 0 semánticas conocidas
   * puede ser válido si las keywords lo justifican). Se desactiva cuando la
   * ficha contradice de forma amplificada alguna semántica pedida: ahí manda
   * la contradicción, no la temática.
   */
  keywordOverlap: boolean;
}): MatchTier {
  const {
    gatesViolated,
    anyAvailable,
    score,
    covSem,
    objectiveOverlap,
    keywordOverlap,
  } = params;
  if (gatesViolated > 0) return "invalid";
  if (!anyAvailable) return "invalid";
  if (score >= MATCH_THRESHOLDS.excellent && covSem >= COV_MIN.excellent) {
    return "excellent";
  }
  if (
    score >= MATCH_THRESHOLDS.valid &&
    (covSem >= COV_MIN.valid || objectiveOverlap || keywordOverlap)
  ) {
    return "valid";
  }
  if (score >= MATCH_THRESHOLDS.weak) return "weak";
  return "invalid";
}

// |contribution| descendente; empates por field asc (codepoints, no locale).
// Array.sort es estable: el orden de inserción ya es determinista.
function sortReasons(reasons: MatchReason[]): void {
  reasons.sort((a, b) => {
    const magnitude = Math.abs(b.contribution) - Math.abs(a.contribution);
    if (Math.abs(magnitude) > EPSILON) return magnitude;
    if (a.field < b.field) return -1;
    if (a.field > b.field) return 1;
    return 0;
  });
}

/*
 * Matcher puro: (GameSearchIntent, MatchableGame) → MatchResult.
 * Determinista, explicable y sin I/O. Nunca lanza por contenido de datos:
 * UNKNOWN, arrays vacíos y todo-null se tratan como "no comparable".
 */
export function matchGame(input: MatchInput): MatchResult {
  const { intent, game } = input;
  const anchors = input.anchors ?? [];

  const reasons: MatchReason[] = [];
  const gatesViolated: string[] = [];

  // 1. Gates: condiciones duras. El score se calcula igualmente (diagnóstico).
  checkPlatformGate(intent, game, gatesViolated, reasons);
  checkAbsenceGate(intent, game, gatesViolated, reasons);

  // 2. Bloques crudos: partes en unidades del bloque, sin pesos efectivos.
  const computations: Record<MatchBlock, BlockComputation> = {
    semantic: computeSemanticBlock(intent, game),
    objective: computeObjectiveBlock(intent, game),
    keywords: computeKeywordsBlock(intent, game),
    reference: computeReferenceBlock(game, anchors),
  };

  // 3. Renormalización: los bloques no computables ceden su peso a los demás.
  const availableWeight = BLOCK_ORDER.reduce(
    (sum, block) =>
      computations[block].available ? sum + MATCH_WEIGHTS[block] : sum,
    0,
  );
  const anyAvailable = availableWeight > EPSILON;

  // 4. Materializa razones (contributions en unidades de score final).
  if (anyAvailable) {
    for (const block of BLOCK_ORDER) {
      const computation = computations[block];
      if (!computation.available) {
        reasons.push({
          block,
          field: block,
          intentValue: null,
          gameValue: null,
          contribution: 0,
          kind: "skipped",
          note: "weight-renormalized",
        });
        continue;
      }
      const effectiveWeight = MATCH_WEIGHTS[block] / availableWeight;
      for (const part of computation.parts) {
        reasons.push({
          block,
          field: part.field,
          intentValue: part.intentValue,
          gameValue: part.gameValue,
          contribution: effectiveWeight * part.share,
          kind: part.kind,
          note: part.note,
        });
      }
      if (computation.zeroOverlap) {
        reasons.push({
          block,
          field: block,
          intentValue: computation.zeroOverlap.intentValue,
          gameValue: computation.zeroOverlap.gameValue,
          contribution: 0,
          kind: "skipped",
          note: computation.zeroOverlap.note,
        });
      }
    }
  } else {
    reasons.push({
      block: "semantic",
      field: "intent",
      intentValue: null,
      gameValue: null,
      contribution: 0,
      kind: "skipped",
      note: "no-usable-signal",
    });
  }

  // 5. Orden determinista y score: la suma se hace en el orden ya ordenado
  // para que score = clamp(Σ contributions) sea exacto (invariante I2).
  sortReasons(reasons);
  let rawScore = 0;
  for (const reason of reasons) rawScore += reason.contribution;
  const score = Math.min(SCORE_MAX, Math.max(SCORE_MIN, rawScore));

  const coverage: MatchCoverage = {
    semanticDims: computations.semantic.comparableFields,
    objectiveFields: computations.objective.comparableFields,
    hasKeywords: game.keywords.length > 0,
    hasAnchors: anchors.length > 0,
  };

  return {
    score,
    tier: assignTier({
      gatesViolated: gatesViolated.length,
      anyAvailable,
      score,
      covSem: coverage.semanticDims / SEMANTIC_FIELDS.length,
      objectiveOverlap: computations.objective.positiveOverlap,
      keywordOverlap:
        computations.keywords.positiveOverlap &&
        computations.semantic.amplifiedContradictions === 0,
    }),
    coverage,
    gatesViolated,
    reasons,
    blockScores: {
      semantic: computations.semantic.score,
      objective: computations.objective.score,
      keywords: computations.keywords.score,
      reference: computations.reference.score,
    },
  };
}
