import type {
  GameMode,
  Genre,
  Perspective,
  Platform,
  Theme,
} from "./enums.js";
import type { IgdbGameRaw } from "../igdb/types.js";
import type { IgdbKeyword } from "./keywords.js";

// Marca nominal sobre string: las keywords de un juego tienen UNA única
// semántica — son las keywords canónicas de IGDB para ese juego
// (src/igdb/keywords.ts — extractIgdbKeywords). Un string[] plana (términos
// de búsqueda, keywords adicionales del LLM) NO es asignable: la
// contaminación de la BDD pasa a ser estructuralmente imposible, no una
// regla de disciplina.

// Toda ficha del catálogo: keywords === raw.keywords de IGDB, por
// construcción (extractIgdbKeywords), sin excepciones de runtime.
export interface IgdbGame {
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
  keywords: readonly IgdbKeyword[];
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

export type Game = IgdbGame;

export type IgdbGameToPersist = Omit<IgdbGame, "id" | "searchCount">;

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