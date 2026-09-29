import { games } from "../data/games.js";
import type { CatalogLayer } from "../orchestrator/types.js";

export interface SeedCatalogResult {
  created: number;
  skipped: number;
}

/*
 * Bootstrap del catálogo popular: garantiza que las fichas del seed
 * (src/data/games.ts) existan en PostgreSQL. Idempotente y conservador: si ya
 * existe se salta, NUNCA se sobreescribe una ficha enriquecida con el seed.
 * Lo usan el arranque del server (best-effort) y `npm run seed:catalog`.
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
    // createIgdb() usa solo los campos de persistencia: id y searchCount los
    // pone PostgreSQL (serial / default 0). El seed es OFFLINE: no puede
    // conocer las keywords de IGDB, así que se crea con keywords vacías
    // (Game.keywords tiene una única semántica: IGDB). La reparación de
    // catálogo (repairCatalog / syncCatalogKeywords) las rellena desde IGDB.
    await catalog.createIgdb({
      ...game,
      keywords: [],
    });
    created++;
  }

  return { created, skipped };
}
