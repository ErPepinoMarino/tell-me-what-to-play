/*
 * FASE 1 del roadmap del léxico: ACEPTACIÓN del draft tras la supervisión
 * del usuario. Importa reports/lexicon-draft.json (posiblemente editado a
 * mano: renombrar canónicos, separar fusiones, quitar aliases) a la tabla
 * keyword_lexicon. Idempotente: upsert por canonical.
 *
 * Uso: npm run lexicon:accept
 */
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/prisma.js";
import { createKeywordEmbedder } from "../src/lib/embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const draftPath = path.resolve(__dirname, "../reports/lexicon-draft.json");

interface DraftEntry {
  canonical: string;
  frequency: number;
  aliases: { term: string; canonical: string }[];
  embedding: number[];
  source: string;
}

interface Draft {
  generatedAt: string;
  model: string;
  entries: DraftEntry[];
}

async function main(): Promise<void> {
  if (!fs.existsSync(draftPath)) {
    console.error(
      `# ERROR: no existe ${draftPath}. Ejecuta antes \`npm run lexicon:mine\`.`,
    );
    process.exit(1);
  }

  const draft = JSON.parse(fs.readFileSync(draftPath, "utf8")) as Draft;
  console.log(
    `# Aceptando draft del ${draft.generatedAt}: ${draft.entries.length} entradas`,
  );

  /*
   * El draft es editable a mano. Si el usuario añadió entradas nuevas sin
   * embedding (o les falta), se calculan aquí antes de importar.
   */
  const missingEmbeddings = draft.entries
    .filter((entry) => !Array.isArray(entry.embedding))
    .map((entry) => entry.canonical);
  if (missingEmbeddings.length > 0) {
    console.log(
      `# ${missingEmbeddings.length} entradas sin embedding (añadidas a mano): calculando…`,
    );
    const vectors = await createKeywordEmbedder().embed(missingEmbeddings);
    const vectorByTerm = new Map(missingEmbeddings.map((term, i) => [term, vectors[i]]));
    for (const entry of draft.entries) {
      if (!Array.isArray(entry.embedding)) {
        entry.embedding = vectorByTerm.get(entry.canonical)!;
      }
    }
  }

  const existing = new Set(
    (await prisma.keyword_lexicon.findMany({ select: { canonical: true } })).map(
      (row) => row.canonical,
    ),
  );

  let created = 0;
  let updated = 0;

  for (const entry of draft.entries) {
    const aliases = [...new Set(entry.aliases.map((alias) => alias.term))];
    await prisma.keyword_lexicon.upsert({
      where: { canonical: entry.canonical },
      create: {
        canonical: entry.canonical,
        aliases,
        embedding: entry.embedding,
        source: "mined",
        frequency: entry.frequency,
      },
      update: {
        aliases,
        embedding: entry.embedding,
        frequency: entry.frequency,
      },
    });
    if (existing.has(entry.canonical)) updated++;
    else created++;
  }

  console.log(
    `# Léxico importado: ${created} nuevas, ${updated} actualizadas (${draft.entries.length} total).`,
  );
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("# ERROR: no se pudo aceptar el draft del léxico:", error);
  await prisma.$disconnect();
  process.exit(1);
});
