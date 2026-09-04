import { z } from "zod";

const GENRES = [
  "ACTION",
  "ADVENTURE",
  "ARCADE",
  "CASUAL",
  "FIGHTING",
  "HORROR",
  "INDIE",
  "MMO",
  "PLATFORMER",
  "PUZZLE",
  "RACING",
  "RPG",
  "SHOOTER",
  "SIMULATION",
  "SPORTS",
  "STRATEGY",
  "VISUAL_NOVEL",
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
export const PlatformSchema = z.enum(PLATFORMS);
export const GameModeSchema = z.enum(GAME_MODES);
export const PerspectiveSchema = z.enum(PERSPECTIVES);

const SemanticScore = z.number().min(0).max(1).nullable();

const ObjectiveSchema = z.object({
  genres: z.array(GenreSchema).nullable(),
  platforms: z.array(PlatformSchema).nullable(),
  gameModes: z.array(GameModeSchema).nullable(),
  perspectives: z.array(PerspectiveSchema).nullable(),
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

export const GameSearchIntentSchema = z.object({
  gameReferenced: z.array(z.string()).nullable(),
  objective: ObjectiveSchema.nullable(),
  keywords: z.array(z.string()).nullable(),
  semantic: SemanticSchema.nullable(),
});

export type GameSearchIntent = z.infer<typeof GameSearchIntentSchema>;
