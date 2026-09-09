import { describe, expect, it } from "vitest";
import { hardFilterViolations } from "../../../src/matching/matchGame.js";
import {
  makeGame,
  makeIntent,
  FULL_SEMANTIC,
} from "../../helpers/fakes.js";

describe("hardFilterViolations", () => {
  it("lista los must fallados con su campo (caso RDR2: keyword ausente)", () => {
    const intent = makeIntent({
      keywords: ["cowboys"],
      objective: {
        genres: ["ADVENTURE"],
        themes: ["OPEN_WORLD", "ACTION"],
        platforms: null,
        gameModes: ["SINGLE_PLAYER"],
        perspectives: null,
      },
    });
    const game = makeGame({
      id: 1,
      genres: ["ADVENTURE"],
      themes: ["OPEN_WORLD", "ACTION"],
      platforms: ["PC"],
      gameModes: ["SINGLE_PLAYER"],
      perspectives: ["THIRD_PERSON"],
      keywords: ["horses"],
      ...FULL_SEMANTIC,
    });

    const { must, redFlags } = hardFilterViolations(intent, game);

    expect(must).toEqual(["kw.cowboys"]);
    expect(redFlags).toEqual([]);
  });

  it("lista los red flags sin mezclarlos con los must", () => {
    const intent = makeIntent({
      keywords: ["pirates"],
      excluded: {
        keywords: ["lego"],
        genres: null,
        themes: null,
        platforms: null,
        gameModes: null,
        perspectives: null,
        releaseYear: null,
        yearFrom: null,
        yearTo: null,
      },
    });
    const game = makeGame({
      id: 2,
      genres: ["ADVENTURE"],
      keywords: ["pirates", "lego"],
      ...FULL_SEMANTIC,
    });

    const { must, redFlags } = hardFilterViolations(intent, game);

    expect(must).toEqual([]);
    expect(redFlags).toContain("xkw.lego");
  });

  it("vacío cuando todo pasa", () => {
    const intent = makeIntent({ keywords: ["pirates"] });
    const game = makeGame({
      id: 3,
      genres: ["ADVENTURE"],
      keywords: ["pirates"],
      ...FULL_SEMANTIC,
    });

    expect(hardFilterViolations(intent, game)).toEqual({
      must: [],
      redFlags: [],
    });
  });
});
