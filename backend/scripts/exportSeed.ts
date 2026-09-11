/*
 * Exporta de vuelta a games_seed.json las fichas del seed:
 * mantiene la forma del fixture (mismas claves y orden) y refresca en sitio
 * los campos rehabilitados desde IGDB + enrichment
 * (identidad, clasificaciones, portada, año, semánticas, descripciones).
 *
 * SOLO exporta fichas con provenance === "curated": las filas que en PG ya
 * son "igdb" (p. ej. tras una sincronización de catálogo) se conservan sin
 * cambios en el seed, porque sus keywords son vocabulario IGDB y no deben
 * colarse en el seed curado.
 *
 * Uso: npm run seed:export   (desde backend/, tras npm run enrich:backfill)
 */
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prismaGameRepository } from "../src/repositories/prismaGameRepository.js";
import type { Game } from "../src/types/Game.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.resolve(__dirname, "../src/data/games_seed.json");

const original = JSON.parse(fs.readFileSync(seedPath, "utf8")) as Record<
  string,
  unknown
>[];

let updated = 0;

for (const entry of original) {
  const slug = entry.slug as string;
  const game: Game | undefined = await prismaGameRepository.getBySlug(slug);
  if (!game) {
    console.log(`# ? ${slug}: no está en PG (sin cambios)`);
    continue;
  }
  // El archivo del seed es CURADO. Si la fila de PG ya es "igdb" (p. ej.
  // tras una sincronización de catálogo), NO se refresca: sus keywords son
  // vocabulario IGDB y no deben colarse en el seed curado.
  if (game.provenance !== "curated") {
    console.log(`# - ${slug}: fila IGDB en PG (se conserva el seed curado)`);
    continue;
  }

  const refreshed: Record<string, unknown> = {
    ...entry,
    sourceId: game.sourceId,
    title: game.title,
    description_es: game.description_es === "" ? null : game.description_es,
    description_en: game.description_en === "" ? null : game.description_en,
    coverUrl: game.coverUrl === "" ? null : game.coverUrl,
    releaseYear: game.releaseYear === 0 ? null : game.releaseYear,
    genres: game.genres,
    platforms: game.platforms,
    gameModes: game.gameModes,
    perspectives: game.perspectives,
    developers: game.developers,
    publishers: game.publishers,
    keywords: game.keywords,
    difficulty: game.difficulty,
    pace: game.pace,
    narrative: game.narrative,
    complexity: game.complexity,
    strategy: game.strategy,
    exploration: game.exploration,
    violence: game.violence,
    horror: game.horror,
    darkness: game.darkness,
    tension: game.tension,
    humor: game.humor,
    isolation: game.isolation,
    coziness: game.coziness,
  };

  const changed = JSON.stringify(entry) !== JSON.stringify(refreshed);
  if (changed) updated++;
  Object.assign(entry, refreshed);
}

fs.writeFileSync(seedPath, JSON.stringify(original, null, 2) + "\n");
console.log(
  `# games_seed.json regenerado: ${original.length} fichas (${updated} con cambios).`,
);
process.exit(0);
