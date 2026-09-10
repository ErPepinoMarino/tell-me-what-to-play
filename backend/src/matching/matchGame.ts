import {
  ABSENCE_GATE_MIN,
  AGREEMENT_BONUS_THRESHOLD,
  AMPLIFICATION_THRESHOLD,
  COV_MIN,
  EPSILON,
  GATE_ABSENCE_VIOLATED,
  GATE_ANCHOR_OVERLAP_VIOLATED,
  GATE_MUST_VIOLATED,
  GATE_PRESENCE_VIOLATED,
  GATE_RED_FLAG_VIOLATED,
  MATCH_THRESHOLDS,
  SEMANTIC_DEMAND_GATE_MIN,
  SEMANTIC_PASS_MIN,
  SEMANTIC_FIELDS,
  type SemanticField,
} from "./constants.js";
import { keywordStem } from "./keywords.js";
import type {
  MatchCoverage,
  MatchInput,
  MatchReason,
  MatchResult,
  MatchTier,
  MatchableGame,
} from "./types.js";
import type { GameSearchIntent } from "../types/GameSearchIntent.js";

/*
 * Matcher puro: (GameSearchIntent, MatchableGame) → MatchResult.
 * Determinista, explicable y sin I/O. Nunca lanza por contenido de datos:
 * UNKNOWN, arrays vacíos y todo-null se tratan como "no verificable".
 *
 * Dos fases:
 *  1. FILTRO DURO (sin números): todo lo no-semántico pedido explícitamente
 *     debe estar (must); lo excluido explícitamente (red flags) prohíbe.
 *     El juego puede tener MÁS de lo pedido, nunca menos. UNKNOWN falla el
 *     must (no verificable). Los gates marcan tier "invalid".
 *  2. RANKING (solo semántica): media de acuerdo sobre las dimensiones
 *     comparables, con contradicciones amplificadas. Es la única
 *     ponderación numérica.
 */

// Tiene datos clasificables: no vacío y no solo UNKNOWN.
function hasKnownValues(values: string[]): boolean {
  return values.length > 0 && !values.every((value) => value === "UNKNOWN");
}

function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

// Talos de las keywords del juego (frase completa: "car wash" → "car wash").
function gameKeywordStems(game: MatchableGame): Set<string> {
  return new Set(game.keywords.map((keyword) => keywordStem(keyword)));
}

// Talos de las palabras del título ("Grand Theft Auto: San Andreas" →
// grand/theft/auto/san/andreas). Al contrario que antes.
function titleWordStems(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .map((word) => keywordStem(word))
      .filter((word) => word.length > 0),
  );
}

/*
 * Un término (must o red flag) está en el juego si:
 *  (a) su talo coincide con una keyword completa del juego, o
 *  (b) TODAS sus palabras aparecen como palabras del título.
 * (b) es lo que permite excluir "grand theft auto" por título aunque el
 * juego no tenga esa keyword (el prompt expande las siglas de franquicias).
 */
function termMatches(
  term: string,
  keywordStems: Set<string>,
  titleStems: Set<string>,
): boolean {
  const normalized = normalizeTerm(term);
  if (normalized.length === 0) return false;
  if (keywordStems.has(keywordStem(normalized))) return true;

  const words = normalized
    .split(/\s+/)
    .map((word) => keywordStem(word))
    .filter((word) => word.length > 0);
  return words.length > 0 && words.every((word) => titleStems.has(word));
}

function pushGate(
  gatesViolated: string[],
  reasons: MatchReason[],
  gate: string,
  block: MatchReason["block"],
  field: string,
  intentValue: number | string | null,
  gameValue: number | string | null,
): void {
  if (!gatesViolated.includes(gate)) gatesViolated.push(gate);
  reasons.push({
    block,
    field,
    intentValue,
    gameValue,
    contribution: 0,
    kind: "gate",
    note: gate,
  });
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

/*
 * RED FLAGS: lo excluido explícitamente prohíbe el match. Cualquier
 * coincidencia → invalid, aunque el juego sea ideal en todo lo demás.
 */
function checkRedFlags(
  intent: GameSearchIntent,
  game: MatchableGame,
  gatesViolated: string[],
  reasons: MatchReason[],
): void {
  const excluded = intent.excluded;
  if (!excluded) return;

  const keywordStems = gameKeywordStems(game);
  const titleStems = titleWordStems(game.title);

  for (const term of excluded.keywords ?? []) {
    if (termMatches(term, keywordStems, titleStems)) {
      pushGate(
        gatesViolated,
        reasons,
        GATE_RED_FLAG_VIOLATED,
        "keywords",
        `xkw.${normalizeTerm(term)}`,
        normalizeTerm(term),
        game.title,
      );
    }
  }

  const enumChecks: {
    field: string;
    excluded: string[] | null | undefined;
    values: string[];
  }[] = [
    { field: "genres", excluded: excluded.genres, values: game.genres },
    { field: "themes", excluded: excluded.themes, values: game.themes },
    {
      field: "platforms",
      excluded: excluded.platforms,
      values: game.platforms,
    },
    {
      field: "gameModes",
      excluded: excluded.gameModes,
      values: game.gameModes,
    },
    {
      field: "perspectives",
      excluded: excluded.perspectives,
      values: game.perspectives,
    },
  ];
  for (const check of enumChecks) {
    for (const value of check.excluded ?? []) {
      if (check.values.includes(value)) {
        pushGate(
          gatesViolated,
          reasons,
          GATE_RED_FLAG_VIOLATED,
          "objective",
          check.field,
          value,
          check.values.join(","),
        );
      }
    }
  }

  const year = game.releaseYear;
  if (excluded.releaseYear != null && year === excluded.releaseYear) {
    pushGate(
      gatesViolated,
      reasons,
      GATE_RED_FLAG_VIOLATED,
      "objective",
      "releaseYear",
      excluded.releaseYear,
      year,
    );
  }
  if (excluded.yearFrom != null && year !== null && year >= excluded.yearFrom) {
    pushGate(
      gatesViolated,
      reasons,
      GATE_RED_FLAG_VIOLATED,
      "objective",
      "yearFrom",
      excluded.yearFrom,
      year,
    );
  }
  if (excluded.yearTo != null && year !== null && year <= excluded.yearTo) {
    pushGate(
      gatesViolated,
      reasons,
      GATE_RED_FLAG_VIOLATED,
      "objective",
      "yearTo",
      excluded.yearTo,
      year,
    );
  }
}

/*
 * MUST: todo lo pedido explícitamente debe estar. Superset permitido
 * (más géneros/plataformas/keywords no penaliza); UNKNOWN = no verificable
 * = falla; año null = no verificable = falla.
 */
function checkMust(
  intent: GameSearchIntent,
  game: MatchableGame,
  gatesViolated: string[],
  reasons: MatchReason[],
): void {
  const keywordStems = gameKeywordStems(game);
  const titleStems = titleWordStems(game.title);

  for (const term of intent.keywords ?? []) {
    const normalized = normalizeTerm(term);
    if (normalized.length === 0) continue;
    if (termMatches(normalized, keywordStems, titleStems)) {
      // Razón informativa (contribución 0): la temática no puntúa, filtra.
      reasons.push({
        block: "keywords",
        field: `kw.${normalized}`,
        intentValue: normalized,
        gameValue: normalized,
        contribution: 0,
        kind: "bonus",
        note: "keyword-match",
      });
    } else {
      pushGate(
        gatesViolated,
        reasons,
        GATE_MUST_VIOLATED,
        "keywords",
        `kw.${normalized}`,
        normalized,
        null,
      );
    }
  }

  const groups: {
    field: string;
    requested: string[];
    values: string[];
  }[] = [
    {
      field: "genres",
      requested: intent.objective?.genres ?? [],
      values: game.genres,
    },
    {
      field: "themes",
      requested: intent.objective?.themes ?? [],
      values: game.themes,
    },
    {
      field: "platforms",
      requested: intent.objective?.platforms ?? [],
      values: game.platforms,
    },
    {
      field: "gameModes",
      requested: intent.objective?.gameModes ?? [],
      values: game.gameModes,
    },
    {
      field: "perspectives",
      requested: intent.objective?.perspectives ?? [],
      values: game.perspectives,
    },
  ];
  for (const group of groups) {
    if (group.requested.length === 0) continue;
    if (!hasKnownValues(group.values)) {
      // UNKNOWN: no se puede verificar el requisito → falla.
      pushGate(
        gatesViolated,
        reasons,
        GATE_MUST_VIOLATED,
        "objective",
        group.field,
        group.requested.join(","),
        "UNKNOWN",
      );
      continue;
    }
    for (const value of group.requested) {
      if (!group.values.includes(value)) {
        pushGate(
          gatesViolated,
          reasons,
          GATE_MUST_VIOLATED,
          "objective",
          group.field,
          value,
          group.values.join(","),
        );
      }
    }
  }

  const year = game.releaseYear;
  if (intent.releaseYear != null && year !== intent.releaseYear) {
    pushGate(
      gatesViolated,
      reasons,
      GATE_MUST_VIOLATED,
      "objective",
      "releaseYear",
      intent.releaseYear,
      year,
    );
  }
  if (intent.yearFrom != null && (year === null || year < intent.yearFrom)) {
    pushGate(
      gatesViolated,
      reasons,
      GATE_MUST_VIOLATED,
      "objective",
      "yearFrom",
      intent.yearFrom,
      year,
    );
  }
  if (intent.yearTo != null && (year === null || year > intent.yearTo)) {
    pushGate(
      gatesViolated,
      reasons,
      GATE_MUST_VIOLATED,
      "objective",
      "yearTo",
      intent.yearTo,
      year,
    );
  }
}

/*
 * Gate de PRESENCIA (decisión de producto): una demanda semántica fuerte
 * (intent ≥ SEMANTIC_DEMAND_GATE_MIN) exige que el juego APRUEBE (≥ 0.5);
 * suspenso o sin dato → fuera. Simétrico al gate de ausencia.
 */
function checkPresenceGate(
  intent: GameSearchIntent,
  game: MatchableGame,
  gatesViolated: string[],
  reasons: MatchReason[],
): void {
  const semantic = intent.semantic;
  if (!semantic) return;

  for (const field of SEMANTIC_FIELDS) {
    const intentValue = semantic[field];
    if (intentValue === null || intentValue < SEMANTIC_DEMAND_GATE_MIN)
      continue;
    const gameValue = game[field];
    if (gameValue !== null && gameValue >= SEMANTIC_PASS_MIN) continue;

    pushGate(
      gatesViolated,
      reasons,
      GATE_PRESENCE_VIOLATED,
      "semantic",
      field,
      intentValue,
      gameValue,
    );
  }
}

/*
 * Gate de OVERLAP con el ancla ("similar a X"): el candidato debe compartir
 * AL MENOS UNA keyword (talo) con algún ancla — nunca se exigen TODAS las
 * keywords del ancla ("kratos" solo existe en God of War). Sin keywords en
 * el ancla el gate se omite (nada que comparar).
 */
function checkAnchorOverlapGate(
  game: MatchableGame,
  anchors: MatchableGame[],
  gatesViolated: string[],
  reasons: MatchReason[],
): void {
  if (anchors.length === 0) return;

  const anchorStems = new Set(
    anchors.flatMap((anchor) => anchor.keywords.map((k) => keywordStem(k))),
  );
  if (anchorStems.size === 0) return;

  const gameStems = new Set(game.keywords.map((k) => keywordStem(k)));
  const overlaps = [...gameStems].some((stem) => anchorStems.has(stem));
  if (overlaps) return;

  pushGate(
    gatesViolated,
    reasons,
    GATE_ANCHOR_OVERLAP_VIOLATED,
    "keywords",
    "anchor-overlap",
    [...anchorStems].slice(0, 5).join(","),
    game.title,
  );
}

/*
 * Ausencia explícita (contrato del intent): 0 significa "sin nada de eso".
 * Si el juego conoce esa dimensión y la incumple, es invalid.
 */
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
    if (intentValue > EPSILON) continue;
    if (gameValue < ABSENCE_GATE_MIN) continue;

    pushGate(
      gatesViolated,
      reasons,
      GATE_ABSENCE_VIOLATED,
      "semantic",
      field,
      intentValue,
      gameValue,
    );
  }
}

/*
 * Ranking semántico: única ponderación numérica. Media de acuerdo sobre
 * las dimensiones comparables. Una contradicción amplificada (distancia ≥
 * AMPLIFICATION_THRESHOLD) aporta NEGATIVO y de magnitud (acuerdo − 1):
 * debe quedar estrictamente por debajo de una ficha DESCONOCIDA (0), incluso
 * en la contradicción total (distancia 1 → acuerdo 0 → −1; el caso
 * cozy/Bloodborne: un juego de terror no puede empatar con "no sé cómo es"
 * solo por estar bien documentado). La contribución de cada dimensión se
 * reparte entre las comparables, de modo que score = Σ contributions =
 * media (invariante exacta), en [-1,1].
 */
function computeSemanticRanking(
  intent: GameSearchIntent,
  game: MatchableGame,
  reasons: MatchReason[],
): { comparable: number } {
  let comparable = 0;

  // Primera pasada: acuerdos (orden fijo del schema).
  const agreements: {
    field: SemanticField;
    intentValue: number;
    gameValue: number;
    agreement: number;
    amplified: boolean;
  }[] = [];

  for (const field of SEMANTIC_FIELDS) {
    const intentValue = intent.semantic?.[field];
    const gameValue = game[field];
    if (
      intentValue === null ||
      intentValue === undefined ||
      gameValue === null
    ) {
      continue;
    }
    comparable++;
    const distance = Math.abs(intentValue - gameValue);
    /*
     * Estricto (>) para alinear bordes con el gate de presencia: el juego
     * que el gate APRUEBA (≥ 0.5 frente a demanda 1 → distancia ≤ 0.5) no
     * puede etiquetarse "contradice" — el caso cozy/2D Brick Breaker (cozy
     * 0.5) mostraba el chip ✗ siendo válido. Sin el ajuste, distancia 0.5
     * amplificaba (acuerdo 0.25 → contribución −0.75) contradiciendo al gate.
     */
    const amplified = distance > AMPLIFICATION_THRESHOLD;
    const rawAgreement = 1 - distance;
    const agreement = amplified ? rawAgreement * rawAgreement : rawAgreement;
    agreements.push({ field, intentValue, gameValue, agreement, amplified });
  }

  if (comparable > 0) {
    for (const item of agreements) {
      reasons.push({
        block: "semantic",
        field: item.field,
        intentValue: item.intentValue,
        gameValue: item.gameValue,
        contribution:
          (item.amplified ? item.agreement - 1 : item.agreement) / comparable,
        kind: item.amplified
          ? "penalty"
          : item.agreement >= AGREEMENT_BONUS_THRESHOLD
            ? "bonus"
            : "penalty",
        note: item.amplified ? "amplified-contradiction" : "semantic-agreement",
      });
    }
  }

  return { comparable };
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

function assignTier(
  gatesViolated: number,
  score: number,
  covSem: number,
): MatchTier {
  if (gatesViolated > 0) return "invalid";
  if (score >= MATCH_THRESHOLDS.excellent && covSem >= COV_MIN.excellent) {
    return "excellent";
  }
  // Pasó todos los filtros: mostrable. La semántica solo ordena.
  return "valid";
}

/*
 * Fase de filtros duros aislada: ¿el juego cumple TODO lo pedido (must) y
 * no contiene NADA de lo excluido (red flags)? Sin ranking. La usan el
 * pre-filtro de descubrimiento y la canonicalización de la cache para no
 * gastar presupuesto en candidatos condenados a invalid.
 *
 * Opción semanticGates (default true): los gates semánticos de extremo
 * (ausencia/presencia) exigen valores CONOCIDOS del juego. En el pre-filtro
 * de discovery los candidatos aún NO tienen semánticas (las escribirá el
 * enrichment) → semanticGates: false; el candidato se re-evalúa con las
 * semánticas reales tras el enriquecimiento.
 */
export function passesHardFilters(
  intent: GameSearchIntent,
  game: MatchableGame,
  options: { semanticGates?: boolean; anchors?: MatchableGame[] } = {},
): boolean {
  const gatesViolated: string[] = [];
  const reasons: MatchReason[] = [];
  checkRedFlags(intent, game, gatesViolated, reasons);
  checkMust(intent, game, gatesViolated, reasons);
  checkAnchorOverlapGate(game, options.anchors ?? [], gatesViolated, reasons);
  if (options.semanticGates !== false) {
    checkAbsenceGate(intent, game, gatesViolated, reasons);
    checkPresenceGate(intent, game, gatesViolated, reasons);
  }
  return gatesViolated.length === 0;
}

/*
 * Diagnóstico de criba: qué requisitos duros falla un candidato (para la
 * traza discovery-skip-must). Puro y barato: re-ejecuta solo must+red flags.
 */
export function hardFilterViolations(
  intent: GameSearchIntent,
  game: MatchableGame,
): { must: string[]; redFlags: string[] } {
  const gatesViolated: string[] = [];
  const reasons: MatchReason[] = [];
  checkRedFlags(intent, game, gatesViolated, reasons);
  checkMust(intent, game, gatesViolated, reasons);
  const must = new Set<string>();
  const redFlags = new Set<string>();
  for (const reason of reasons) {
    if (reason.kind !== "gate") continue;
    const label =
      reason.block === "keywords"
        ? reason.field
        : `${reason.block}.${reason.field}`;
    if (reason.note === GATE_MUST_VIOLATED) must.add(label);
    else if (reason.note === GATE_RED_FLAG_VIOLATED) redFlags.add(label);
  }
  return { must: [...must], redFlags: [...redFlags] };
}

export function matchGame(input: MatchInput): MatchResult {
  const { intent, game } = input;
  const anchors = input.anchors ?? [];

  const reasons: MatchReason[] = [];
  const gatesViolated: string[] = [];

  // 1. Filtros duros (must + red flags) y gates semánticos de extremos.
  checkRedFlags(intent, game, gatesViolated, reasons);
  checkMust(intent, game, gatesViolated, reasons);
  checkAnchorOverlapGate(game, anchors, gatesViolated, reasons);
  checkAbsenceGate(intent, game, gatesViolated, reasons);
  checkPresenceGate(intent, game, gatesViolated, reasons);

  // 2. Ranking semántico.
  const { comparable } = computeSemanticRanking(intent, game, reasons);
  if (comparable === 0 && gatesViolated.length === 0) {
    reasons.push({
      block: "semantic",
      field: "intent",
      intentValue: null,
      gameValue: null,
      contribution: 0,
      kind: "skipped",
      note: "no-semantic-signal",
    });
  }

  // 3. Orden determinista y score: la suma se hace en el orden ya ordenado
  // para que score = Σ contributions sea exacto. Con contradicciones
  // amplificadas el score puede ser negativo (peor que "desconocido");
  // acotación defensiva a [-1, 1].
  sortReasons(reasons);
  let rawScore = 0;
  for (const reason of reasons) rawScore += reason.contribution;
  const score = Math.max(-1, Math.min(1, rawScore));

  const coverage: MatchCoverage = {
    semanticDims: comparable,
    objectiveFields: [
      game.genres,
      game.themes,
      game.platforms,
      game.gameModes,
      game.perspectives,
    ].filter(hasKnownValues).length,
    hasKeywords: game.keywords.length > 0,
    hasAnchors: anchors.length > 0,
  };

  return {
    score,
    tier: assignTier(
      gatesViolated.length,
      score,
      comparable / SEMANTIC_FIELDS.length,
    ),
    coverage,
    gatesViolated,
    reasons,
  };
}
