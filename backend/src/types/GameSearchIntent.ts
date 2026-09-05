import { z } from "zod";

// La informacion objetiva (no semantica) ahora la sacamos de los cambios de IGDB
// Los campos semanticos son puramente nuestros y los "deduciremos" de busquedas web.

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
 * Red flags: elementos que el usuario ha EXCLUIDO explícitamente.
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

//Variables semanticas (lo que hace original mi querida app)
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
 * Overrides semánticos del delta de refinamiento: objeto COMPLETO (todas las
 * dimensiones, null = no mencionada).
 * Para trabajar con openai necesitamos pasarse TODOS los campos aunque no los usemos.
 * Así que null es la convención y 0..1 son los valores permitidos.
 */
export const SemanticOverrideSchema = SemanticSchema;

/*
 * Contrato: TODO campo no-semántico que el intérprete rellene es un
 * requisito DURO (must): los resultados deben tenerlos todos — pueden
 * tener más (más géneros, más plataformas, más keywords), nunca menos.
 */
export const GameSearchIntentSchema = z.object({
  gameReferenced: z.array(z.string()).nullable(),
  objective: ObjectiveSchema.nullable(),
  keywords: z.array(z.string()).nullable(),
  // Año exacto pedido
  releaseYear: z.number().int().nullable(),
  // Rangos de años.
  yearFrom: z.number().int().nullable(),
  yearTo: z.number().int().nullable(),
  // Elementos excluidos explícitamente (red flags)
  excluded: ExcludedSchema.nullable(),
  // Relación con la búsqueda anterior (si hay): refine, new o nonsensical.
  relation: z.enum(["new", "refine", "nonsensical"]).nullable().default(null),
  // Dimensiones semánticas (0..1, null = no mencionado)
  semantic: SemanticSchema.nullable(),
});

export type GameSearchIntent = z.infer<typeof GameSearchIntentSchema>;

/*
 * ¿Que diferenci hay entre esto en GameSearchintent?
 * Que aqui no se incluye GameReferenced, ni relation, ni excluded. Solo lo que se puede añadir o quitar.
 */
const RefineAddSchema = z.object({
  keywords: z.array(z.string()).nullable(),
  genres: z.array(GenreSchema).nullable(),
  themes: z.array(ThemeSchema).nullable(),
  platforms: z.array(PlatformSchema).nullable(),
  gameModes: z.array(GameModeSchema).nullable(),
  perspectives: z.array(PerspectiveSchema).nullable(),
  gameReferenced: z.array(z.string()).nullable(),
  releaseYear: z.number().int().nullable(),
  yearFrom: z.number().int().nullable(),
  yearTo: z.number().int().nullable(),
  // Overrides semánticos ("más violento" → violence 0.9); objeto COMPLETO,
  // null en las dimensiones que el mensaje no menciona.
  semantic: SemanticSchema.nullable(),
});
/*
 * Firma identica a RefineAddSchema
 * Pero en este caso definimos que el usuario quiere quitar algo de la busqueda anterior.
 */
const RefineRemoveSchema = z.object({
  keywords: z.array(z.string()).nullable(),
  genres: z.array(GenreSchema).nullable(),
  themes: z.array(ThemeSchema).nullable(),
  platforms: z.array(PlatformSchema).nullable(),
  gameModes: z.array(GameModeSchema).nullable(),
  perspectives: z.array(PerspectiveSchema).nullable(),
  gameReferenced: z.array(z.string()).nullable(),
  releaseYear: z.boolean().nullable(),
  yearFrom: z.boolean().nullable(),
  yearTo: z.boolean().nullable(),
  semantic: z.array(z.string()).nullable(),
});

export const RefineDeltaSchema = z.object({
  add: RefineAddSchema.nullable(),
  remove: RefineRemoveSchema.nullable(),
  excluded: ExcludedSchema.nullable(),
});

export type RefineDelta = z.infer<typeof RefineDeltaSchema>;
