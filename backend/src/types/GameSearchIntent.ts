import { z } from "zod";
import {
  Genre,
  Theme,
  Platform,
  GameMode,
  Perspective,
} from "./enums.js";

/*
 * Los Zod schemas se derivan de los enums de Prisma (fuente de verdad).
 * z.nativeEnum() acepta el const object generado por Prisma y preserva
 * los tipos literales para inferencia de TypeScript.
 */
export const GenreSchema = z.nativeEnum(Genre);
export const ThemeSchema = z.nativeEnum(Theme);
export const PlatformSchema = z.nativeEnum(Platform);
export const GameModeSchema = z.nativeEnum(GameMode);
export const PerspectiveSchema = z.nativeEnum(Perspective);

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
 * Firma identica a RefineAddSchema, pero además permite levantar una
 * exclusión previa vía `excluded` ("los mods son irrelevantes" →
 * excluded.keywords).
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
  excluded: z
    .object({
      keywords: z.array(z.string()).nullable(),
      genres: z.array(GenreSchema).nullable(),
      themes: z.array(ThemeSchema).nullable(),
      platforms: z.array(PlatformSchema).nullable(),
      gameModes: z.array(GameModeSchema).nullable(),
      perspectives: z.array(PerspectiveSchema).nullable(),
      releaseYear: z.boolean().nullable(),
      yearFrom: z.boolean().nullable(),
      yearTo: z.boolean().nullable(),
    })
    .nullable(),
});

export const RefineDeltaSchema = z.object({
  add: RefineAddSchema.nullable(),
  remove: RefineRemoveSchema.nullable(),
  excluded: ExcludedSchema.nullable(),
});

export type RefineDelta = z.infer<typeof RefineDeltaSchema>;
