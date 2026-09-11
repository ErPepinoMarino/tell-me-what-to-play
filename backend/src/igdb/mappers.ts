// Mapper: IgdbGameRaw (API externa) -> dominio TMWTP listo para persistir.
// Función pura: no HTTP, no Prisma, no IA, sin colisiones de slug (eso es
// responsabilidad del ImportService). Orquesta los normalizers existentes.

import type { Candidate, IgdbGameToPersist } from "../types/Game.js";
import type { EnrichmentEditable } from "../types/GameEnrichment.js";
import { extractIgdbKeywords } from "./keywords.js";
import {
  extractYear,
  generateSlug,
  normalizeGameModes,
  normalizeGenres,
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
 * Transforma un IgdbGameRaw en un Candidate para el pipeline de importación.
 * Normaliza las clasificaciones (enums) y extrae las keywords EXCLUSIVAMENTE
 * de raw.keywords (extractIgdbKeywords). A diferencia del resto del pipeline:
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
    keywords: extractIgdbKeywords(raw),
    sourceId: String(raw.id),
    developers: extractCompanies(raw.involved_companies, "developer"),
    publishers: extractCompanies(raw.involved_companies, "publisher"),
    raw,
  };
}

/*
 * ÚNICO punto de soldadura del orquestador: candidate (objetivo IGDB normalizado)
 * + EnrichmentEditable (descripciones y semánticas del enriquecimiento) →
 * IgdbGameToPersist. Las keywords salen SIN TOCAR del candidate (mint del
 * raw): el pipelino no puede mezclar aquí términos de búsqueda ni keywords
 * adicionales del LLM.
 */
export function concludeGameToPersist(
  candidate: Candidate,
  editable: EnrichmentEditable,
): IgdbGameToPersist {
  return {
    provenance: "igdb",
    slug: candidate.slug,
    sourceId: candidate.sourceId,
    title: candidate.title,
    coverUrl: candidate.coverUrl,
    releaseYear: candidate.releaseYear,
    genres: candidate.genres,
    themes: candidate.themes,
    platforms: candidate.platforms,
    gameModes: candidate.gameModes,
    perspectives: candidate.perspectives,
    developers: candidate.developers,
    publishers: candidate.publishers,
    keywords: candidate.keywords,
    ...editable.semantic,
    description_es: editable.description_es,
    description_en: editable.description_en,
  };
}