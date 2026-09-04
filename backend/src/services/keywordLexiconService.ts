import { keywordStem } from "../matching/keywords.js";
import type { BudgetLedger } from "../budget/budgetLedger.js";
import type { GameSearchIntent } from "../types/GameSearchIntent.js";

/*
 * Umbral de asimilación DECIDIDO en la calibración (FASE 2, ver
 * scripts/calibrateLexicon.ts): banda válida (0.44, 0.61] con
 * text-embedding-3-small sobre términos sueltos — los sinónimos conceptuales
 * reales puntúan 0.61-0.77 y los conceptos distintos ≤ 0.44. NOTA: pares
 * cross-lingual ("infectados"/"zombies") NO asimilan por diseño: la
 * traducción es responsabilidad del prompt del intent, no del léxico.
 */
export const LEXICON_SIMILARITY_THRESHOLD = 0.58;

/*
 * Política de supervisión compartida por el minado (FASE 1) y la migración
 * (FASE 3): keywords que NUNCA deben entrar al léxico ni proponerse como
 * entradas nuevas — metadatos de plataforma/distribución, y fragmentos que
 * el antiguo siembra dej colar en el catálogo.
 */
export const TECH_NOISE = new Set([
  "steam",
  "steam achievements",
  "steam cloud",
  "steam families",
  "steam trading cards",
  "steam deck",
  "google stadia",
  "bink video",
  "nintendo switch 2",
  "xbox controller support for pc",
  "handheld electronic lcd",
  "digital distribution",
  "downloadable content",
  "platform exclusive",
  "playstation trophies",
  "playstation network",
  "playstation plus",
  "achievements",
  "super nintendo entertainment system",
  "playstation",
  "playstation 2",
  "playstation 3",
  "playstation 4",
  "playstation 5",
  "playstation vita",
  "psone classics",
  "xbox",
  "xbox 360",
  "xbox one",
  "xbox series",
  "nintendo switch",
  "wii",
  "wii u",
  "gamecube",
  "n64",
  "snes",
  "nes",
  "game boy",
  "game boy advance",
  "nintendo 3ds",
  "ds",
  "psp",
  "ps2",
  "ps3",
  "pc",
  "mac",
  "linux",
  "dos",
  "amiga",
  "web browser",
]);

export const KEYWORD_FRAGMENTS = new Set(["hack", "slash", "wash", "age"]);

/*
 * Léxico de keywords canónicas (ver .opencode/plans/roadmap-lexico-embeddings.md).
 *
 * Algoritmo de asimilación greedy: candidatas ordenadas por frecuencia; una
 * candidata se convierte en ALIAS de un canónico si coincide por talo (gratis)
 * o si su embedding se parece lo bastante (similitud ≥ umbral); si es
 * suficientemente distinta, ENTRA NUEVA. El resultado queda maximalmente
 * distinto por construcción y el matcher no cambia: sigue comparando talos
 * literales sobre el vocabulario canónico resultante.
 */

export interface LexiconCandidate {
  term: string;
  frequency: number;
}

export interface LexiconAlias {
  term: string;
  canonical: string;
  method: "stem" | "embedding";
  similarity: number;
}

export interface LexiconEntry {
  canonical: string;
  frequency: number;
  aliases: LexiconAlias[];
  // Vector del canónico (text-embedding-3-small): 1536 dims.
  embedding: number[];
  source: "mined" | "curated";
}

export interface LexiconRejected {
  term: string;
  frequency: number;
  reason: "frequency" | "too-short";
}

export interface LexiconStats {
  candidates: number;
  canonicals: number;
  aliasesStem: number;
  aliasesEmbedding: number;
  rejected: number;
}

export interface AssimilationResult {
  entries: LexiconEntry[];
  rejected: LexiconRejected[];
  stats: LexiconStats;
}

export interface AssimilationOptions {
  // Frecuencia mínima en el catálogo para ser candidata a canónico.
  minFrequency: number;
  // Similitud de coseno a partir de la cual un término asimila a un canónico.
  threshold: number;
}

// El embedder es inyectable: OpenAI en producción, vectors fijos en tests.
export interface Embedder {
  embed(terms: string[]): Promise<number[][]>;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

interface AcceptedEntry {
  canonical: string;
  stem: string;
  embedding: number[];
  frequency: number;
  aliases: LexiconAlias[];
}

export async function assimilateGreedily(
  candidates: LexiconCandidate[],
  embedder: Embedder,
  options: AssimilationOptions,
): Promise<AssimilationResult> {
  const { minFrequency, threshold } = options;

  const rejected: LexiconRejected[] = [];
  const viable = candidates
    .filter((candidate) => {
      const term = candidate.term.trim().toLowerCase();
      if (term.length < 3) {
        rejected.push({ term: candidate.term, frequency: candidate.frequency, reason: "too-short" });
        return false;
      }
      if (candidate.frequency < minFrequency) {
        rejected.push({ term: candidate.term, frequency: candidate.frequency, reason: "frequency" });
        return false;
      }
      return true;
    })
    // Frecuencia desc, término asc (codepoints): determinismo total.
    .sort(
      (a, b) =>
        b.frequency - a.frequency ||
        (a.term < b.term ? -1 : a.term > b.term ? 1 : 0),
    );

  const accepted: AcceptedEntry[] = [];

  /*
   * Los vectores se calculan en UN lote (independientes por término); las
   * decisiones, en cambio, son secuenciales: cada candidata se compara con
   * los canónicos aceptados hasta ese momento.
   */
  const pendingEmbedding = viable.map((candidate) => candidate.term);

  const vectors = await embedder.embed(pendingEmbedding);
  const vectorByTerm = new Map<string, number[]>();
  pendingEmbedding.forEach((term, index) => {
    vectorByTerm.set(term, vectors[index]);
  });

  /*
   * Segunda pasada: decisiones en el mismo orden. Un término sin talo se
   * compara con TODOS los canónicos aceptados hasta ahora (su embedding ya
   * está en cache); asimila al mejor si supera el umbral, o entra nuevo.
   */
  for (const candidate of viable) {
    const stem = keywordStem(candidate.term);
    const stemHit = accepted.find((entry) => entry.stem === stem);
    if (stemHit) {
      // Alias por talo: gratis, sin decisión de embedding.
      stemHit.aliases.push({
        term: candidate.term,
        canonical: stemHit.canonical,
        method: "stem",
        similarity: 1,
      });
      continue;
    }

    const vector = vectorByTerm.get(candidate.term);
    if (!vector) continue; // no debería ocurrir (todas pasaron por el lote)

    let best: { entry: AcceptedEntry; similarity: number } | null = null;
    for (const entry of accepted) {
      const similarity = cosineSimilarity(vector, entry.embedding);
      if (!best || similarity > best.similarity) {
        best = { entry, similarity };
      }
    }

    if (best && best.similarity >= threshold) {
      best.entry.aliases.push({
        term: candidate.term,
        canonical: best.entry.canonical,
        method: "embedding",
        similarity: Number(best.similarity.toFixed(4)),
      });
      continue;
    }

    accepted.push({
      canonical: candidate.term,
      stem,
      embedding: vector,
      frequency: candidate.frequency,
      aliases: [],
    });
  }

  const entries: LexiconEntry[] = accepted.map((entry) => ({
    canonical: entry.canonical,
    frequency: entry.frequency,
    aliases: entry.aliases,
    embedding: entry.embedding,
    source: "mined",
  }));

  const aliasesStem = entries.reduce(
    (total, entry) =>
      total + entry.aliases.filter((alias) => alias.method === "stem").length,
    0,
  );
  const aliasesEmbedding = entries.reduce(
    (total, entry) =>
      total +
      entry.aliases.filter((alias) => alias.method === "embedding").length,
    0,
  );

  return {
    entries,
    rejected,
    stats: {
      candidates: viable.length,
      canonicals: entries.length,
      aliasesStem,
      aliasesEmbedding,
      rejected: rejected.length,
    },
  };
}

/*
 * ============================================================================
 * Servicio de léxico EN CALIENTE (FASE 4): canonicalización de keywords.
 * ============================================================================
 *
 * Qué hace: traduce términos del usuario/enrichment al VOCABULARIO CANÓNICO
 * del diccionario (tabla keyword_lexicon), por el orden más barato primero:
 *
 *   1. literal   — el término ES un canónico (gratis)
 *   2. stem      — el talo coincide con un canónico o alias (gratis)
 *   3. embedding — coseno contra los vectores del léxico (1 llamada por
 *                  canonicalize(), con cache de términos desconocidos)
 *   4. unmapped  — se conserva el término tal cual (NADA se descarta)
 *
 * Fallback degradado: si el servicio de embeddings falla o el presupuesto
 * "embedding" está seco, canonicalize() sigue funcionando con literal+stem
 * (el producto nunca se bloquea por el enriquecimiento semántico).
 *
 * El MATCHER no cambia: sigue comparando talos literales. Esta clase solo
 * normaliza el DATO antes de que llegue al matcher.
 */
export interface LexiconRow {
  canonical: string;
  aliases: string[];
  embedding: unknown;
}

export interface CanonicalizedTerm {
  term: string;
  canonical: string;
  method: "literal" | "stem" | "embedding" | "unmapped";
  similarity?: number;
}

export interface KeywordLexiconServiceDeps {
  // Carga del diccionario (tabla keyword_lexicon). Inyectable para tests.
  loader: () => Promise<LexiconRow[]>;
  embedder: Embedder;
  // Opcional: sin presupuesto declarado, los embeddings caen al fallback.
  budget?: BudgetLedger;
}

interface LoadedEntry {
  canonical: string;
  stem: string;
  embedding: number[];
}

export class KeywordLexiconService {
  private loaded = false;
  private loading: Promise<void> | null = null;
  private entries: LoadedEntry[] = [];
  private stemIndex = new Map<string, string>();
  // Cache de vectores de términos desconocidos (evita re-embedder).
  private unknownVectors = new Map<string, number[]>();

  constructor(private deps: KeywordLexiconServiceDeps) {}

  async canonicalize(terms: string[]): Promise<CanonicalizedTerm[]> {
    await this.ensureLoaded();

    const normalized = terms.map((term) => term.trim().toLowerCase());
    const result: CanonicalizedTerm[] = [];
    const needsVector: { index: number; term: string }[] = [];

    for (let index = 0; index < normalized.length; index++) {
      const term = normalized[index];
      if (term.length === 0) {
        result.push({ term, canonical: term, method: "unmapped" });
        continue;
      }
      if (this.canonicalTerms.has(term)) {
        result.push({ term, canonical: term, method: "literal" });
        continue;
      }
      const stemHit = this.stemIndex.get(keywordStem(term));
      if (stemHit) {
        result.push({
          term,
          canonical: stemHit,
          method: "stem",
          similarity: 1,
        });
        continue;
      }
      const cached = this.unknownVectors.get(term);
      if (cached) {
        result.push(this.resolveByEmbedding(term, cached));
        continue;
      }
      needsVector.push({ index, term });
      result.push({ term, canonical: term, method: "unmapped" }); // placeholder
    }

    if (needsVector.length > 0 && this.entries.length > 0) {
      // Presupuesto: 1 llamada de embedding por canonicalize con vectores nuevos.
      const budget = this.deps.budget;
      const hasBudget = !budget || budget.tryReserve("embedding", 1);
      if (hasBudget) {
        try {
          const vectors = await this.deps.embedder.embed(
            needsVector.map((item) => item.term),
          );
          budget?.commit("embedding", 1);
          needsVector.forEach((item, position) => {
            const vector = vectors[position];
            this.unknownVectors.set(item.term, vector);
            result[item.index] = this.resolveByEmbedding(item.term, vector);
          });
        } catch {
          // Fallback degradado: sin embeddings, literal+stem ya se aplicaron.
          budget?.release("embedding", 1);
          this.embedderDisabled = true;
        }
      } else {
        this.embedderDisabled = true;
      }
    }

    return result;
  }

  /*
   * Canonicaliza la intención completa (keywords y red flags) antes del
   * matching. Idempotente: los canónicos ya canonicalizados quedan igual
   * (literal), por lo que "more" no gasta nada.
   */
  async canonicalizeIntent(
    intent: GameSearchIntent,
  ): Promise<GameSearchIntent> {
    const keywords = intent.keywords
      ? await this.canonicalizeTerms(intent.keywords)
      : intent.keywords;

    let excluded = intent.excluded;
    if (excluded?.keywords) {
      const canonicalExcluded = await this.canonicalize(excluded.keywords);
      excluded = {
        ...excluded,
        keywords: canonicalExcluded.map((item) => item.canonical),
      };
    }

    return { ...intent, keywords, excluded };
  }

  // Conveniencia: lista de términos → lista canónica (unmapped conserva).
  async canonicalizeTerms(terms: string[]): Promise<string[]> {
    const result = await this.canonicalize(terms);
    return result.map((item) => item.canonical);
  }

  private resolveByEmbedding(term: string, vector: number[]): CanonicalizedTerm {
    let best: { canonical: string; similarity: number } | null = null;
    for (const entry of this.entries) {
      const similarity = cosineSimilarity(vector, entry.embedding);
      if (!best || similarity > best.similarity) {
        best = { canonical: entry.canonical, similarity };
      }
    }
    if (best && best.similarity >= LEXICON_SIMILARITY_THRESHOLD) {
      return {
        term,
        canonical: best.canonical,
        method: "embedding",
        similarity: Number(best.similarity.toFixed(4)),
      };
    }
    return { term, canonical: term, method: "unmapped" };
  }

  private embedderDisabled = false;
  private canonicalTerms = new Set<string>();

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loading ??= (async () => {
      try {
        const rows = await this.deps.loader();
        this.entries = rows
          .filter((row) => Array.isArray(row.embedding))
          .map((row) => ({
            canonical: row.canonical,
            stem: keywordStem(row.canonical),
            embedding: row.embedding as number[],
          }));
        for (const entry of this.entries) {
          this.canonicalTerms.add(entry.canonical);
          this.stemIndex.set(entry.stem, entry.canonical);
        }
        for (const row of rows) {
          for (const alias of row.aliases ?? []) {
            const stem = keywordStem(alias);
            if (!this.stemIndex.has(stem)) {
              this.stemIndex.set(stem, row.canonical);
            }
          }
        }
      } catch (error) {
        // Fallback total: diccionario vacío → todo unmapped (comportamiento
        // previo al léxico). El error queda registrado, no bloquea.
        console.error("[lexicon] no se pudo cargar el diccionario:", error);
      }
      this.loaded = true;
    })();
    await this.loading;
  }
}

export function createKeywordLexiconService(
  deps: KeywordLexiconServiceDeps,
): KeywordLexiconService {
  return new KeywordLexiconService(deps);
}
