import { describe, expect, it } from "vitest";
import { keywordStem } from "../../../src/matching/keywords.js";
import { matchGame } from "../../../src/matching/matchGame.js";
import { makeGame, makeIntent } from "./fixtures.js";

describe("keywordStem", () => {
  it("reduce plurales regulares a minúsculas", () => {
    expect(keywordStem("Zombies")).toBe("zombie");
    expect(keywordStem("pirates")).toBe("pirate");
    expect(keywordStem("movies")).toBe("movie");
    expect(keywordStem("  Cozy ")).toBe("cozy");
  });

  it("no recorta palabras cortas ni terminadas en ss", () => {
    expect(keywordStem("sea")).toBe("sea");
    expect(keywordStem("boss")).toBe("boss");
    expect(keywordStem("cozy")).toBe("cozy");
  });
});

describe("matchGame: matching parcial de keywords", () => {
  it("casa singular/plural entre intent y juego", () => {
    const intent = makeIntent({ keywords: ["zombie"] });
    const game = makeGame({ id: 1, slug: "undead", keywords: ["Zombies"] });

    const result = matchGame({ intent, game });

    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kw.zombie", note: "keyword-match" }),
      ]),
    );
  });

  it("no inventa matches por prefijo ('sea' no casa con 'season') → must-violated", () => {
    const intent = makeIntent({ keywords: ["sea"] });
    const game = makeGame({ id: 2, slug: "seasons", keywords: ["season"] });

    const result = matchGame({ intent, game });

    expect(result.tier).toBe("invalid");
    expect(result.gatesViolated).toContain("must-violated");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          block: "keywords",
          field: "kw.sea",
          note: "must-violated",
        }),
      ]),
    );
  });
});
