import { describe, expect, it } from "vitest";
import {
  extractIgdbKeywords,
  brandStoredIgdbKeywords,
} from "../../src/igdb/keywords.js";
import * as keywordModule from "../../src/igdb/keywords.js";
import * as mappers from "../../src/igdb/mappers.js";
import { mapToCandidate, concludeGameToPersist } from "../../src/igdb/mappers.js";
import { mintSearchKeywords } from "../../src/matching/keywords.js";
import { toCuratedKeywords } from "../../src/data/games.js";
import type { IgdbGameRaw } from "../../src/igdb/types.js";
import type { IgdbGameToPersist } from "../../src/types/Game.js";
import type {
  CuratedKeyword,
  IgdbKeyword,
  SearchKeyword,
} from "../../src/types/keywords.js";
import type { Semantic } from "../../src/types/GameEnrichment.js";

function makeRaw(overrides: Partial<IgdbGameRaw> = {}): IgdbGameRaw {
  return {
    id: 527,
    name: "Mortal Kombat 11",
    cover: { image_id: "mk11_cover" },
    genres: [{ id: 4, name: "Fighting" }],
    themes: [{ id: 1, name: "Action" }],
    platforms: [{ id: 6, name: "PC" }],
    game_modes: [{ id: 1, name: "Single player" }],
    keywords: [
      { id: 1, name: "violence" },
      { id: 2, name: "character customization" },
      { id: 3, name: "time manipulation" },
      { id: 4, name: "gore" },
    ],
    ...overrides,
  };
}

const nullSemantic: Semantic = {
  complexity: null,
  coziness: null,
  darkness: null,
  difficulty: null,
  exploration: null,
  horror: null,
  humor: null,
  isolation: null,
  narrative: null,
  pace: null,
  strategy: null,
  tension: null,
  violence: null,
};

/*
 * Invariante estructural: Game.keywords de un juego IGDB === raw.keywords.
 * La frontera de tipos garantiza que un string[] plano, un SearchKeyword[] o
 * un CuratedKeyword[] NO pueden vivir en las keywords de un IgdbGameToPersist.
 * El mint IgdbKeyword está sellado: solo extractIgdbKeywords(raw) y el
 * re-marcado de lectura brandStoredIgdbKeywords lo producen.
 */
describe("Frontera de marca IgdbKeyword", () => {
  it("extractIgdbKeywords preserva EXACTAMENTE raw.keywords (orden, duplicados, caso)", () => {
    const raw = makeRaw({
      keywords: [
        { id: 1, name: "Violence" },
        { id: 2, name: "time manipulation" },
        { id: 3, name: "Violence" },
      ],
    });

    const keywords = extractIgdbKeywords(raw);

    expect([...keywords]).toEqual(["Violence", "time manipulation", "Violence"]);
    expect(Object.isFrozen(keywords)).toBe(true);
  });

  it("unclassified de géneros/plataformas/modos/perspectivas NO entra en keywords", () => {
    const raw = makeRaw({
      genres: [{ id: 99, name: "Unmapped Genre" }],
      platforms: [{ id: 49, name: "Sega Saturn" }],
      game_modes: [{ id: 99, name: "Unmapped Mode" }],
      player_perspectives: [{ id: 99, name: "Unmapped Perspective" }],
    });

    const candidate = mapToCandidate(raw);

    expect([...candidate.keywords]).toEqual(["violence", "character customization", "time manipulation", "gore"]);
  });

  it("mapToCandidate y concludeGameToPersist nunca amplían el vocabulario del raw", () => {
    const raw = makeRaw();
    const candidate = mapToCandidate(raw);
    const viaConclude = concludeGameToPersist(candidate, {
      description_es: "",
      description_en: "",
      semantic: nullSemantic,
    });

    expect([...viaConclude.keywords]).toEqual([...candidate.keywords]);
  });

  it("compile-time: una string suelta NO es asignable a IgdbKeyword", () => {
    const value: string = "violence";
    // @ts-expect-error string != IgdbKeyword (marca nominal)
    const bad: IgdbKeyword = value;
    void bad;
  });

  it("compile-time: string[] plano NO es asignable a IgdbGameToPersist keywords", () => {
    // @ts-expect-error la query/LLM solo cruza la frontera por los mints sellados
    const bad: IgdbGameToPersist["keywords"] = [] as string[];
    void bad;
  });

  it("compile-time: SearchKeyword[] NO es asignable a IgdbGameToPersist keywords", () => {
    const hints: readonly SearchKeyword[] = mintSearchKeywords(["trucks"]);
    // @ts-expect-error el vocabulario de búsqueda jamás vive en Game.keywords
    const bad: IgdbGameToPersist["keywords"] = hints;
    void bad;
  });

  it("compile-time: CuratedKeyword[] NO es asignable a IgdbGameToPersist keywords", () => {
    const curated: readonly CuratedKeyword[] = toCuratedKeywords(["curated"]);
    // @ts-expect-error un dato curado no puede fingir procedencia IGDB
    const bad: IgdbGameToPersist["keywords"] = curated;
    void bad;
  });

  it("superficie sellada: no existe mint público string[] -> IgdbKeyword[]", () => {
    // Si alguien reintroduce un puente tipo toIgdbKeywords(string[]), este
    // test falla: el módulo igdb solo expone los dos mints legítimos y los
    // mappers no exponen ninguno.
    const keywordsSurface = Object.keys(keywordModule).sort();
    expect(keywordsSurface).toEqual([
      "brandStoredIgdbKeywords",
      "extractIgdbKeywords",
    ]);
    expect(mappers).not.toHaveProperty("toIgdbKeywords");
    expect(typeof extractIgdbKeywords).toBe("function");
    expect(typeof brandStoredIgdbKeywords).toBe("function");
  });
});