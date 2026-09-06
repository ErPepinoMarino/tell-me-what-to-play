import type { Game } from "../types/Game.js";
import type { GameSearchIntent } from "../types/GameSearchIntent.js";
import { GENRE_QUERY_TERMS } from "../services/enrichmentService.js";
import { passesHardFilters } from "../matching/matchGame.js";
import type { RecommendationConfig } from "../recommendation/constants.js";
import type { CacheLayer, CatalogLayer } from "./types.js";

// Señales objetivas del intent para el pre-filtro SQL. Con el contrato de
// filtros duros, TODO lo pedido debe estar: el pre-filtro es conjuntivo
// (AND). Las keywords se normalizan a minúsculas porque así viven en la
// BDD; UNKNOWN no filtra.
export interface PoolFilter {
  genres: string[];
  themes: string[];
  keywords: string[];
  platforms: string[];
  releaseYear: number | null;
  yearFrom: number | null;
  yearTo: number | null;
}

export function buildPoolFilter(intent: GameSearchIntent): PoolFilter {
  return {
    genres: (intent.objective?.genres ?? []).filter((g) => g !== "UNKNOWN"),
    themes: (intent.objective?.themes ?? []).filter((t) => t !== "UNKNOWN"),
    platforms: (intent.objective?.platforms ?? []).filter(
      (p) => p !== "UNKNOWN",
    ),
    keywords: (intent.keywords ?? [])
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length > 0),
    releaseYear: intent.releaseYear,
    yearFrom: intent.yearFrom,
    yearTo: intent.yearTo,
  };
}

// Queries de descubrimiento para IGDB, ordenadas por prioridad. Cada unidad
// de descubrimiento consume una variante; así el relleno no repite la misma
// búsqueda cuando ya no rinde.
export function buildQueryVariants(intent: GameSearchIntent): string[] {
  const keywords = (intent.keywords ?? [])
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);
  const genreTerms = (intent.objective?.genres ?? [])
    .filter((g) => g !== "UNKNOWN" && g in GENRE_QUERY_TERMS)
    .map((g) => GENRE_QUERY_TERMS[g as keyof typeof GENRE_QUERY_TERMS]);

  const variants: string[] = [];
  if (keywords.length > 0) {
    if (keywords.length === 1 && genreTerms.length > 0) {
      /*
       * Con una sola keyword la combinada colapsa en la keyword sola:
       * la variante con género (más productiva: acota el tema) va primero.
       */
      variants.push(`${keywords[0]} ${genreTerms[0]}`);
      variants.push(keywords[0]);
    } else {
      variants.push(keywords.slice(0, 3).join(" "));
      if (genreTerms.length > 0) {
        variants.push(`${keywords[0]} ${genreTerms[0]}`);
      }
      if (keywords.length > 3) {
        variants.push(keywords.slice(3, 6).join(" "));
      }
      /*
       * Rescate por keyword individual: IGDB busca por título y una query
       * combinada suele devolver 0 aunque cada término por separado rinda
       * (p. ej. "batman pixel art" → 0, "pixel art" → decenas). Van al final:
       * primero se agotan las variantes más específicas.
       */
      variants.push(...keywords);
    }
  } else if (genreTerms.length > 0) {
    variants.push(genreTerms.slice(0, 2).join(" "));
  }
  /*
   * Intents solo-plataforma/año (sin keywords ni géneros) generan [] aquí;
   * el descubrimiento por atributos (filteredSearch IGDB) los cubre en el
   * orquestador. El text-search de IGDB busca por título y no sirve para
   * estos intents.
   */

  return [
    ...new Set(variants.map((v) => v.trim()).filter((v) => v.length > 0)),
  ];
}

// Dedup por slug conservando el primer appearance (PG va primero: autoridad).
export function dedupeBySlug(games: Game[]): Game[] {
  const bySlug = new Map<string, Game>();
  for (const game of games) {
    if (!bySlug.has(game.slug)) bySlug.set(game.slug, game);
  }
  return [...bySlug.values()];
}

/*
 * Pool de candidatos de las capas locales: pre-filtro SQL (canónico) +
 * JSON cache resuelta contra PG por slug. Entradas de cache sin ficha en
 * PG son proyección obsoleta y se descartan (identidad incoherente).
 */
export async function gatherCandidates(
  cache: CacheLayer,
  catalog: CatalogLayer,
  intent: GameSearchIntent,
  config: RecommendationConfig,
): Promise<Game[]> {
  const filter = buildPoolFilter(intent);

  const [pgGames, cacheGames] = await Promise.all([
    catalog.findCandidates({ ...filter, limit: config.matchPoolCap }),
    cache.getAll(),
  ]);

  const pgBySlug = new Set(pgGames.map((g) => g.slug));
  const cacheOnlySlugs = [
    ...new Set(
      cacheGames.map((g) => g.slug).filter((slug) => !pgBySlug.has(slug)),
    ),
  ];
  const canonicalized = await catalog.getBySlugs(cacheOnlySlugs);

  const pool = dedupeBySlug([...pgGames, ...canonicalized.values()]);
  /*
   * La cache es proyección y el pre-filtro SQL solo aplica a PG: sin este
   * filtro, un intent con must estricto llenaría el pool de condenados
   * (p. ej. el pre-filtro SQL devuelve 0 y entran TODAS las de cache).
   * El filtro duro es puro y barato: se aplica a TODO el pool.
   */
  const filtered = pool.filter((game) => passesHardFilters(intent, game));
  return filtered.slice(0, config.matchPoolCap);
}

// Resolución de ancla por título: catálogo primero, cache como atajo.
// Se prefiere coincidencia exacta de título; el resultado siempre queda
// canonicalizado a la identidad de PG.
export async function findAnchorByTitle(
  title: string,
  cache: CacheLayer,
  catalog: CatalogLayer,
): Promise<Game | undefined> {
  const normalized = title.trim().toLowerCase();
  if (normalized.length === 0) return undefined;

  const fromCatalog = await catalog.searchByTitle(title);
  const exact = fromCatalog.find(
    (game) => game.title.toLowerCase() === normalized,
  );
  const fromPg = exact ?? fromCatalog[0];
  if (fromPg) return fromPg;

  const fromCache = (await cache.searchByTitle(title))[0];
  if (!fromCache) return undefined;

  return catalog.getBySlug(fromCache.slug);
}
