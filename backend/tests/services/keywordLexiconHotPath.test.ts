import { describe, expect, it, vi } from "vitest";
import {
  createKeywordLexiconService,
  type LexiconRow,
} from "../../src/services/keywordLexiconService.js";
import type { BudgetLedger } from "../../src/budget/budgetLedger.js";
import type { GameSearchIntent } from "../../src/types/GameSearchIntent.js";

/*
 * Embedder falso: 0° = familia zombies, 60° = coches, 120° = estrategia.
 * Lanza si se activa el modo fallo (para probar el fallback degradado).
 */
function fakeEmbedder(angles: Record<string, number>, fail = false) {
  return {
    embed: async (terms: string[]) => {
      if (fail) throw new Error("embedding service down");
      return terms.map((term) => {
        const angle = angles[term];
        if (angle === undefined) {
          throw new Error(`no vector for ${term}`);
        }
        return [Math.cos(angle), Math.sin(angle)];
      });
    },
  };
}

const LEXICON_ROWS: LexiconRow[] = [
  {
    canonical: "zombies",
    aliases: ["undead", "infected"],
    embedding: [1, 0],
  },
  {
    canonical: "cars",
    aliases: [],
    embedding: [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)],
  },
];

const loader = async (): Promise<LexiconRow[]> => LEXICON_ROWS;

function makeBudget(remaining: number): BudgetLedger {
  return {
    remaining: (service) => (service === "embedding" ? remaining : 999),
    tryReserve: (service, cost) => (service === "embedding" ? remaining >= cost : true),
    commit: () => {},
    release: () => {},
  };
}

describe("KeywordLexiconService.canonicalize", () => {
  it("literal: el canónico se queda tal cual sin gastar embeddings", async () => {
    const embedder = fakeEmbedder({ zombies: 0 });
    const embed = vi.spyOn(embedder, "embed");
    const service = createKeywordLexiconService({ loader, embedder, budget: makeBudget(10) });

    const result = await service.canonicalize(["zombies"]);

    expect(result).toEqual([
      { term: "zombies", canonical: "zombies", method: "literal" },
    ]);
    expect(embed).not.toHaveBeenCalled();
  });

  it("stem: un alias asimila gratis ('infected' → 'zombies')", async () => {
    const service = createKeywordLexiconService({
      loader,
      embedder: fakeEmbedder({}),
      budget: makeBudget(10),
    });

    const result = await service.canonicalize(["infected"]);

    expect(result).toEqual([
      { term: "infected", canonical: "zombies", method: "stem", similarity: 1 },
    ]);
  });

  it("embedding: un término NO alias con vector próximo asimila ('zombis' → 'zombies')", async () => {
    const service = createKeywordLexiconService({
      loader,
      embedder: fakeEmbedder({ zombis: 0.15 }),
      budget: makeBudget(10),
    });

    const result = await service.canonicalize(["zombis"]);

    expect(result).toEqual([
      {
        term: "zombis",
        canonical: "zombies",
        method: "embedding",
        similarity: expect.any(Number),
        topMatch: "zombies",
      },
    ]);
    expect(result[0].similarity).toBeGreaterThan(0.58);
  });

  it("dropped: concepto sin similitud suficiente (180°) se ignora (conservador)", async () => {
    const service = createKeywordLexiconService({
      loader,
      embedder: fakeEmbedder({ painting: Math.PI }),
      budget: makeBudget(10),
    });

    const result = await service.canonicalize(["painting"]);

    expect(result).toEqual([
      {
        term: "painting",
        canonical: "painting",
        method: "dropped",
        similarity: expect.any(Number),
        topMatch: "cars",
      },
    ]);
    expect(service.drainDropped()).toEqual([
      { term: "painting", topMatch: "cars", similarity: expect.any(Number) },
    ]);
  });

  it("fallback: si el embedder falla, literal+stem siguen funcionando", async () => {
    const service = createKeywordLexiconService({
      loader,
      embedder: fakeEmbedder({}, true),
      budget: makeBudget(10),
    });

    const result = await service.canonicalize(["infected", "painting"]);

    expect(result.map((item) => item.canonical)).toEqual(["zombies", "painting"]);
    expect(result.every((item) => item.method !== "embedding")).toBe(true);
  });

  it("fallback: sin presupuesto de embedding degrada a literal+stem", async () => {
    const service = createKeywordLexiconService({
      loader,
      embedder: fakeEmbedder({}),
      budget: makeBudget(0),
    });

    const result = await service.canonicalize(["painting"]);

    expect(result[0].method).toBe("unmapped");
  });
});

describe("KeywordLexiconService.canonicalizeIntent", () => {
  it("canonicaliza keywords y red flags preservando el resto del intent", async () => {
    const service = createKeywordLexiconService({
      loader,
      embedder: fakeEmbedder({}),
      budget: makeBudget(10),
    });

    const intent: GameSearchIntent = {
      gameReferenced: null,
      objective: null,
      keywords: ["infected"],
      releaseYear: null,
      yearFrom: null,
      yearTo: null,
      relation: null,
      excluded: {
        keywords: ["undead"],
        genres: null,
        themes: null,
        platforms: null,
        gameModes: null,
        perspectives: null,
        releaseYear: null,
        yearFrom: null,
        yearTo: null,
      },
      semantic: null,
    };

    const result = await service.canonicalizeIntent(intent);

    // "infected" stem-matches el alias del canónico "zombies"
    expect(result.keywords).toEqual(["zombies"]);
    expect(result.excluded?.keywords).toEqual(["zombies"]);
    expect(result).toEqual({ ...intent, keywords: ["zombies"], excluded: { ...intent.excluded, keywords: ["zombies"] } });
  });

  it("canonicalizeIntent DROP los conceptos desconocidos (política conservadora)", async () => {
    const service = createKeywordLexiconService({
      loader,
      embedder: fakeEmbedder({ gardening: Math.PI }),
      budget: makeBudget(10),
    });

    const intent: GameSearchIntent = {
      gameReferenced: null,
      objective: null,
      keywords: ["gardening"],
      releaseYear: null,
      yearFrom: null,
      yearTo: null,
      excluded: null,
      relation: null,
      semantic: null,
    };

    const result = await service.canonicalizeIntent(intent);

    // "gardening" no se parece a nada del diccionario → se ignora: no
    // participa del filtro y NO se persiste (el diccionario es cerrado).
    expect(result.keywords).toEqual([]);
    expect(service.drainDropped().map((d) => d.term)).toEqual(["gardening"]);
  });

  it("canonicalizeIntent asimila los similares y DROP los irrelevantes", async () => {
    const service = createKeywordLexiconService({
      loader,
      embedder: fakeEmbedder({ zombies: 0, undead: 0.3, and: Math.PI }),
      budget: makeBudget(10),
    });

    // "undead" es alias del léxico (embedding) y "and" es irrelevante.
    const intent: GameSearchIntent = {
      gameReferenced: null,
      objective: null,
      keywords: ["undead", "and"],
      releaseYear: null,
      yearFrom: null,
      yearTo: null,
      excluded: null,
      relation: null,
      semantic: null,
    };

    const result = await service.canonicalizeIntent(intent);

    expect(result.keywords).toEqual(["zombies"]);
    expect(service.drainDropped().map((d) => d.term)).toEqual(["and"]);
  });

  it("es idempotente: canonicalizar dos veces no cambia nada", async () => {
    const service = createKeywordLexiconService({
      loader,
      embedder: fakeEmbedder({}),
      budget: makeBudget(10),
    });

    const intent: GameSearchIntent = {
      gameReferenced: null,
      objective: null,
      keywords: ["zombies"],
      releaseYear: null,
      yearFrom: null,
      yearTo: null,
      excluded: null,
      relation: null,
      semantic: null,
    };

    const once = await service.canonicalizeIntent(intent);
    const twice = await service.canonicalizeIntent(once);

    expect(twice).toEqual(once);
  });
});
