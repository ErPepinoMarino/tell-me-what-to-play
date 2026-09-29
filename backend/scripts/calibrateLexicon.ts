/*
 * FASE 2 léxico: CALIBRACIÓN del umbral de asimilación con pares dorados,
 * embedados con text-embedding-3-small. El umbral debe separar "mismo
 * concepto" (≥) de "concepto distinto" (<), incluido awarded ≠ nominee.
 * Uso: npm run lexicon:calibrate (requiere OPENAI_API_KEY). Exit 1 si un par falla.
 */
import "./env.js";
import { createKeywordEmbedder } from "../src/lib/embeddings.js";
import { cosineSimilarity } from "../src/services/keywordLexiconService.js";

const THRESHOLD = 0.58;

/*
 * Calibración empírica: sinónimos 0.61-0.77, variantes ortográficas 0.83-0.95,
 * conceptos distintos ≤ 0.44 (awarded/nominee). Banda válida (0.44, 0.61] → 0.58.
 * Cross-lingual (infectados/zombies ≈ 0.35) NO asimila a propósito: la
 * traducción ES→EN la resuelve el prompt del intent, no el léxico.
 */

const SAME_CONCEPT: [string, string][] = [
  ["undead", "zombies"],
  ["cozy", "cosy"],
  ["roguelike", "rogue-lite"],
  ["metroidvania", "metroid-vania"],
  ["open world", "open-world"],
  ["hack and slash", "hack-and-slash"],
  ["pixel graphics", "pixel art"],
];

// No asimilan POR DISEÑO: la traducción vive en el prompt del intent.
const CROSS_LINGUAL: [string, string][] = [
  ["infectados", "zombies"],
];

const DIFFERENT_CONCEPT: [string, string][] = [
  ["zombies", "cars"],
  ["cozy", "horror"],
  ["pirate", "racing"],
  ["dragons", "business"],
  ["awarded", "nominee"], // winner ≠ nominee (fusión errónea detectada en FASE 1)
];

async function main(): Promise<void> {
  const embedder = createKeywordEmbedder();

  const terms = [
    ...new Set(
      [...SAME_CONCEPT, ...CROSS_LINGUAL, ...DIFFERENT_CONCEPT].flat(),
    ),
  ];
  const vectors = await embedder.embed(terms);
  const vectorByTerm = new Map(terms.map((term, index) => [term, vectors[index]]));

  const similarity = (a: string, b: string): number =>
    cosineSimilarity(vectorByTerm.get(a)!, vectorByTerm.get(b)!);

  let failures = 0;

  console.log(`# Umbral: ${THRESHOLD}\n`);
  console.log("## Mismo concepto (debe asimilar: similitud ≥ umbral)");
  for (const [a, b] of SAME_CONCEPT) {
    const score = similarity(a, b);
    const pass = score >= THRESHOLD;
    if (!pass) failures++;
    console.log(
      `  ${pass ? "PASS" : "FAIL"}  ${a} ↔ ${b}: ${score.toFixed(4)}`,
    );
  }

  console.log("\n## Cross-lingual (NO asimila por diseño: traduce el prompt)");
  for (const [a, b] of CROSS_LINGUAL) {
    const score = similarity(a, b);
    const pass = score < THRESHOLD;
    if (!pass) failures++;
    console.log(
      `  ${pass ? "PASS" : "FAIL"}  ${a} ↔ ${b}: ${score.toFixed(4)} (esperado < umbral)`,
    );
  }

  console.log("\n## Concepto distinto (debe rechazar: similitud < umbral)");
  for (const [a, b] of DIFFERENT_CONCEPT) {
    const score = similarity(a, b);
    const pass = score < THRESHOLD;
    if (!pass) failures++;
    console.log(
      `  ${pass ? "PASS" : "FAIL"}  ${a} ↔ ${b}: ${score.toFixed(4)}`,
    );
  }

  console.log(
    failures === 0
      ? "\n# CALIBRACIÓN OK: el umbral separa correctamente los pares dorados."
      : `\n# CALIBRACIÓN FALLIDA: ${failures} pares del lado equivocado. Ajusta LEXICON_SIMILARITY_THRESHOLD.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("# ERROR: calibración falló:", error);
  process.exit(1);
});
