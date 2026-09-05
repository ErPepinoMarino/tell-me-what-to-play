import { z } from "zod";

const GENRES = [
  "ADVENTURE",
  "ARCADE",
  "CARD_AND_BOARD_GAME",
  "FIGHTING",
  "HACK_AND_SLASH_BEAT_EM_UP",
  "INDIE",
  "MOBA",
  "MUSIC",
  "PINBALL",
  "PLATFORM",
  "POINT_AND_CLICK",
  "PUZZLE",
  "QUIZ_TRIVIA",
  "RACING",
  "REAL_TIME_STRATEGY",
  "ROLE_PLAYING_RPG",
  "SHOOTER",
  "SIMULATOR",
  "SPORT",
  "STRATEGY",
  "TACTICAL",
  "TURN_BASED_STRATEGY",
  "VISUAL_NOVEL",
  "UNKNOWN",
] as const;

/*
 * Themes de IGDB (/v4/themes): mundo/tono/ambientación. Capa MUST junto a
 * géneros y plataformas ("de terror", "de acción", "fantasía").
 */
const THEMES = [
  "ACTION",
  "BUSINESS",
  "COMEDY",
  "DRAMA",
  "EDUCATIONAL",
  "EROTIC",
  "FANTASY",
  "FOUR_X",
  "HISTORICAL",
  "HORROR",
  "KIDS",
  "MYSTERY",
  "NON_FICTION",
  "OPEN_WORLD",
  "PARTY",
  "ROMANCE",
  "SANDBOX",
  "SCIENCE_FICTION",
  "STEALTH",
  "SURVIVAL",
  "THRILLER",
  "WARFARE",
  "UNKNOWN",
] as const;

const PLATFORMS = [
  "PC",
  "MAC",
  "LINUX",
  "PS5",
  "PS4",
  "PS3",
  "PS2",
  "PS1",
  "PS_VITA",
  "PSP",
  "XBOX_SERIES",
  "XBOX_ONE",
  "XBOX_360",
  "XBOX",
  "SWITCH",
  "WII_U",
  "WII",
  "GAMECUBE",
  "N64",
  "SNES",
  "NES",
  "NINTENDO_3DS",
  "DS",
  "GAME_BOY",
  "GAME_BOY_ADVANCE",
  "IOS",
  "ANDROID",
  "UNKNOWN",
] as const;

const GAME_MODES = [
  "SINGLE_PLAYER",
  "MULTIPLAYER",
  "COOPERATIVE",
  "COMPETITIVE",
  "MASSIVELY_MULTIPLAYER",
  "UNKNOWN",
] as const;
const PERSPECTIVES = [
  "FIRST_PERSON",
  "THIRD_PERSON",
  "TOP_DOWN",
  "ISOMETRIC",
  "SIDE_VIEW",
  "TEXT",
  "UNKNOWN",
] as const;

export const GenreSchema = z.enum(GENRES);
export const ThemeSchema = z.enum(THEMES);
export const PlatformSchema = z.enum(PLATFORMS);
export const GameModeSchema = z.enum(GAME_MODES);
export const PerspectiveSchema = z.enum(PERSPECTIVES);

const SemanticScore = z.number().min(0).max(1).nullable();

const ObjectiveSchema = z.object({
  genres: z.array(GenreSchema).nullable(),
  themes: z.array(ThemeSchema).nullable(),
  platforms: z.array(PlatformSchema).nullable(),
  gameModes: z.array(GameModeSchema).nullable(),
  perspectives: z.array(PerspectiveSchema).nullable(),
});

/*
 * Red flags: elementos que el usuario ha EXCLUIDO explícitamente ("que no
 * sea X", "sin X"). Cualquier candidato que los contenga queda fuera del
 * match, aunque sea ideal en todo lo demás.
 */
const ExcludedSchema = z.object({
  keywords: z.array(z.string()).nullable(),
  genres: z.array(GenreSchema).nullable(),
  themes: z.array(ThemeSchema).nullable(),
  platforms: z.array(PlatformSchema).nullable(),
  gameModes: z.array(GameModeSchema).nullable(),
  perspectives: z.array(PerspectiveSchema).nullable(),
  releaseYear: z.number().int().nullable(),
  yearFrom: z.number().int().nullable(),
  yearTo: z.number().int().nullable(),
});

const SemanticSchema = z.object({
  complexity: SemanticScore,
  coziness: SemanticScore,
  darkness: SemanticScore,
  difficulty: SemanticScore,
  exploration: SemanticScore,
  horror: SemanticScore,
  humor: SemanticScore,
  isolation: SemanticScore,
  narrative: SemanticScore,
  pace: SemanticScore,
  strategy: SemanticScore,
  tension: SemanticScore,
  violence: SemanticScore,
});

/*
 * Contrato: TODO campo no-semántico que el intérprete rellene es un
 * requisito DURO (must): los resultados deben tenerlos todos — pueden
 * tener más (más géneros, más plataformas, más keywords), nunca menos.
 * Los campos null = "no pedido". Las semánticas (0..1) son la única
 * ponderación numérica del ranking.
 */
export const GameSearchIntentSchema = z.object({
  gameReferenced: z.array(z.string()).nullable(),
  objective: ObjectiveSchema.nullable(),
  keywords: z.array(z.string()).nullable(),
  // Año exacto pedido ("del 2004")
  releaseYear: z.number().int().nullable(),
  // Rangos pedidos ("de los 90" → 1990/1999, "anteriores a 2010" → yearTo 2009)
  yearFrom: z.number().int().nullable(),
  yearTo: z.number().int().nullable(),
  // Elementos excluidos explícitamente (red flags)
  excluded: ExcludedSchema.nullable(),
  /*
   * Relación con la intención previa de sesión (solo se emite cuando hay
   * contexto): "refine" = el mensaje continúa/ajusta la búsqueda anterior;
   * "new" = tema nuevo. Null/ausente = sin contexto (búsqueda fresca).
   * Default null para no romper fixtures ni clientes antiguos.
   */
  relation: z.enum(["new", "refine"]).nullable().default(null),
  semantic: SemanticSchema.nullable(),
});

export type GameSearchIntent = z.infer<typeof GameSearchIntentSchema>;
