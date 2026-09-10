import type {
  GameMode,
  Genre,
  Perspective,
  Platform,
  Theme,
} from "./enums.js";
import type { IgdbGameRaw } from "../igdb/types.js";

export interface Game {
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
  keywords: string[];
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

/*
 * Lo único que asigna la BDD y el mapper no genera es id y searchCount.
 * Todo lo demás (description_es, description_en, coverUrl, releaseYear, semánticas) puede ser null
 * tanto al crear como al leer de la BDD — el schema Prisma las declara nullable.
 */
export type GameToPersist = Omit<Game, "id" | "searchCount">;

/*
 * Candidato intermedio durante el proceso de importación.
 * Contiene los campos normalizados desde IGDB más el raw original,
 * necesario para el enriquecimiento posterior (description_es, description_en, semánticas, etc.).
 * No se persiste: existe solo en memoria hasta que se transforma en GameToPersist.
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
  keywords: string[];
  developers: string[];
  publishers: string[];
  coverUrl: string | null;
  raw: IgdbGameRaw;
}
