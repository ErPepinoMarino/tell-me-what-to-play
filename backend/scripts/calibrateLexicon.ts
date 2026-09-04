/*
 * FASE 2 del roadmap del léxico: CALIBRACIÓN del umbral de asimilación.
 * (.opencode/plans/roadmap-lexico-embeddings.md)
 *
 * Embeds los pares dorados con text-embedding-3-small y verifica que el
 * umbral separa "mismo concepto" (≥ umbral) de "concepto distinto" (< umbral).
 * Incluye el caso que motivó la supervisión: awarded ≠ nominee (los embeddings
 * los fusionaron erróneamente a 0.87; el umbral debe RECHAZARLOS).
 *
 * Uso: npm run lexicon:calibrate   (requiere OPENAI_API_KEY)
 * Exit 1 si algún par sale del lado equivocado.
 */
import "./env.js";
import { createKeywordEmbedder } from "../src/lib/embeddings.js";
import { cosineSimilarity } from "../src/services/keywordLexiconService.js";

const THRESHOLD = 0.58;

/*
 * Calibración empírica (text-embedding-3-small, términos sueltos):
 *  - Sinónimos conceptuales reales ("undead"/"zombies") puntúan 0.61-0.77.
 *  - Variantes ortográficas ("cozy"/"cosy", "open world"/"open-world") 0.83-0.95.
 *  - Conceptos distintos: ≤ 0.44 (incluido awarded/nominee, el caso que
 *    motivó la supervisión).
 * Banda válida: (0.44, 0.61] → 0.58.
 *
 * EXCEPCIÓN DOCUMENTADA — pares cross-lingual ("infectados"/"zombies" ≈ 0.35):
 * NO asimilan por embedding y ES CORRECTO: la traducción español→inglés es
 * responsabilidad del PROMPT del intent (normaliza a inglés canónico antes
 * de tocar el léxico), no del léxico. Separación de responsabilidades.
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
