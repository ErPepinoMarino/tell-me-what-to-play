/*
 * Backfill de calidad del catálogo: rehabilita fichas incompletas.
 *
 * Criterio de selección: fichas sin source_id (p. ej. las del seed,
 * inenriquecibles por diseño hasta ahora) o con menos de
 * RECOMMENDATION_REENRICH_MIN_KNOWN_SEMANTICS semánticas conocidas.
 *
 * Por cada ficha: IGDB search por título (match por sourceId, slug o título
 * normalizado) → si la ficha no tenía identidad se ADOPTAN los datos
 * objetivos canónicos de IGDB (source_id, clasificaciones, portada, año) →
 * Brave + LLM para semánticas y keywords (conservando las conocidas).
 *
 * Uso: npm run enrich:backfill   (desde backend/, con IGDB/Brave/OpenAI
 * configuradas y PG accesible). Respeta el presupuesto diario.
 */
import "./env.js";
import {
  DiscoveryManager,
  knownSemanticsCount,
} from "../src/orchestrator/discovery.js";
import { prismaCatalogLayer } from "../src/orchestrator/adapters.js";
import { prismaGameRepository } from "../src/repositories/prismaGameRepository.js";
import { createIgdbClient } from "../src/igdb/index.js";
import { createEnrichmentService } from "../src/services/enrichmentService.js";
import { InMemoryBudgetLedger } from "../src/budget/budgetLedger.js";
import {
  RECOMMENDATION_CONFIG,
} from "../src/recommendation/constants.js";
import { prisma } from "../src/lib/prisma.js";
import { InMemoryDiscoveryCacheRepository } from "../src/orchestrator/discoveryCache.js";
import { InMemoryQueryOffsetStore } from "../src/orchestrator/queryOffsetStore.js";

async function main(): Promise<void> {
  const missingCredentials: string[] = [];
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
    missingCredentials.push("TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET");
  }
  if (!process.env.BRAVE_SEARCH_API_KEY) {
    missingCredentials.push("BRAVE_SEARCH_API_KEY");
  }
  if (!process.env.OPENAI_API_KEY) {
    missingCredentials.push("OPENAI_API_KEY");
  }
  if (missingCredentials.length > 0) {
    console.error(
      `# ERROR: faltan credenciales para el backfill: ${missingCredentials.join(", ")}`,
    );
    process.exit(1);
  }

  const igdb = createIgdbClient();
  const enrichment = createEnrichmentService();
  const budget = new InMemoryBudgetLedger({
    igdb: RECOMMENDATION_CONFIG.igdbDailyLimit,
    brave: RECOMMENDATION_CONFIG.braveDailyLimit,
    llm: RECOMMENDATION_CONFIG.llmDailyLimit,
  });
  const discovery = new DiscoveryManager(
    igdb,
    enrichment,
    prismaCatalogLayer,
    new InMemoryDiscoveryCacheRepository(),
    new InMemoryQueryOffsetStore(),
    budget,
    RECOMMENDATION_CONFIG,
  );

  const all = await prismaGameRepository.getAll();

  // Filtro opcional por slug (p.ej. `npm run enrich:backfill -- --slug=elden-ring-2022`):
  // permite rehabilitar fichas concretas sin gastar presupuesto en el resto.
  const slugArg = process.argv
    .find((arg) => arg.startsWith("--slug="))
    ?.split("=")[1];

  const targets = all.filter(
    (game) =>
      (slugArg === undefined || game.slug === slugArg) &&
      (game.sourceId === null ||
        knownSemanticsCount(game) <
          RECOMMENDATION_CONFIG.reEnrichMinKnownSemantics ||
        (game.developers.length === 0 && game.publishers.length === 0)),
  );

  console.log(
    `# Backfill: ${targets.length} de ${all.length} fichas necesitan rehabilitación`,
  );

  let updated = 0;
  let notFound = 0;
  let failed = 0;

  for (const game of targets) {
    const result = await discovery.reEnrich(game);
    switch (result.status) {
      case "updated":
        updated++;
        console.log(
          `# ✓ ${game.slug} (${knownSemanticsCount(result.game)} semánticas conocidas)`,
        );
        break;
      case "not-found":
        notFound++;
        console.log(`# ? ${game.slug}: sin match en IGDB`);
        break;
      case "budget-exhausted":
        console.error("# ERROR: presupuesto diario agotado; se detiene.");
        process.exit(1);
        break;
      case "skipped":
        console.log(`# - ${game.slug}: sin updater disponible`);
        break;
      case "error":
      default:
        failed++;
        console.log(`# ✗ ${game.slug}: error de enrichment`);
        break;
    }
  }

  console.log(
    `# Backfill completado: ${updated} actualizadas, ${notFound} sin match, ${failed} errores.`,
  );
  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("# ERROR: backfill falló:", error);
    process.exit(1);
  });
