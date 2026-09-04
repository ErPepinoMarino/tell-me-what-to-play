import { GameSearchIntentSchema } from "../../../src/types/GameSearchIntent.js";
import type { GameSearchIntent } from "../../../src/types/GameSearchIntent.js";
import {
  SEMANTIC_FIELDS,
  type SemanticField,
} from "../../../src/matching/constants.js";
import type {
  MatchBlock,
  MatchCoverage,
  MatchReasonKind,
  MatchTier,
  MatchableGame,
} from "../../../src/matching/types.js";

/*
 * Golden fixtures del matcher (contrato acordado):
 * - Fase 1: tiers, gates, razones y rangos de score (robustos a calibración).
 * - Fase 2: tras calibrar umbrales, snapshot exacto de scores.
 */

type Objective = NonNullable<GameSearchIntent["objective"]>;
type Semantic = NonNullable<GameSearchIntent["semantic"]>;

function nullSemantic(): Semantic {
  return Object.fromEntries(
    SEMANTIC_FIELDS.map((field) => [field, null]),
  ) as Semantic;
}

// Game de BDD con todo vacío: solo UNKNOWN y null. Los overrides añaden señal.
export function makeGame(
  overrides: Partial<MatchableGame> & Pick<MatchableGame, "id" | "slug">,
): MatchableGame {
  return {
    sourceId: null,
    genres: ["UNKNOWN"],
    platforms: ["UNKNOWN"],
    gameModes: ["UNKNOWN"],
    perspectives: ["UNKNOWN"],
    keywords: [],
    ...nullSemantic(),
    ...overrides,
  };
}

// Objetivo con todos los campos a null; los overrides añaden señal.
export function makeObjective(overrides: Partial<Objective> = {}): Objective {
  return {
    genres: null,
    platforms: null,
    gameModes: null,
    perspectives: null,
    ...overrides,
  };
}

// Semánticas todas a null; los overrides fijan dimensiones concretas.
export function makeSemantic(
  overrides: Partial<Record<SemanticField, number | null>> = {},
): Semantic {
  return { ...nullSemantic(), ...overrides };
}

// Intención vacía validada por el schema; los overrides añaden señal.
export function makeIntent(
  overrides: Partial<GameSearchIntent> = {},
): GameSearchIntent {
  return GameSearchIntentSchema.parse({
    gameReferenced: null,
    objective: null,
    keywords: null,
    semantic: null,
    ...overrides,
  });
}

export interface ReasonExpectation {
  block?: MatchBlock;
  field?: string;
  kind?: MatchReasonKind;
  note?: string;
}

export interface MatchExpectation {
  tier: MatchTier;
  gatesViolated?: string[];
  scoreRange?: [number, number];
  coverage?: Partial<MatchCoverage>;
  mustHaveReasons?: ReasonExpectation[];
  mustNotHaveReasons?: ReasonExpectation[];
}

export interface MatchFixture {
  name: string;
  intent: GameSearchIntent;
  game: MatchableGame;
  anchors?: MatchableGame[];
  expect: MatchExpectation;
}

export const FIXTURES: MatchFixture[] = [
  // ---- Gates (inválido) ----
  {
    name: "G1 plataformas disjoint → gate",
    intent: makeIntent({ objective: makeObjective({ platforms: ["SWITCH"] }) }),
    game: makeGame({ id: 1, slug: "ps5-exclusive", platforms: ["PS5", "PC"] }),
    expect: {
      tier: "invalid",
      gatesViolated: ["platforms-disjoint"],
      scoreRange: [0, 0],
      coverage: { objectiveFields: 1 },
      mustHaveReasons: [
        {
          block: "objective",
          field: "platforms",
          kind: "gate",
          note: "platforms-disjoint",
        },
      ],
    },
  },
  {
    name: "G2 plataformas UNKNOWN → gate omitido",
    intent: makeIntent({
      objective: makeObjective({ platforms: ["PC"] }),
      keywords: ["space"],
    }),
    game: makeGame({ id: 2, slug: "unknown-platform", keywords: ["space"] }),
    expect: {
      tier: "valid",
      gatesViolated: [],
      scoreRange: [0.99, 1],
      coverage: { hasKeywords: true, objectiveFields: 0 },
      mustHaveReasons: [
        { field: "kw.space", kind: "bonus", note: "keyword-match" },
      ],
      mustNotHaveReasons: [{ kind: "gate" }],
    },
  },
  {
    name: "G3 ausencia explícita violada → gate",
    intent: makeIntent({ semantic: makeSemantic({ horror: 0 }) }),
    game: makeGame({ id: 3, slug: "very-scary", horror: 0.9 }),
    expect: {
      tier: "invalid",
      gatesViolated: ["absence-violated"],
      scoreRange: [0, 0.05],
      mustHaveReasons: [
        {
          block: "semantic",
          field: "horror",
          kind: "gate",
          note: "absence-violated",
        },
        {
          block: "semantic",
          field: "horror",
          kind: "penalty",
          note: "amplified-contradiction",
        },
      ],
    },
  },
  {
    name: "G4 ausencia respetada → bonus",
    intent: makeIntent({ semantic: makeSemantic({ horror: 0 }) }),
    game: makeGame({ id: 4, slug: "not-scary", horror: 0.05 }),
    expect: {
      tier: "weak",
      scoreRange: [0.94, 0.96],
      mustHaveReasons: [
        {
          block: "semantic",
          field: "horror",
          kind: "bonus",
          note: "semantic-agreement",
        },
      ],
      mustNotHaveReasons: [{ kind: "gate" }],
    },
  },
  {
    name: "G5 intención vacía → inválido",
    intent: makeIntent(),
    game: makeGame({ id: 5, slug: "anything" }),
    expect: {
      tier: "invalid",
      scoreRange: [0, 0],
      coverage: {
        semanticDims: 0,
        objectiveFields: 0,
        hasKeywords: false,
        hasAnchors: false,
      },
      mustHaveReasons: [{ kind: "skipped", note: "no-usable-signal" }],
    },
  },

  // ---- Bloque objetivo ----
  {
    name: "O1 objetivo pleno → válido (tope por cobertura)",
    intent: makeIntent({
      objective: makeObjective({
        genres: ["RPG", "ACTION"],
        gameModes: ["COOPERATIVE"],
        perspectives: ["THIRD_PERSON"],
      }),
    }),
    game: makeGame({
      id: 6,
      slug: "objective-perfect",
      genres: ["RPG", "ACTION"],
      gameModes: ["COOPERATIVE"],
      perspectives: ["THIRD_PERSON"],
      platforms: ["PC"],
    }),
    expect: {
      tier: "valid",
      scoreRange: [0.99, 1],
      coverage: { objectiveFields: 3, semanticDims: 0 },
      mustHaveReasons: [
        { field: "genres.RPG", kind: "bonus", note: "genre-match" },
        { field: "genres.ACTION", kind: "bonus", note: "genre-match" },
        { field: "gameModes.COOPERATIVE", kind: "bonus", note: "mode-match" },
        {
          field: "perspectives.THIRD_PERSON",
          kind: "bonus",
          note: "perspective-match",
        },
      ],
    },
  },
  {
    name: "O2 géneros sin overlap → penalty, no gate",
    intent: makeIntent({ objective: makeObjective({ genres: ["RPG"] }) }),
    game: makeGame({ id: 7, slug: "pure-puzzle", genres: ["PUZZLE"] }),
    expect: {
      tier: "invalid",
      gatesViolated: [],
      scoreRange: [0, 0],
      mustHaveReasons: [
        {
          block: "objective",
          field: "genres",
          kind: "penalty",
          note: "no-overlap",
        },
      ],
      mustNotHaveReasons: [{ kind: "gate" }],
    },
  },
  {
    name: "O3 overlap parcial → bonus proporcional",
    intent: makeIntent({
      objective: makeObjective({ genres: ["RPG", "ACTION"] }),
    }),
    game: makeGame({ id: 8, slug: "half-rpg", genres: ["RPG"] }),
    expect: {
      tier: "invalid",
      scoreRange: [0.24, 0.26],
      mustHaveReasons: [
        { field: "genres.RPG", kind: "bonus", note: "genre-match" },
      ],
      mustNotHaveReasons: [{ note: "no-overlap" }],
    },
  },
  {
    name: "O4 modos contradictorios → penalty fuerte",
    intent: makeIntent({
      objective: makeObjective({ gameModes: ["COOPERATIVE"] }),
    }),
    game: makeGame({ id: 9, slug: "solo-game", gameModes: ["SINGLE_PLAYER"] }),
    expect: {
      tier: "invalid",
      scoreRange: [0, 0],
      mustHaveReasons: [
        {
          block: "objective",
          field: "gameModes",
          kind: "penalty",
          note: "no-overlap",
        },
      ],
    },
  },
  {
    name: "O5 plataforma overlap → bonus fijo",
    intent: makeIntent({
      objective: makeObjective({ genres: ["RPG"], platforms: ["SWITCH"] }),
    }),
    game: makeGame({
      id: 10,
      slug: "switch-rpg",
      genres: ["RPG"],
      platforms: ["SWITCH", "PC"],
    }),
    expect: {
      tier: "valid",
      scoreRange: [0.59, 0.61],
      mustHaveReasons: [
        { field: "platforms", kind: "bonus", note: "platform-overlap" },
        { field: "genres.RPG", kind: "bonus", note: "genre-match" },
      ],
    },
  },

  // ---- Bloque semántico ----
  {
    name: "S1 acuerdo alto",
    intent: makeIntent({ semantic: makeSemantic({ narrative: 0.9 }) }),
    game: makeGame({ id: 11, slug: "narrative-heavy", narrative: 0.85 }),
    expect: {
      tier: "weak",
      scoreRange: [0.94, 0.96],
      mustHaveReasons: [
        {
          block: "semantic",
          field: "narrative",
          kind: "bonus",
          note: "semantic-agreement",
        },
      ],
    },
  },
  {
    name: "S2 contradicción amplificada",
    intent: makeIntent({ semantic: makeSemantic({ horror: 0.9 }) }),
    game: makeGame({ id: 12, slug: "not-horror", horror: 0.1 }),
    expect: {
      tier: "invalid",
      scoreRange: [0.03, 0.05],
      mustHaveReasons: [
        {
          block: "semantic",
          field: "horror",
          kind: "penalty",
          note: "amplified-contradiction",
        },
      ],
    },
  },
  {
    name: "S3 semántico null → bloque renormalizado",
    intent: makeIntent({ keywords: ["cozy"] }),
    game: makeGame({
      id: 13,
      slug: "cozy-game",
      keywords: ["cozy", "farming"],
    }),
    expect: {
      tier: "valid",
      scoreRange: [0.99, 1],
      mustHaveReasons: [
        { block: "semantic", kind: "skipped", note: "weight-renormalized" },
        { field: "kw.cozy", kind: "bonus", note: "keyword-match" },
      ],
    },
  },
  {
    name: "S4 cobertura parcial → válido, no excelente",
    intent: makeIntent({
      semantic: makeSemantic({
        difficulty: 0.8,
        horror: 0.2,
        narrative: 0.7,
        strategy: 0.6,
      }),
    }),
    game: makeGame({
      id: 14,
      slug: "four-dims",
      difficulty: 0.8,
      horror: 0.2,
      narrative: 0.7,
      strategy: 0.6,
    }),
    expect: {
      tier: "valid",
      scoreRange: [0.99, 1],
      coverage: { semanticDims: 4 },
    },
  },
  {
    name: "S5 neutral 0.5 vs 0.5 → acuerdo pleno",
    intent: makeIntent({ semantic: makeSemantic({ difficulty: 0.5 }) }),
    game: makeGame({ id: 15, slug: "mid-game", difficulty: 0.5 }),
    expect: {
      tier: "weak",
      scoreRange: [0.99, 1],
      mustHaveReasons: [
        { field: "difficulty", kind: "bonus", note: "semantic-agreement" },
      ],
    },
  },

  // ---- Bloque keywords ----
  {
    name: "K1 keywords todas → bonus por cada una",
    intent: makeIntent({ keywords: ["cozy", "farming", "pixel"] }),
    game: makeGame({
      id: 16,
      slug: "farm-sim",
      keywords: ["cozy", "farming", "pixel", "retro"],
    }),
    expect: {
      tier: "valid",
      scoreRange: [0.99, 1],
      mustHaveReasons: [
        { field: "kw.cozy", kind: "bonus", note: "keyword-match" },
        { field: "kw.farming", kind: "bonus", note: "keyword-match" },
        { field: "kw.pixel", kind: "bonus", note: "keyword-match" },
      ],
    },
  },
  {
    name: "K2 keywords sin overlap → skipped, sin penalty",
    intent: makeIntent({ keywords: ["cozy"] }),
    game: makeGame({
      id: 17,
      slug: "dark-elves",
      keywords: ["horror", "elves"],
    }),
    expect: {
      tier: "invalid",
      scoreRange: [0, 0],
      mustHaveReasons: [
        { block: "keywords", kind: "skipped", note: "no-keyword-overlap" },
      ],
    },
  },
  {
    name: "K3 case-insensitive",
    intent: makeIntent({ keywords: ["Cozy"] }),
    game: makeGame({ id: 18, slug: "COZY", keywords: ["COZY"] }),
    expect: {
      tier: "valid",
      scoreRange: [0.99, 1],
      mustHaveReasons: [
        { field: "kw.cozy", kind: "bonus", note: "keyword-match" },
      ],
    },
  },
  {
    name: "K4 juego sin keywords → renormalización a objetivo",
    intent: makeIntent({
      objective: makeObjective({ genres: ["PUZZLE"] }),
      keywords: ["cozy"],
    }),
    game: makeGame({ id: 19, slug: "puzzle-no-kw", genres: ["PUZZLE"] }),
    expect: {
      tier: "valid",
      scoreRange: [0.49, 0.51],
      mustHaveReasons: [
        { block: "keywords", kind: "skipped", note: "weight-renormalized" },
        { field: "genres.PUZZLE", kind: "bonus", note: "genre-match" },
      ],
    },
  },

  // ---- Bloque reference (anclas) ----
  {
    name: "R1 ancla con keyword compartida",
    intent: makeIntent({ gameReferenced: ["GTA V"] }),
    anchors: [
      makeGame({ id: 100, slug: "gta-v", keywords: ["crime", "open-world"] }),
    ],
    game: makeGame({
      id: 101,
      slug: "heist-sim",
      keywords: ["crime", "driving"],
    }),
    expect: {
      tier: "weak",
      scoreRange: [0.49, 0.51],
      coverage: { hasAnchors: true },
      mustHaveReasons: [
        {
          block: "reference",
          field: "ref.crime",
          kind: "bonus",
          note: "reference-keyword",
        },
      ],
    },
  },
  {
    name: "R2 candidato ES el ancla → is-anchor",
    intent: makeIntent({ gameReferenced: ["GTA V"] }),
    anchors: [
      makeGame({ id: 100, slug: "gta-v", keywords: ["crime", "open-world"] }),
    ],
    game: makeGame({
      id: 100,
      slug: "gta-v",
      keywords: ["crime", "open-world"],
    }),
    expect: {
      tier: "weak",
      scoreRange: [0.99, 1],
      mustHaveReasons: [
        { block: "reference", kind: "bonus", note: "is-anchor" },
      ],
    },
  },
  {
    name: "R3 gameReferenced sin anclas → sin señal utilizable",
    intent: makeIntent({ gameReferenced: ["GTA V"] }),
    game: makeGame({ id: 102, slug: "anything" }),
    expect: {
      tier: "invalid",
      scoreRange: [0, 0],
      coverage: { hasAnchors: false },
      mustHaveReasons: [{ kind: "skipped", note: "no-usable-signal" }],
    },
  },

  // ---- Renormalización ----
  {
    name: "N1 solo objetivo+keywords → válido, tope por cobertura",
    intent: makeIntent({
      objective: makeObjective({ genres: ["RPG"] }),
      keywords: ["soulslike"],
    }),
    game: makeGame({
      id: 20,
      slug: "souls-rpg",
      genres: ["RPG"],
      keywords: ["soulslike"],
    }),
    expect: {
      tier: "valid",
      scoreRange: [0.83, 0.85],
      mustHaveReasons: [
        { block: "semantic", note: "weight-renormalized" },
        { block: "reference", note: "weight-renormalized" },
        { field: "genres.RPG", kind: "bonus", note: "genre-match" },
        { field: "kw.soulslike", kind: "bonus", note: "keyword-match" },
      ],
    },
  },
];
