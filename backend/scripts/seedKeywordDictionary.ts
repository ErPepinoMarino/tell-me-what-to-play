/*
 * Seed del diccionario completo de keywords (política conservadora): TODAS
 * las keywords de la taxonomía pública de IGDB (≈7.400), con sus embeddings.
 *
 * El diccionario es CERRADO: no crece por demanda. Lo que no matchee
 * (literal/stem/embedding) se DROP en canonicalizeTerms. Este script es la
 * única vía de poblar el léxico (más un refresh periódico a voluntad).
 *
 * Uso: npm run lexicon:seed  (IGDB + OPENAI configurados)
 */
import "./env.js";
import { prisma } from "../src/lib/prisma.js";
import { createIgdbClient } from "../src/igdb/index.js";
import { createKeywordEmbedder } from "../src/lib/embeddings.js";

const BATCH = 100;

async function main(): Promise<void> {
  const igdb = createIgdbClient();
  const embedder = createKeywordEmbedder();

  console.log("# Cargando TODAS las keywords de IGDB...");
  const keywords = await igdb.fetchAllKeywords();
  console.log(`# ${keywords.length} keywords en la taxonomía de IGDB`);

  // El diccionario es IGDB puro: se purgan las entradas que no son de IGDB
  // (las "hot" del antiguo crecimiento por demanda) antes de sembrar.
  const purged = await prisma.keyword_lexicon.deleteMany({
    where: { OR: [{ source: "hot" }, { igdb_id: null }] },
  });
  console.log(`# Purged ${purged.count} entradas no-IGDB`);

  for (let offset = 0; offset < keywords.length; offset += BATCH) {
    const batch = keywords.slice(offset, offset + BATCH);
    const vectors = await embedder.embed(batch.map((k) => k.name.toLowerCase()));

for (let i = 0; i < batch.length; i++) {
      const keyword = batch[i];
      await prisma.keyword_lexicon.upsert({
        where: { canonical: keyword.name.toLowerCase() },
        create: {
          canonical: keyword.name.toLowerCase(),
          aliases: [],
          embedding: vectors[i],
          source: "igdb",
          frequency: 0,
          igdb_slug: keyword.slug,
          igdb_id: keyword.id,
        },
        update: {
          // No pisamos aliases/frecuencia; refrescamos la referencia IGDB.
          igdb_slug: keyword.slug,
          igdb_id: keyword.id,
        },
      });
    }
    console.log(`  ${Math.min(offset + BATCH, keywords.length)}/${keywords.length}`);
  }

  const total = await prisma.keyword_lexicon.count();
  const resolved = await prisma.keyword_lexicon.count({ where: { igdb_id: { not: null } } });
  console.log(
    `# Diccionario listo: ${total} entradas, ${resolved} con referencia IGDB.`,
  );
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("# ERROR: seed del diccionario falló:", error);
  await prisma.$disconnect();
  process.exit(1);
});