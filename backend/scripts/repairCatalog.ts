/*
 * SCRIPT TEMPORAL de reparación del catálogo: resincroniza los campos
 * propiedad de IGDB de las fichas con source_id, usando IGDB como fuente de
 * verdad. Dry-run por defecto; `--apply` escribe.
 *
 *  - Identidad SIEMPRE por source_id (nunca búsqueda por título).
 *  - Reutiliza mapToCandidate (mappers), extractIgdbKeywords (keywords) y las
 *    transformaciones existentes. No duplica lógica.
 *  - All-or-nothing por juego: si IGDB no devuelve el juego completo o sus
 *    ratings, se hace skip y NO se escribe nada de ese juego.
 *  - keywords se escriben como [...extractIgdbKeywords(raw)] (mint sellado):
 *    excepción puntual y limitada a este script temporal.
 *  - Un único UPDATE por juego con todos los campos a resincronizar.
 *  - Idempotente: re-ejecutar tras apply produce 0 cambios.
 *
 * NO modifica: slug, source_id, description_es/en, semánticas, search_count,
 * updated_at.
 *
 * Uso: npm run repair:catalog          → dry-run (solo reporte)
 *      npm run repair:catalog -- --apply → escribe
 */
import "./env.js";
import { prisma } from "../src/lib/prisma.js";
import { createIgdbClient } from "../src/igdb/index.js";
import { mapToCandidate } from "../src/igdb/mappers.js";
import { extractIgdbKeywords } from "../src/igdb/keywords.js";
import type { IgdbGameRaw } from "../src/igdb/types.js";

const APPLY = process.argv.includes("--apply");
const CHUNK = 100;

const FIELDS_TO_REPAIR = [
  "title",
  "cover_url",
  "release_year",
  "developers",
  "publishers",
  "genres",
  "platforms",
  "game_modes",
  "perspectives",
  "themes",
  "keywords",
  "total_rating_count",
  "total_rating",
] as const;

type Repairable = (typeof FIELDS_TO_REPAIR)[number];

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function fmt(value: unknown): string {
  return JSON.stringify(value);
}

async function main(): Promise<void> {
  const igdb = createIgdbClient();

  const rows = await prisma.games.findMany({
    where: { source_id: { not: null } },
  });
  console.log(
    `# Reparación de catálogo (${APPLY ? "**APPLY**" : "dry-run"}): ${rows.length} fichas con source_id`,
  );

  let withChanges = 0;
  let unchanged = 0;
  let skipped = 0;
  let errors = 0;
  let applied = 0;

  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    const ids = chunk
      .map((row) => Number(row.source_id))
      .filter((id) => Number.isFinite(id));

    let fullRaws: IgdbGameRaw[];
    let ratingRaws: IgdbGameRaw[];
    try {
      [fullRaws, ratingRaws] = await Promise.all([
        igdb.fetchFullGamesByIds(ids),
        igdb.fetchGamesByIds(ids),
      ]);
    } catch (error) {
      for (const row of chunk) {
        skipped++;
        console.log(
          `  - ${row.slug} (source_id=${row.source_id}): error de fetch de IGDB: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      continue;
    }

    const fullById = new Map(fullRaws.map((raw) => [String(raw.id), raw]));
    const ratingById = new Map(ratingRaws.map((raw) => [String(raw.id), raw]));

    for (const row of chunk) {
      try {
        const sourceId = row.source_id!;
        const full = fullById.get(sourceId);
        const rating = ratingById.get(sourceId);
        if (!full || !rating) {
          skipped++;
          console.log(
            `  - ${row.slug} (source_id=${sourceId}): IGDB no devolvió ${!full ? "el juego" : "los ratings"} — skip, sin escribir`,
          );
          continue;
        }

        const candidate = mapToCandidate(full);
        const target = {
          title: candidate.title,
          cover_url: candidate.coverUrl,
          release_year: candidate.releaseYear,
          developers: candidate.developers,
          publishers: candidate.publishers,
          genres: candidate.genres,
          platforms: candidate.platforms,
          game_modes: candidate.gameModes,
          perspectives: candidate.perspectives,
          themes: candidate.themes,
          keywords: [...extractIgdbKeywords(full)],
          total_rating_count: rating.total_rating_count ?? null,
          total_rating: rating.total_rating ?? null,
        } satisfies Record<Repairable, unknown>;

        const before = {
          title: row.title,
          cover_url: row.cover_url,
          release_year: row.release_year,
          developers: row.developers,
          publishers: row.publishers,
          genres: row.genres,
          platforms: row.platforms,
          game_modes: row.game_modes,
          perspectives: row.perspectives,
          themes: row.themes,
          keywords: row.keywords,
          total_rating_count: row.total_rating_count,
          total_rating: row.total_rating,
        } satisfies Record<Repairable, unknown>;

        const diffs = FIELDS_TO_REPAIR.filter(
          (field) => !same(before[field], target[field]),
        );

        if (diffs.length === 0) {
          unchanged++;
          continue;
        }

        withChanges++;
        console.log(`\n${row.slug} (source_id=${sourceId})`);
        for (const field of diffs) {
          console.log(`  ${field}: ${fmt(before[field])} → ${fmt(target[field])}`);
        }

        if (APPLY) {
          await prisma.games.update({
            where: { id: row.id },
            data: target,
          });
          applied++;
        }
      } catch (error) {
        errors++;
        console.log(
          `  ! ${row.slug} (source_id=${row.source_id}): error al reparar: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  console.log("\n# Resumen");
  console.log(
    `  - fichas: ${rows.length} · con cambios: ${withChanges} · sin cambios: ${unchanged} · skip: ${skipped} · errores: ${errors}`,
  );
  if (APPLY) console.log(`  - aplicados: ${applied}`);
  console.log(
    APPLY
      ? "# Reparación APLICADA (los valores quedaron resincronizados con IGDB)."
      : "# DRY-RUN: no se escribió nada. Revisa los cambios antes de --apply.",
  );

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("# ERROR crítico:", error);
    await prisma.$disconnect();
    process.exit(1);
  });