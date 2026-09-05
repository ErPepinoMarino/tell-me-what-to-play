/*
 * FASE 3 del roadmap del léxico: MIGRACIÓN / RE-APLICACIÓN del vocabulario
 * canónico a las keywords de la BD.
 * (.opencode/plans/roadmap-lexico-embeddings.md)
 *
 * HERRAMIENTA PERMANENTE (no temporal): cualquier cambio del diccionario
 * (nuevos canónicos, alias fusionados tras la supervisión) exige re-aplicar
 * el vocabulario a las fichas para que el matcher literal los vea.
 * Idempotente: re-ejecutar sobre datos ya normalizados produce 0 cambios.
 *
 * Por cada keyword de cada ficha:
 *  1. literal contra canónico → se queda (ya canónica)
 *  2. literal contra alias → se sustituye por el canónico
 *  3. talo (canónico o alias) → se sustituye por el canónico
 *  4. compuesto con "/" → se DIVIDE y cada parte se canonicaliza
 *     (decisión de supervisión: los juegos quedan con ambas mitades)
 *  5. embedding (coseno ≥ LEXICON_MIGRATION_THRESHOLD contra el léxico)
 *     → se sustituye por el canónico más próximo
 *  6. lo no asimilable se CONSERVA y se PROPONE como entrada nueva del
 *     léxico (informe para aprobación; NADA se descarta)
 *
 * Uso:  npm run lexicon:apply                (dry-run: informe sin escribir)
 *       npm run lexicon:apply -- --apply     (reescribe games.keywords)
 * Env:  LEXICON_MIGRATION_THRESHOLD (default 0.70, precision-first:
 *       una fusión errónea corrompe datos; una perdida queda como propuesta).
 */
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/prisma.js";
import { prismaGameRepository } from "../src/repositories/prismaGameRepository.js";
import { keywordStem, KEYWORD_STOPWORDS } from "../src/matching/keywords.js";
import {
  cosineSimilarity,
  KEYWORD_FRAGMENTS,
  TECH_NOISE,
} from "../src/services/keywordLexiconService.js";
import { createKeywordEmbedder } from "../src/lib/embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.resolve(__dirname, "../reports");
const APPLY = process.argv.includes("--apply");

interface LexiconRow {
  canonical: string;
  aliases: string[];
  embedding: unknown;
}

interface Mapping {
  canonicals: string[]; // resultado(s) canónicos (1+, por compuestos)
  kept: string[]; // términos conservados sin mapear (no descartamos)
  method: "literal" | "stem" | "compound" | "embedding" | "unmapped";
  similarity?: number;
}

async function main(): Promise<void> {
  const MIGRATION_THRESHOLD = (() => {
    const raw = process.env.LEXICON_MIGRATION_THRESHOLD;
    const parsed = raw ? Number.parseFloat(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1
      ? parsed
      : 0.70;
  })();

  const lexiconRows = (await prisma.keyword_lexicon.findMany()) as LexiconRow[];
  const canonicalSet = new Set(lexiconRows.map((row) => row.canonical));
  const stemIndex = new Map<string, string>();
  for (const row of lexiconRows) {
    stemIndex.set(keywordStem(row.canonical), row.canonical);
    for (const alias of row.aliases) {
      const stem = keywordStem(alias);
      if (!stemIndex.has(stem)) stemIndex.set(stem, row.canonical);
    }
  }
  const embeddings = lexiconRows.map((row) => ({
    canonical: row.canonical,
    vector: row.embedding as number[],
  }));

  const games = await prismaGameRepository.getAll();

  // ---- Recolección de términos distintos (normalizados) ----
  const distinctTerms = new Set<string>();
  for (const game of games) {
    for (const keyword of game.keywords) {
      const normalized = keyword.trim().toLowerCase();
      if (normalized.length > 0) distinctTerms.add(normalized);
    }
  }

  // ---- Clasificación con embeddings diferidos ----
  const deferred = new Set<string>();
  const partial = new Map<string, Mapping>();

  function classifyLiteralOrStem(term: string): Mapping | null {
    if (canonicalSet.has(term)) {
      return { canonicals: [term], kept: [], method: "literal" };
    }
    const stem = keywordStem(term);
    const stemHit = stemIndex.get(stem);
    if (stemHit) return { canonicals: [stemHit], kept: [], method: "stem" };
    return null;
  }

  for (const term of distinctTerms) {
    const direct = classifyLiteralOrStem(term);
    if (direct) {
      partial.set(term, direct);
      continue;
    }
    if (term.includes("/")) {
      // Compuesto: cada parte se canonicaliza; las partes pueden necesitar
      // embedding → se resuelven en la segunda fase.
      const parts = term
        .split("/")
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.length > 0 && !KEYWORD_STOPWORDS.has(part));
      const canonicals = new Set<string>();
      const kept = new Set<string>();
      for (const part of parts) {
        const partMapping = classifyLiteralOrStem(part);
        if (partMapping) {
          partMapping.canonicals.forEach((canonical) => canonicals.add(canonical));
          partMapping.kept.forEach((keptTerm) => kept.add(keptTerm));
        } else if (KEYWORD_STOPWORDS.has(part)) {
          continue;
        } else {
          deferred.add(part);
          kept.add(part);
        }
      }
      partial.set(term, {
        canonicals: [...canonicals],
        kept: [...kept],
        method: "compound",
      });
      continue;
    }
    deferred.add(term);
    partial.set(term, { canonicals: [], kept: [term], method: "unmapped" });
  }

  // ---- Resolución por embedding (un lote para todo lo pendiente) ----
  const embedder = createKeywordEmbedder();
  const pending = [...deferred];
  const vectors = await embedder.embed(pending);
  const vectorByTerm = new Map(
    pending.map((term, index) => [term, vectors[index]]),
  );

  const proposals: { term: string; frequency: number; embedding: number[] }[] = [];
  const proposalFrequency = new Map<string, number>();
  for (const game of games) {
    for (const keyword of game.keywords) {
      const normalized = keyword.trim().toLowerCase();
      if (deferred.has(normalized)) {
        proposalFrequency.set(
          normalized,
          (proposalFrequency.get(normalized) ?? 0) + 1,
        );
      }
    }
  }

  for (const term of pending) {
    const vector = vectorByTerm.get(term)!;
    let best: { canonical: string; similarity: number } | null = null;
    for (const entry of embeddings) {
      const similarity = cosineSimilarity(vector, entry.vector);
      if (!best || similarity > best.similarity) {
        best = { canonical: entry.canonical, similarity };
      }
    }
    const frequency = proposalFrequency.get(term) ?? 0;
    if (best && best.similarity >= MIGRATION_THRESHOLD) {
      partial.set(term, {
        canonicals: [best.canonical],
        kept: [],
        method: "embedding",
        similarity: Number(best.similarity.toFixed(4)),
      });
    } else {
      // Propuesta de entrada nueva: se conserva en la ficha y va al informe.
      // Nada de stopwords/fragmentos/ruido tech en las propuestas.
      if (
        !KEYWORD_STOPWORDS.has(term) &&
        !KEYWORD_FRAGMENTS.has(term) &&
        !TECH_NOISE.has(term) &&
        !proposals.some((proposal) => proposal.term === term)
      ) {
        proposals.push({ term, frequency, embedding: vector });
      }
    }
  }

  // ---- Resolver los compuestos con sus partes ya resueltas ----
  for (const [term, mapping] of partial) {
    if (mapping.method !== "compound") continue;
    const canonicals = new Set<string>();
    const kept = new Set<string>();
    for (const part of term
      .split("/")
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0)) {
      const partMapping = partial.get(part);
      if (partMapping) {
        partMapping.canonicals.forEach((canonical) => canonicals.add(canonical));
        partMapping.kept.forEach((keptTerm) => kept.add(keptTerm));
      }
    }
    if (canonicals.size > 0 || kept.size > 0) {
      partial.set(term, {
        canonicals: [...canonicals],
        kept: [...kept],
        method: "compound",
      });
    }
  }

  // ---- Aplicación por ficha ----
  let gamesChanged = 0;
  let keywordsReplaced = 0;
  let keywordsSplit = 0;
  const embeddingMappings: {
    term: string;
    canonical: string;
    similarity: number;
  }[] = [];
  const perGame: { slug: string; before: string[]; after: string[] }[] = [];
  const methodCounts: Record<string, number> = {};

  for (const game of games) {
    const after: string[] = [];
    let changed = false;
    for (const keyword of game.keywords) {
      const normalized = keyword.trim().toLowerCase();
      const mapping =
        partial.get(normalized) ??
        ({ canonicals: [], kept: [normalized], method: "unmapped" } as Mapping);
      methodCounts[mapping.method] = (methodCounts[mapping.method] ?? 0) + 1;
      if (mapping.method === "embedding" && mapping.similarity !== undefined) {
        embeddingMappings.push({
          term: normalized,
          canonical: mapping.canonicals[0] ?? "?",
          similarity: mapping.similarity,
        });
      }
      const replacements = [...mapping.canonicals, ...mapping.kept];
      if (replacements.length !== 1 || replacements[0] !== normalized) {
        if (mapping.canonicals.length > 1 || mapping.kept.length > 0) {
          keywordsSplit++;
        } else if (replacements[0] !== normalized) {
          keywordsReplaced++;
        }
        changed = true;
      }
      for (const replacement of replacements) {
        if (!after.includes(replacement)) after.push(replacement);
      }
    }
    if (changed) {
      gamesChanged++;
      perGame.push({ slug: game.slug, before: game.keywords, after });
      if (APPLY) {
        await prismaGameRepository.update({ ...game, keywords: after });
      }
    }
  }

  // ---- Informe ----
  const lines: string[] = [];
  lines.push(`# Informe de re-aplicación del léxico a la BD`);
  lines.push("");
  lines.push(`- Modo: ${APPLY ? "**APLICADO**" : "dry-run (sin escribir)"}`);
  lines.push(`- Umbral embedding (precision-first): ${MIGRATION_THRESHOLD}`);
  lines.push(`- Fichas: ${games.length} · modificadas: ${gamesChanged}`);
  lines.push(
    `- Keywords: ${keywordsReplaced} sustituidas, ${keywordsSplit} divididas/expandidas`,
  );
  lines.push(`- Métodos: ${JSON.stringify(methodCounts)}`);
  lines.push("");
  lines.push(
    `## Fusiones por embedding (${embeddingMappings.length}, ordenadas por similitud)`,
  );
  lines.push("");
  for (const mapping of [...embeddingMappings].sort(
    (a, b) => a.similarity - b.similarity,
  )) {
    lines.push(
      `- "${mapping.term}" → **${mapping.canonical}** (${mapping.similarity})`,
    );
  }
  lines.push("");
  lines.push(`## Cambios por ficha (${perGame.length})`);
  lines.push("");
  for (const change of perGame) {
    lines.push(`### ${change.slug}`);
    lines.push(`- antes:  ${JSON.stringify(change.before)}`);
    lines.push(`- después: ${JSON.stringify(change.after)}`);
  }
  lines.push("");
  lines.push(
    `## Propuestas de entradas nuevas (${proposals.length}) — requieren tu aprobación`,
  );
  lines.push("");
  for (const proposal of [...proposals]
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 80)) {
    lines.push(`- ${proposal.term} (freq ${proposal.frequency})`);
  }
  if (proposals.length > 80) {
    lines.push(`- … y ${proposals.length - 80} más (ver JSON)`);
  }

  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportsDir, "keyword-migration-report.md"),
    lines.join("\n") + "\n",
  );
  fs.writeFileSync(
    path.join(reportsDir, "lexicon-proposals.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), proposals },
      null,
      2,
    ),
  );

  console.log(
    `# Re-aplicación ${APPLY ? "APLICADA" : "(dry-run)"}: ${gamesChanged} fichas modificadas, ` +
      `${keywordsReplaced} keywords sustituidas, ${keywordsSplit} divididas.`,
  );
  console.log(`# Métodos: ${JSON.stringify(methodCounts)}`);
  console.log(`# Propuestas nuevas: ${proposals.length}`);
  console.log(
    `# Informe: ${path.join(reportsDir, "keyword-migration-report.md")}`,
  );

  if (!APPLY) {
    console.log(
      "# Dry-run: re-ejecuta con `npm run lexicon:apply -- --apply` para escribir.",
    );
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("# ERROR: re-aplicación del léxico falló:", error);
  await prisma.$disconnect();
  process.exit(1);
});
