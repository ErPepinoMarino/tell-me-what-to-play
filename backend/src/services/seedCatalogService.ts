import { games, toCuratedKeywords } from "../data/games.js";
import type { CatalogLayer } from "../orchestrator/types.js";

export interface SeedCatalogResult {
  created: number;
  skipped: number;
}

/*
 * Bootstrap del catálogo popular: garantiza que las fichas del seed
 * (src/data/games.ts — los juegos más populares, cache fría versionada)
 * existan en PostgreSQL.
 *
 * Idempotente y conservador: si la ficha ya existe en PG se salta — NUNCA
 * se sobreescribe una ficha enriquecida de la BDD con los datos (posibles-
 * mente pobres) del seed. Para actualizar fichas existentes están el
 * re-enrichment orgánico y `npm run enrich:backfill`.
 *
 * Pensado para el arranque del backend (server.ts, best-effort: si PG no
 * responde, el server arranca igual y las rutas degradan como siempre) y
 * para el CLI `npm run seed:catalog`. Funciona igual en compose que en
 * Railway: no depende de servicios one-shot.
 */
export async function ensureSeedCatalog(
  catalog: CatalogLayer,
): Promise<SeedCatalogResult> {
  let created = 0;
  let skipped = 0;

  for (const game of games) {
    const existing = await catalog.getBySlug(game.slug);
    if (existing) {
      skipped++;
      continue;
    }
    // createCurated() usa solo los campos de persistencia: id y searchCount los
    // pone PostgreSQL (serial / default 0). El vocabulario del seed es
    // CU-RADO: cruza la frontera por el mint curado toCuratedKeywords, jamás
    // por un mint de IgdbKeyword — un dato del seed no puede fingir que
    // procede de IGDB (CuratedKeyword[] no es asignable a IgdbKeyword[]).
    await catalog.createCurated({
      ...game,
      provenance: "curated",
      keywords: toCuratedKeywords(game.keywords),
    });
    created++;
  }

  return { created, skipped };
}
