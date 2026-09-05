/*
 * Backfill de THEMES de IGDB para las fichas del catálogo (source_id = id
 * IGDB). Los themes son capa MUST del matcher (junto a géneros/plataformas);
 * las fichas previas al campo no los tienen.
 *
 * Uso: npm run backfill:themes  (IGDB configurado; 1 llamada por cada 500 ids)
 */
import "./env.js";
import { prisma } from "../src/lib/prisma.js";
import { prismaGameRepository } from "../src/repositories/prismaGameRepository.js";
import { createIgdbClient } from "../src/igdb/index.js";
import { normalizeThemes } from "../src/igdb/normalizers.js";
import type { Theme } from "../src/generated/prisma/enums.js";

const CHUNK = 500;

async function main(): Promise<void> {
  const igdb = createIgdbClient();
  const all = await prismaGameRepository.getAll();
  const discovered = all.filter((game) => game.sourceId !== null);

  console.log(`# Themes backfill: ${discovered.length} fichas descubiertas`);

  let updated = 0;
  let missing = 0;

  for (let offset = 0; offset < discovered.length; offset += CHUNK) {
    const chunk = discovered.slice(offset, offset + CHUNK);
    const igdbIds = chunk
      .map((game) => Number(game.sourceId))
      .filter((id) => Number.isFinite(id));

    const raws = await igdb.fetchThemesByGameIds(igdbIds);
    const byIgdbId = new Map(raws.map((raw) => [String(raw.id), raw]));

    for (const game of chunk) {
      const raw = byIgdbId.get(game.sourceId ?? "");
      if (!raw) {
        missing++;
        continue;
      }
      const themes = normalizeThemes(
        raw.themes?.map((theme) => theme.name),
      );
      const values: Theme[] =
        themes.values.length > 0 ? themes.values : ["UNKNOWN"];
      await prisma.games.update({
        where: { id: game.id },
        data: { themes: values },
      });
      updated++;
    }
  }

  const withThemes = await prisma.games.count({
    where: { NOT: { themes: { equals: ["UNKNOWN"] } } },
  });
  console.log(
    `# Themes: ${updated} actualizadas, ${missing} sin match en IGDB. ` +
      `Fichas con themes conocidos: ${withThemes}.`,
  );
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("# ERROR: backfill de themes falló:", error);
  await prisma.$disconnect();
  process.exit(1);
});