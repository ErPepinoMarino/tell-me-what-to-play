import type {
  GameMode,
  Genre,
  Perspective,
  Platform,
  Theme,
} from "./enums.js";
import type { IgdbGameRaw } from "../igdb/types.js";
import type { CuratedKeyword, IgdbKeyword } from "./keywords.js";

// Marca nominal sobre string: las keywords PERSISTIDAS solo pueden nacer del
// vocabulario IGDB (src/igdb/keywords.ts — extractIgdbKeywords). Un string[]
// plana (términos de búsqueda, keywords adicionales del LLM) NO es asignable:
// la contaminación de la BDD pasa a ser estructuralmente imposible, no una
// regla de disciplina.

/*
 * Base común de toda ficha. La procedencia de las keywords está
 * discriminada: un juego IGDB SOLO puede tener IgdbKeyword[] (mint sellado
 * del raw); un juego curado SOLO CuratedKeyword[]. Ninguna es asignable a la
 * otra → es imposible por tipos que un seed "finja" procedencia IGDB o que
 * una search keyword entre en Game.keywords.
 */
interface GameBase {
  id: number;
  slug: string;
  sourceId: string | null;
  title: string;
  description_es: string | null;
  description_en: string | null;
  coverUrl: string | null;
  releaseYear: number | null;
  genres: Genre[];
  themes: Theme[];
  platforms: Platform[];
  gameModes: GameMode[];
  perspectives: Perspective[];
  developers: string[];
  publishers: string[];
  searchCount: number;
  difficulty: number | null;
  pace: number | null;
  narrative: number | null;
  complexity: number | null;
  coziness: number | null;
  strategy: number | null;
  exploration: number | null;
  violence: number | null;
  horror: number | null;
  darkness: number | null;
  tension: number | null;
  humor: number | null;
  isolation: number | null;
}

// Juego cuya fuente es IGDB: keywords === raw.keywords de IGDB, por
// construcción (extractIgdbKeywords), sin excepciones de runtime.
export interface IgdbGame extends GameBase {
  provenance: "igdb";
  keywords: readonly IgdbKeyword[];
}

// Juego con keywords curadas/manuales (seed). Nunca lleva la marca IGDB.
export interface CuratedGame extends GameBase {
  provenance: "curated";
  keywords: readonly CuratedKeyword[];
}

export type Game = IgdbGame | CuratedGame;

/*
 * Lo único que asignan la BDD y el mapper no genera es id y searchCount.
 * Todo lo demás puede ser null tanto al crear como al leer de la BDD — el
 * schema Prisma las declara nullable.
 */
export type IgdbGameToPersist = Omit<IgdbGame, "id" | "searchCount">;
export type CuratedGameToPersist = Omit<CuratedGame, "id" | "searchCount">;

/*
 * Candidato intermedio durante el proceso de importación.
 * Contiene los campos normalizados desde IGDB más el raw original,
 * necesario para el enriquecimiento posterior (description_es, description_en, semánticas, etc.).
 * No se persiste: existe solo en memoria hasta que se transforma en IgdbGameToPersist.
 * Las keywords son SIEMPRE IgdbKeyword (mint sellado del raw).
 */
export interface Candidate {
  sourceId: string;
  slug: string;
  title: string;
  releaseYear: number | null;
  genres: Genre[];
  themes: Theme[];
  platforms: Platform[];
  gameModes: GameMode[];
  perspectives: Perspective[];
  keywords: readonly IgdbKeyword[];
  developers: string[];
  publishers: string[];
  coverUrl: string | null;
  raw: IgdbGameRaw;
}