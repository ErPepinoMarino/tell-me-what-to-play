// Mapper: IgdbGameRaw (API externa) -> dominio TMWTP listo para persistir.
// Función pura: no HTTP, no Prisma, no IA, sin colisiones de slug (eso es
// responsabilidad del ImportService). Orquesta los normalizers existentes.

import type { Candidate, GameToPersist } from "../types/Game.js";
import {
  extractYear,
  generateSlug,
  normalizeGameModes,
  normalizeGenres,
  normalizeKeywords,
  normalizePerspectives,
  normalizePlatforms,
  normalizeThemes,
} from "./normalizers.js";
import type { IgdbGameRaw } from "./types.js";

// Patrón de la URL de imágenes de IGDB
const IMAGE_URL = "https://images.igdb.com/igdb/image/upload/t_cover_big";

// Extrae los nombres de una relación de IGDB (ej. genres: [{name: "Action"}])
function extractNames(
  related: { name: string }[] | undefined,
): string[] | undefined {
  return related?.map((item) => item.name);
}

// Construye la URL de la portada a partir del image_id de IGDB
function buildCoverUrl(cover: IgdbGameRaw["cover"]): string | null {
  return cover?.image_id ? `${IMAGE_URL}/${cover.image_id}.jpg` : null;
}

// Filtra involved_companies por rol (developer/publisher) y saca nombres únicos
function extractCompanies(
  raw: IgdbGameRaw["involved_companies"],
  role: "developer" | "publisher",
): string[] {
  const names = raw
    ?.filter((company) => company[role])
    .map((company) => company.company.name)
    .filter((name) => name.trim().length > 0);
  return [...new Set(names ?? [])]; // dedupe preservando orden
}

/*
 * Transforma un juego raw de IGDB en el dominio TMWTP.
 * Regla fundamental: NADA se descarta. Todo nombre sin equivalencia en un
 * enum (géneros, plataformas, modos, perspectivas) acaba en keywords.
 * description_es, description_en y semánticas quedan null: solo el enriquecimiento futuro
 * puede escribirlos.
 */
export function mapIGDBGame(raw: IgdbGameRaw): GameToPersist {
  // 1. Normalizamos las clasificaciones (enums + unclassified)
  const genres = normalizeGenres(extractNames(raw.genres));
  const themes = normalizeThemes(extractNames(raw.themes));
  const platforms = normalizePlatforms(extractNames(raw.platforms));
  const gameModes = normalizeGameModes(extractNames(raw.game_modes));
  const perspectives = normalizePerspectives(
    extractNames(raw.player_perspectives),
  );

  // 2. Todo lo que no cupo en un enum se conserva como vocabulario abierto
  const unclassified = [
    ...genres.unclassified,
    ...platforms.unclassified,
    ...gameModes.unclassified,
    ...perspectives.unclassified,
  ];
  const keywords = normalizeKeywords(extractNames(raw.keywords), unclassified);

  // 3. Fecha -> año (null si IGDB no la trae)
  const releaseYear = extractYear(raw.first_release_date);

  return {
    slug: generateSlug(raw.name, releaseYear),
    title: raw.name,
    description_es: null, // nunca se genera aquí: es del enriquecimiento futuro
    description_en: null, // nunca se genera aquí: es del enriquecimiento futuro
    coverUrl: buildCoverUrl(raw.cover),
    releaseYear,
    // Defaults del schema: sin clasificación clasificable -> UNKNOWN
    genres: genres.values.length > 0 ? genres.values : ["UNKNOWN"],
    themes: themes.values.length > 0 ? themes.values : ["UNKNOWN"],
    platforms: platforms.values.length > 0 ? platforms.values : ["UNKNOWN"],
    gameModes: gameModes.values.length > 0 ? gameModes.values : ["UNKNOWN"],
    perspectives:
      perspectives.values.length > 0 ? perspectives.values : ["UNKNOWN"],
    keywords,
    sourceId: String(raw.id),
    developers: extractCompanies(raw.involved_companies, "developer"),
    publishers: extractCompanies(raw.involved_companies, "publisher"),
    // Semánticas: el importador NUNCA las infiere
    difficulty: null,
    pace: null,
    narrative: null,
    complexity: null,
    coziness: null,
    strategy: null,
    exploration: null,
    violence: null,
    horror: null,
    darkness: null,
    tension: null,
    humor: null,
    isolation: null,
  };
}

/*
 * Transforma un IgdbGameRaw en un Candidate para el pipeline de importación.
 * Reutiliza la misma normalización que mapIGDBGame pero:
 * - NO incluye description_es, description_en ni semánticas (se rellenan en el enriquecimiento)
 * - SÍ incluye el raw original (necesario para el enriquecimiento)
 */
export function mapToCandidate(raw: IgdbGameRaw): Candidate {
  const genres = normalizeGenres(extractNames(raw.genres));
  const themes = normalizeThemes(extractNames(raw.themes));
  const platforms = normalizePlatforms(extractNames(raw.platforms));
  const gameModes = normalizeGameModes(extractNames(raw.game_modes));
  const perspectives = normalizePerspectives(
    extractNames(raw.player_perspectives),
  );

  const unclassified = [
    ...genres.unclassified,
    ...platforms.unclassified,
    ...gameModes.unclassified,
    ...perspectives.unclassified,
  ];
  const keywords = normalizeKeywords(extractNames(raw.keywords), unclassified);

  return {
    slug: generateSlug(raw.name, extractYear(raw.first_release_date)),
    title: raw.name,
    coverUrl: buildCoverUrl(raw.cover),
    releaseYear: extractYear(raw.first_release_date),
    genres: genres.values.length > 0 ? genres.values : ["UNKNOWN"],
    themes: themes.values.length > 0 ? themes.values : ["UNKNOWN"],
    platforms: platforms.values.length > 0 ? platforms.values : ["UNKNOWN"],
    gameModes: gameModes.values.length > 0 ? gameModes.values : ["UNKNOWN"],
    perspectives:
      perspectives.values.length > 0 ? perspectives.values : ["UNKNOWN"],
    keywords,
    sourceId: String(raw.id),
    developers: extractCompanies(raw.involved_companies, "developer"),
    publishers: extractCompanies(raw.involved_companies, "publisher"),
    raw,
  };
}
