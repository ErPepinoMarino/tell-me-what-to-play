/*
 * FASE 1 del roadmap del léxico: MINADO del diccionario canónico.
 * (.opencode/plans/roadmap-lexico-embeddings.md)
 *
 * Agrega las keywords de todas las fichas del catálogo con frecuencias y
 * ejecuta la asimilación greedy (talo gratis, embeddings text-embedding-3-small
 * para el resto). NO escribe en la tabla keyword_lexicon: produce un DRAFT +
 * informe para SUPERVISIÓN del usuario. Tras revisar/editar el draft:
 *   npm run lexicon:accept   → importa el draft aprobado a la tabla.
 *
 * Uso: npm run lexicon:mine
 * Env: LEXICON_MIN_FREQUENCY (default 4), LEXICON_SIMILARITY_THRESHOLD (default 0.82)
 */
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prismaGameRepository } from "../src/repositories/prismaGameRepository.js";
import {
  assimilateGreedily,
  type AssimilationOptions,
  type AssimilationResult,
  type LexiconCandidate,
} from "../src/services/keywordLexiconService.js";
import { createKeywordEmbedder } from "../src/lib/embeddings.js";
import { KEYWORD_STOPWORDS } from "../src/matching/keywords.js";
import {
  KEYWORD_FRAGMENTS,
  LEXICON_SIMILARITY_THRESHOLD,
  TECH_NOISE,
} from "../src/services/keywordLexiconService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.resolve(__dirname, "../reports");

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function floatFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

/*
 * Política de supervisión (FASE 1, decisiones del usuario):
 *
 * 1. STOPWORDS y FRAGMENTOS: "and", "hack", "slash", "wash", "age"… nunca
 *    entran al diccionario (los stopwords también se filtran en el siembra).
 * 2. RUIDO TECH/PLATAFORMA: keywords de IGDB que son metadatos de plataforma
 *    o distribución, no conceptos temáticos de juego → fuera del diccionario.
 * 3. PREMIOS GENÉRICOS: nada de "the game awards - <categoría> - <resultado>":
 *    se generalizan a DOS conceptos canónicos, "awarded" (ganador) y
 *    "nominee" (nominado), preservando la distinción winner ≠ nominee que
 *    los embeddings fusionaron erróneamente (0.87).
 */
// Fragmentos y ruido tech: definiciones compartidas en keywordLexiconService.
const FRAGMENT_EXCLUSIONS = KEYWORD_FRAGMENTS;

const AWARD_PATTERN = /game awards/i;

async function applySupervisionPolicy(
  result: AssimilationResult,
  embedder: { embed(terms: string[]): Promise<number[][]> },
): Promise<void> {
  // 1) Fuera ruido tech (canónicos completos; sus aliases se descartan con ellos)
  result.entries = result.entries.filter((entry) => {
    if (TECH_NOISE.has(entry.canonical)) return false;
    entry.aliases = entry.aliases.filter((alias) => !TECH_NOISE.has(alias.term));
    return true;
  });

  // 2) Premios: recoger los específicos y generalizarlos
  const winnerTerms: string[] = [];
  const nomineeTerms: string[] = [];
  result.entries = result.entries.filter((entry) => {
    if (!AWARD_PATTERN.test(entry.canonical)) return true;
    const absorbed = [entry.canonical, ...entry.aliases.map((a) => a.term)];
    for (const term of absorbed) {
      if (/winner/i.test(term)) winnerTerms.push(term);
      else if (/nominee/i.test(term)) nomineeTerms.push(term);
    }
    return false;
  });

  const curated: { canonical: string; terms: string[] }[] = [];
  if (winnerTerms.length > 0) curated.push({ canonical: "awarded", terms: winnerTerms });
  if (nomineeTerms.length > 0) curated.push({ canonical: "nominee", terms: nomineeTerms });

  if (curated.length > 0) {
    const vectors = await embedder.embed(curated.map((c) => c.canonical));
    curated.forEach((curatedEntry, index) => {
      result.entries.push({
        canonical: curatedEntry.canonical,
        frequency: curatedEntry.terms.length,
        aliases: curatedEntry.terms.map((term) => ({
          term,
          canonical: curatedEntry.canonical,
          method: "embedding" as const,
          similarity: 1,
        })),
        embedding: vectors[index],
        source: "curated",
      });
    });
  }
}

async function main(): Promise<void> {
  const options: AssimilationOptions = {
    minFrequency: intFromEnv("LEXICON_MIN_FREQUENCY", 3),
    threshold: floatFromEnv("LEXICON_SIMILARITY_THRESHOLD", LEXICON_SIMILARITY_THRESHOLD),
  };

  const all = await prismaGameRepository.getAll();
  const frequencies = new Map<string, number>();
  for (const game of all) {
    for (const keyword of game.keywords) {
      const normalized = keyword.trim().toLowerCase();
      if (normalized.length === 0) continue;
      if (KEYWORD_STOPWORDS.has(normalized)) continue;
      if (FRAGMENT_EXCLUSIONS.has(normalized)) continue;
      frequencies.set(normalized, (frequencies.get(normalized) ?? 0) + 1);
    }
  }

  const candidates: LexiconCandidate[] = [...frequencies.entries()]
    .map(([term, frequency]) => ({ term, frequency }))
    .sort((a, b) => b.frequency - a.frequency || (a.term < b.term ? -1 : 1));

  console.log(
    `# Léxico: ${all.length} fichas, ${frequencies.size} keywords distintas, ` +
      `minFrequency=${options.minFrequency}, threshold=${options.threshold}`,
  );

  const embedder = createKeywordEmbedder();
  const result = await assimilateGreedily(candidates, embedder, options);
  await applySupervisionPolicy(result, embedder);

  // --- Draft JSON (con embeddings: entrada de lexicon:accept) ---
  const draft = {
    generatedAt: new Date().toISOString(),
    model: "text-embedding-3-small",
    options,
    stats: result.stats,
    entries: result.entries,
    rejected: result.rejected,
  };
  fs.mkdirSync(reportsDir, { recursive: true });
  const draftPath = path.join(reportsDir, "lexicon-draft.json");
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));

  // --- Informe legible para supervisión ---
  const lines: string[] = [];
  lines.push(`# Informe de minado del léxico`);
  lines.push("");
  lines.push(`- Generado: ${draft.generatedAt}`);
  lines.push(`- Modelo: ${draft.model}`);
  lines.push(
    `- Config: minFrequency=${options.minFrequency}, threshold=${options.threshold}`,
  );
  lines.push(
    `- Fichas analizadas: ${all.length} · keywords distintas: ${frequencies.size}`,
  );
  lines.push(
    `- Resultado: **${result.stats.canonicals} canónicos**, ` +
      `${result.stats.aliasesStem} aliases por talo, ` +
      `${result.stats.aliasesEmbedding} aliases por embedding, ` +
      `${result.stats.rejected} descartadas por frecuencia.`,
  );
  lines.push("");
  lines.push(`## Diccionario propuesto (${result.entries.length} entradas)`);
  lines.push("");
  for (const entry of result.entries) {
    lines.push(
      `- **${entry.canonical}** (freq ${entry.frequency})` +
        (entry.aliases.length > 0
          ? ` ← ${entry.aliases
              .map(
                (alias) =>
                  `"${alias.term}" (${alias.method}${
                    alias.method === "embedding"
                      ? ` ${alias.similarity}`
                      : ""
                  })`,
              )
              .join(", ")}`
          : ""),
    );
  }
  lines.push("");
  lines.push(
    `## Descartadas por frecuencia < ${options.minFrequency} (${result.rejected.filter((r) => r.reason === "frequency").length})`,
  );
  lines.push("");
  const rejectedByFrequency = result.rejected.filter(
    (r) => r.reason === "frequency",
  );
  for (const item of rejectedByFrequency.slice(0, 60)) {
    lines.push(`- ${item.term} (freq ${item.frequency})`);
  }
  if (rejectedByFrequency.length > 60) {
    lines.push(`- … y ${rejectedByFrequency.length - 60} más (ver draft JSON)`);
  }
  lines.push("");
  lines.push(
    `> Supervisión: edita \`reports/lexicon-draft.json\` si quieres renombrar ` +
      `canónicos, separar fusiones o quitar aliases; después ejecuta ` +
      `\`npm run lexicon:accept\`.`,
  );
  const reportPath = path.join(reportsDir, "lexicon-mine-report.md");
  fs.writeFileSync(reportPath, lines.join("\n") + "\n");

  console.log(`# Draft: ${draftPath}`);
  console.log(`# Informe: ${reportPath}`);
  console.log(
    `# Stats: ${JSON.stringify(result.stats)}`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("# ERROR: minado del léxico falló:", error);
  process.exit(1);
});
