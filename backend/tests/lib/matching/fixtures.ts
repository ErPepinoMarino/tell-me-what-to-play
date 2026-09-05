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
 * Golden fixtures del matcher (modelo de filtros duros):
 * - Fase FILTRO: must (todas las señales no-semánticas pedidas deben estar;
 *   UNKNOWN = no verificable = falla) y red flags (excluyen siempre).
 * - Fase RANKING: solo semántica — media de acuerdo, contradicciones
 *   amplificadas en negativo (peor que desconocido).
 */

type Objective = NonNullable<GameSearchIntent["objective"]>;
type Semantic = NonNullable<GameSearchIntent["semantic"]>;
type Excluded = NonNullable<GameSearchIntent["excluded"]>;

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
    title: `Game ${overrides.id}`,
    releaseYear: 2020,
    genres: ["UNKNOWN"],
    themes: ["UNKNOWN"],
    platforms: ["UNKNOWN"],
    gameModes: ["UNKNOWN"],
    perspectives: ["UNKNOWN"],
    keywords: [],
    ...nullSemantic(),
    ...overrides,
  };
}

// Objetivo con todos los campos a null; los overrides añaden requisito.
export function makeObjective(overrides: Partial<Objective> = {}): Objective {
  return {
    genres: null,
    themes: null,
    platforms: null,
    gameModes: null,
    perspectives: null,
    ...overrides,
  };
}

// Red flags todas a null; los overrides añaden exclusiones.
export function makeExcluded(
  overrides: Partial<Excluded> = {},
): Excluded {
  return {
    keywords: null,
    genres: null,
    themes: null,
    platforms: null,
    gameModes: null,
    perspectives: null,
    releaseYear: null,
    yearFrom: null,
    yearTo: null,
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
    releaseYear: null,
    yearFrom: null,
    yearTo: null,
    excluded: null,
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
  // ---- Must: keywords ----
  {
    name: "F1 keyword pedida ausente → invalid (must)",
    intent: makeIntent({ keywords: ["cozy"] }),
    game: makeGame({ id: 1, slug: "dark-elves", keywords: ["horror", "elves"] }),
    expect: {
      tier: "invalid",
      gatesViolated: ["must-violated"],
      scoreRange: [0, 0],
      mustHaveReasons: [
        { block: "keywords", field: "kw.cozy", kind: "gate", note: "must-violated" },
      ],
    },
  },
  {
    name: "F2 keyword pedida presente → valid + razón informativa",
    intent: makeIntent({ keywords: ["cozy"] }),
    game: makeGame({ id: 2, slug: "farm-sim", keywords: ["cozy", "farming"] }),
    expect: {
      tier: "valid",
      gatesViolated: [],
      scoreRange: [0, 0],
      coverage: { hasKeywords: true, semanticDims: 0 },
      mustHaveReasons: [
        { block: "keywords", field: "kw.cozy", kind: "bonus", note: "keyword-match" },
      ],
      mustNotHaveReasons: [{ kind: "gate" }],
    },
  },
  {
    name: "F3 keyword pedida presente por título (palabra)",
    intent: makeIntent({ keywords: ["batman"] }),
    game: makeGame({
      id: 3,
      slug: "arkham",
      title: "Batman: Arkham City",
      keywords: ["SHOOTER"],
    }),
    expect: {
      tier: "valid",
      gatesViolated: [],
      mustHaveReasons: [
        { block: "keywords", field: "kw.batman", kind: "bonus", note: "keyword-match" },
      ],
    },
  },
  {
    name: "F4 talo de keyword: 'zombies' casa con 'zombie'",
    intent: makeIntent({ keywords: ["zombies"] }),
    game: makeGame({ id: 4, slug: "undead", keywords: ["zombie"] }),
    expect: {
      tier: "valid",
      gatesViolated: [],
    },
  },

  // ---- Must: enums (superset OK, UNKNOWN falla) ----
  {
    name: "F5 género pedido con juego UNKNOWN → invalid (no verificable)",
    intent: makeIntent({ objective: makeObjective({ genres: ["ROLE_PLAYING_RPG"] }) }),
    game: makeGame({ id: 5, slug: "unknown-genre", genres: ["UNKNOWN"] }),
    expect: {
      tier: "invalid",
      gatesViolated: ["must-violated"],
      mustHaveReasons: [
        { block: "objective", field: "genres", kind: "gate", note: "must-violated" },
      ],
    },
  },
  {
    name: "F6 género pedido presente con superset → valid",
    intent: makeIntent({ objective: makeObjective({ genres: ["ROLE_PLAYING_RPG"] }) }),
    game: makeGame({ id: 6, slug: "rpg-action", genres: ["ROLE_PLAYING_RPG", "SHOOTER"] }),
    expect: {
      tier: "valid",
      gatesViolated: [],
      mustNotHaveReasons: [{ kind: "gate" }],
    },
  },
  {
    name: "F7 género pedido ausente → invalid",
    intent: makeIntent({ objective: makeObjective({ genres: ["ROLE_PLAYING_RPG"] }) }),
    game: makeGame({ id: 7, slug: "pure-puzzle", genres: ["PUZZLE"] }),
    expect: {
      tier: "invalid",
      gatesViolated: ["must-violated"],
      mustHaveReasons: [
        { block: "objective", field: "genres", kind: "gate", note: "must-violated" },
      ],
    },
  },
  {
    name: "F8 plataforma pedida presente entre varias → valid (superset)",
    intent: makeIntent({ objective: makeObjective({ platforms: ["PC"] }) }),
    game: makeGame({ id: 8, slug: "multiplatform", platforms: ["PC", "PS5"] }),
    expect: {
      tier: "valid",
      gatesViolated: [],
    },
  },
  {
    name: "F9 plataforma pedida ausente → invalid",
    intent: makeIntent({ objective: makeObjective({ platforms: ["PSP"] }) }),
    game: makeGame({ id: 9, slug: "pc-only", platforms: ["PC"] }),
    expect: {
      tier: "invalid",
      gatesViolated: ["must-violated"],
    },
  },

  // ---- Must: año exacto y rangos ----
  {
    name: "F10 año exacto distinto → invalid; juego sin año → invalid",
    intent: makeIntent({ releaseYear: 2004 }),
    game: makeGame({ id: 10, slug: "wrong-year", releaseYear: 2003 }),
    expect: {
      tier: "invalid",
      gatesViolated: ["must-violated"],
      mustHaveReasons: [
        { block: "objective", field: "releaseYear", kind: "gate", note: "must-violated" },
      ],
    },
  },
  {
    name: "F11 año exacto coincidente → valid",
    intent: makeIntent({ releaseYear: 2004 }),
    game: makeGame({ id: 11, slug: "right-year", releaseYear: 2004 }),
    expect: {
      tier: "valid",
      gatesViolated: [],
    },
  },
  {
    name: "F12 rango de años: dentro → valid, fuera → invalid",
    intent: makeIntent({ yearFrom: 1990, yearTo: 1999 }),
    game: makeGame({ id: 12, slug: "nineties", releaseYear: 1995 }),
    expect: {
      tier: "valid",
      gatesViolated: [],
    },
  },
  {
    name: "F13 rango de años: fuera por arriba → invalid",
    intent: makeIntent({ yearFrom: 1990, yearTo: 1999 }),
    game: makeGame({ id: 13, slug: "two-thousands", releaseYear: 2005 }),
    expect: {
      tier: "invalid",
      gatesViolated: ["must-violated"],
      mustHaveReasons: [
        { block: "objective", field: "yearTo", kind: "gate", note: "must-violated" },
      ],
    },
  },
  {
    name: "F14 rango de años: juego sin año → invalid (no verificable)",
    intent: makeIntent({ yearFrom: 1990, yearTo: 1999 }),
    game: makeGame({ id: 14, slug: "no-year", releaseYear: null }),
    expect: {
      tier: "invalid",
      gatesViolated: ["must-violated"],
    },
  },

  // ---- Red flags ----
  {
    name: "R1 keyword excluida presente → invalid (red flag)",
    intent: makeIntent({
      keywords: ["crime"],
      excluded: makeExcluded({ keywords: ["gta"] }),
    }),
    game: makeGame({ id: 20, slug: "gta-like", keywords: ["gta", "crime"] }),
    expect: {
      tier: "invalid",
      gatesViolated: ["red-flag-violated"],
      scoreRange: [0, 0],
      mustHaveReasons: [
        { block: "keywords", field: "xkw.gta", kind: "gate", note: "red-flag-violated" },
      ],
    },
  },
  {
    name: "R2 término excluido multi-palabra por título (Grand Theft Auto)",
    intent: makeIntent({
      keywords: ["car stealing"],
      excluded: makeExcluded({ keywords: ["grand theft auto"] }),
    }),
    game: makeGame({
      id: 21,
      slug: "gta-san-andreas",
      title: "Grand Theft Auto: San Andreas",
      keywords: ["car stealing", "open world"],
    }),
    expect: {
      tier: "invalid",
      gatesViolated: ["red-flag-violated"],
      mustHaveReasons: [
        {
          block: "keywords",
          field: "xkw.grand theft auto",
          kind: "gate",
          note: "red-flag-violated",
        },
      ],
    },
  },
  {
    name: "R3 plataforma excluida presente → invalid",
    intent: makeIntent({
      excluded: makeExcluded({ platforms: ["SWITCH"] }),
    }),
    game: makeGame({ id: 22, slug: "switch-exclusive", platforms: ["SWITCH"] }),
    expect: {
      tier: "invalid",
      gatesViolated: ["red-flag-violated"],
    },
  },
  {
    name: "R4 año excluido → invalid",
    intent: makeIntent({
      excluded: makeExcluded({ releaseYear: 2004 }),
    }),
    game: makeGame({ id: 23, slug: "year-2004", releaseYear: 2004 }),
    expect: {
      tier: "invalid",
      gatesViolated: ["red-flag-violated"],
    },
  },
  {
    name: "R5 red flag que NO está presente → valid (solo filtra lo excluido)",
    intent: makeIntent({
      keywords: ["crime"],
      excluded: makeExcluded({ keywords: ["gta", "grand theft auto"] }),
    }),
    game: makeGame({ id: 24, slug: "heist-sim", keywords: ["crime", "heist"] }),
    expect: {
      tier: "valid",
      gatesViolated: [],
      mustHaveReasons: [
        { block: "keywords", field: "kw.crime", kind: "bonus", note: "keyword-match" },
      ],
    },
  },

  // ---- Ranking semántico ----
  {
    name: "S1 media de acuerdo → score 0.95",
    intent: makeIntent({ semantic: makeSemantic({ narrative: 0.9 }) }),
    game: makeGame({ id: 30, slug: "narrative-heavy", narrative: 0.85 }),
    expect: {
      tier: "valid",
      scoreRange: [0.94, 0.96],
      coverage: { semanticDims: 1 },
      mustHaveReasons: [
        { block: "semantic", field: "narrative", kind: "bonus", note: "semantic-agreement" },
      ],
    },
  },
  {
    name: "S2 contradicción amplificada → invalid (demanda 0.9 activa presence gate)",
    intent: makeIntent({ semantic: makeSemantic({ horror: 0.9 }) }),
    game: makeGame({ id: 31, slug: "not-horror", horror: 0.1 }),
    expect: {
      // La demanda 0.9 es MAXIMAL (≥ 0.9): el juego suspende (0.1) → gate de
      // presencia, además del score negativo por contradicción amplificada.
      tier: "invalid",
      gatesViolated: ["presence-violated"],
      // (acuerdo 0.04) − 1 = −0.96: estrictamente por debajo de lo desconocido
      scoreRange: [-0.97, -0.95],
      mustHaveReasons: [
        { block: "semantic", field: "horror", kind: "penalty", note: "amplified-contradiction" },
        { block: "semantic", field: "horror", kind: "gate", note: "presence-violated" },
      ],
    },
  },
  {
    name: "S3 sin semánticas comparables → valid con score 0",
    intent: makeIntent({ keywords: ["cozy"] }),
    game: makeGame({ id: 32, slug: "cozy-game", keywords: ["cozy"] }),
    expect: {
      tier: "valid",
      scoreRange: [0, 0],
      mustHaveReasons: [
        { block: "semantic", kind: "skipped", note: "no-semantic-signal" },
      ],
    },
  },
  {
    name: "S4 excelente: acuerdo pleno en 7 dims (cobertura ≥ 0.5)",
    intent: makeIntent({
      semantic: makeSemantic({
        difficulty: 0.8,
        pace: 0.2,
        narrative: 0.7,
        complexity: 0.6,
        darkness: 0.9,
        tension: 0.7,
        exploration: 0.8,
      }),
    }),
    game: makeGame({
      id: 33,
      slug: "seven-dims",
      difficulty: 0.8,
      pace: 0.2,
      narrative: 0.7,
      complexity: 0.6,
      darkness: 0.9,
      tension: 0.7,
      exploration: 0.8,
    }),
    expect: {
      tier: "excellent",
      scoreRange: [0.99, 1],
      coverage: { semanticDims: 7 },
    },
  },
  {
    name: "S5 acuerdo pleno en 4 dims: score 1 pero cobertura < 0.5 → no excellent",
    intent: makeIntent({
      semantic: makeSemantic({
        difficulty: 0.8,
        horror: 0.2,
        narrative: 0.7,
        strategy: 0.6,
      }),
    }),
    game: makeGame({
      id: 34,
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
    name: "S6 intención vacía pasa filtros → valid (el orquestador la captura antes)",
    intent: makeIntent(),
    game: makeGame({ id: 35, slug: "anything" }),
    expect: {
      tier: "valid",
      scoreRange: [0, 0],
      mustHaveReasons: [{ kind: "skipped", note: "no-semantic-signal" }],
    },
  },

  // ---- Ausencia explícita (gate semántico) ----
  {
    name: "A1 ausencia explícita violada → invalid (gate)",
    intent: makeIntent({ semantic: makeSemantic({ horror: 0 }) }),
    game: makeGame({ id: 40, slug: "very-scary", horror: 0.9 }),
    expect: {
      tier: "invalid",
      gatesViolated: ["absence-violated"],
      // (acuerdo 0.01) − 1 = −0.99: estrictamente por debajo de lo desconocido
      scoreRange: [-1, -0.98],
      mustHaveReasons: [
        { block: "semantic", field: "horror", kind: "gate", note: "absence-violated" },
        { block: "semantic", field: "horror", kind: "penalty", note: "amplified-contradiction" },
      ],
    },
  },
  {
    name: "A2 ausencia respetada → bonus",
    intent: makeIntent({ semantic: makeSemantic({ horror: 0 }) }),
    game: makeGame({ id: 41, slug: "not-scary", horror: 0.05 }),
    expect: {
      tier: "valid",
      scoreRange: [0.94, 0.96],
      mustNotHaveReasons: [{ kind: "gate" }],
    },
  },
];
