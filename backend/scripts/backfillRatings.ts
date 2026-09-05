/*
 * Backfill de la señal de calidad de IGDB (total_rating_count / total_rating)
 * para las fichas ya descubiertas (source_id presente). Alimenta el criterio
 * objetivo de purga del catálogo: rating_count < 3 = la misma barra que el
 * gate de descubrimiento (minIgdbRatingCount).
 *
 * Uso: npm run ratings:backfill   (IGDB configurado; 1 llamada por cada 100 ids)
 */
import "./env.js";
import { prisma } from "../src/lib/prisma.js";
import { prismaGameRepository } from "../src/repositories/prismaGameRepository.js";
import { createIgdbClient } from "../src/igdb/index.js";

const CHUNK = 100;

async function main(): Promise<void> {
  const igdb = createIgdbClient();
  const all = await prismaGameRepository.getAll();
  const discovered = all.filter((game) => game.sourceId !== null);

  console.log(
    `# Ratings backfill: ${discovered.length} fichas descubiertas de ${all.length}`,
  );

  let updated = 0;
  let missing = 0;

  for (let offset = 0; offset < discovered.length; offset += CHUNK) {
    const chunk = discovered.slice(offset, offset + CHUNK);
    const igdbIds = chunk
      .map((game) => Number(game.sourceId))
      .filter((id) => Number.isFinite(id));

    const raws = await igdb.fetchGamesByIds(igdbIds);
    const byIgdbId = new Map(raws.map((raw) => [String(raw.id), raw]));

    for (const game of chunk) {
      const raw = byIgdbId.get(game.sourceId ?? "");
      if (!raw) {
        missing++;
        continue;
      }
      await prisma.games.update({
        where: { id: game.id },
        data: {
          total_rating_count: raw.total_rating_count ?? null,
          total_rating: raw.total_rating ?? null,
        },
      });
      updated++;
    }
  }

  const belowGate = await prisma.games.count({
    where: { total_rating_count: { lt: 3 } },
  });
  console.log(
    `# Ratings: ${updated} actualizadas, ${missing} sin match en IGDB. ` +
      `Por debajo del gate (rating_count < 3): ${belowGate}.`,
  );
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("# ERROR: ratings backfill falló:", error);
  await prisma.$disconnect();
  process.exit(1);
});
