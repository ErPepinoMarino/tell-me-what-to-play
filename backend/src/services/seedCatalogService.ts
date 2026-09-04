import { games } from "../data/games.js";
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
    // create() usa solo los campos de persistencia: id y searchCount los
    // pone PostgreSQL (serial / default 0).
    await catalog.create(game);
    created++;
  }

  return { created, skipped };
}
