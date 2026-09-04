import { describe, expect, it } from "vitest";
import {
  assimilateGreedily,
  cosineSimilarity,
  type Embedder,
  type LexiconCandidate,
} from "../../src/services/keywordLexiconService.js";

/*
 * Embedder falso DETERMINISTA: asigna un ángulo fijo por "familia" de
 * conceptos (ángulo 0° = zombies, 60° = coches, 120° = estrategia) con
 * jitter mínimo por término desconocido. Así los tests controlan qué
 * asimila y qué entra nueva sin llamar a OpenAI.
 */
function fakeEmbedder(angles: Record<string, number>): Embedder {
  return {
    embed: async (terms: string[]) =>
      terms.map((term) => {
        const angle = angles[term];
        if (angle !== undefined) {
          return [Math.cos(angle), Math.sin(angle)];
        }
        // Término sin ángulo asignado: vector desconocido estable (hash simple)
        const hash = [...term].reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const unknown = (hash % 360) * (Math.PI / 180);
        return [Math.cos(unknown), Math.sin(unknown)];
      }),
  };
}

const ZOMBIES = 0;
const CARS = Math.PI / 3; // 60° → cos ≈ 0.5 respecto a zombies
const STRATEGY = (2 * Math.PI) / 3; // 120° → cos ≈ -0.5

describe("cosineSimilarity", () => {
  it("vector consigo mismo = 1; ortogonales = 0; opuestos = -1", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});

describe("assimilateGreedily", () => {
  const options = { minFrequency: 4, threshold: 0.82 };

  it("el término más frecuente es canónico; el literal/talo asimila gratis", async () => {
    const candidates: LexiconCandidate[] = [
      { term: "zombies", frequency: 12 },
      { term: "zombie", frequency: 6 },
      { term: "Zombies", frequency: 5 },
    ];

    const result = await assimilateGreedily(candidates, fakeEmbedder({ zombies: ZOMBIES, zombie: ZOMBIES, "Zombies": ZOMBIES }), options);

    expect(result.stats.canonicals).toBe(1);
    expect(result.entries[0].canonical).toBe("zombies");
    expect(result.entries[0].aliases).toHaveLength(2);
    expect(result.entries[0].aliases.every((alias) => alias.method === "stem")).toBe(true);
  });

  it("un término conceptualmente próximo asimila por embedding con su similitud", async () => {
    const candidates: LexiconCandidate[] = [
      { term: "zombies", frequency: 10 },
      { term: "undead", frequency: 5 },
    ];
    // "undead" a 20° de "zombies": cos ≈ 0.94 ≥ 0.82 → alias
    const result = await assimilateGreedily(
      candidates,
      fakeEmbedder({ zombies: ZOMBIES, undead: ZOMBIES + 0.35 }),
      options,
    );

    expect(result.stats.canonicals).toBe(1);
    expect(result.entries[0].canonical).toBe("zombies");
    expect(result.entries[0].aliases).toHaveLength(1);
    const alias = result.entries[0].aliases[0];
    expect(alias.method).toBe("embedding");
    expect(alias.similarity).toBeGreaterThanOrEqual(0.82);
  });

  it("un término suficientemente distinto entra NUEVO aunque haya canónicos", async () => {
    const candidates: LexiconCandidate[] = [
      { term: "zombies", frequency: 10 },
      { term: "cars", frequency: 8 },
      { term: "strategy", frequency: 6 },
    ];

    const result = await assimilateGreedily(
      candidates,
      fakeEmbedder({ zombies: ZOMBIES, cars: CARS, strategy: STRATEGY }),
      options,
    );

    expect(result.stats.canonicals).toBe(3);
    expect(result.entries.map((entry) => entry.canonical)).toEqual([
      "zombies",
      "cars",
      "strategy",
    ]);
    expect(result.entries.every((entry) => entry.aliases.length === 0)).toBe(true);
  });

  it("respeta el orden por frecuencia: el más frecuente fija el canónico", async () => {
    const candidates: LexiconCandidate[] = [
      { term: "undead", frequency: 9 },
      { term: "zombies", frequency: 5 },
    ];

    const result = await assimilateGreedily(
      candidates,
      fakeEmbedder({ zombies: ZOMBIES, undead: ZOMBIES + 0.35 }),
      options,
    );

    // "undead" llegó primero y es el canónico; "zombies" es su alias
    expect(result.entries[0].canonical).toBe("undead");
    expect(result.entries[0].aliases[0].term).toBe("zombies");
  });

  it("rechaza por frecuencia y por longitud, y son deterministas", async () => {
    const candidates: LexiconCandidate[] = [
      { term: "zombies", frequency: 10 },
      { term: "cars", frequency: 3 },
      { term: "ab", frequency: 9 },
    ];

    const result = await assimilateGreedily(candidates, fakeEmbedder({ zombies: ZOMBIES, cars: CARS, ab: CARS }), options);

    expect(result.entries).toHaveLength(1);
    expect(result.rejected).toEqual([
      { term: "cars", frequency: 3, reason: "frequency" },
      { term: "ab", frequency: 9, reason: "too-short" },
    ]);

    const again = await assimilateGreedily(candidates, fakeEmbedder({ zombies: ZOMBIES, cars: CARS, ab: CARS }), options);
    expect(again).toEqual(result);
  });

  it("respetando el umbral: similitud 0.5 (60°) NO asimila aunque sea la familia más cercana", async () => {
    const candidates: LexiconCandidate[] = [
      { term: "zombies", frequency: 10 },
      { term: "cars", frequency: 5 },
    ];

    const result = await assimilateGreedily(
      candidates,
      fakeEmbedder({ zombies: ZOMBIES, cars: CARS }),
      options,
    );

    expect(result.stats.canonicals).toBe(2);
  });
});
