import { describe, expect, it } from "vitest";
import { matchGame } from "../../../src/matching/matchGame.js";
import { rankMatches } from "../../../src/matching/rankMatches.js";
import {
  FIXTURES,
  makeGame,
  makeIntent,
  type ReasonExpectation,
} from "./fixtures.js";
import type { MatchResult } from "../../../src/matching/types.js";

function hasReason(result: MatchResult, expectation: ReasonExpectation): boolean {
  return result.reasons.some(
    (reason) =>
      (expectation.block === undefined || reason.block === expectation.block) &&
      (expectation.field === undefined || reason.field === expectation.field) &&
      (expectation.kind === undefined || reason.kind === expectation.kind) &&
      (expectation.note === undefined || reason.note === expectation.note),
  );
}

describe("matchGame — golden fixtures", () => {
  for (const fixture of FIXTURES) {
    const result = matchGame({
      intent: fixture.intent,
      game: fixture.game,
      anchors: fixture.anchors,
    });

    it(`${fixture.name} → tier ${fixture.expect.tier}`, () => {
      expect(result.tier).toBe(fixture.expect.tier);
    });

    it(`${fixture.name} → gates`, () => {
      expect(result.gatesViolated).toEqual(fixture.expect.gatesViolated ?? []);
    });

    it(`${fixture.name} → score`, () => {
      if (fixture.expect.scoreRange) {
        const [min, max] = fixture.expect.scoreRange;
        expect(result.score).toBeGreaterThanOrEqual(min);
        expect(result.score).toBeLessThanOrEqual(max);
      }
    });

    it(`${fixture.name} → coverage`, () => {
      if (fixture.expect.coverage) {
        expect(result.coverage).toMatchObject(fixture.expect.coverage);
      }
    });

    it(`${fixture.name} → razones`, () => {
      for (const expectation of fixture.expect.mustHaveReasons ?? []) {
        expect(hasReason(result, expectation)).toBe(true);
      }
      for (const expectation of fixture.expect.mustNotHaveReasons ?? []) {
        expect(hasReason(result, expectation)).toBe(false);
      }
    });
  }
});

describe("rankMatches — orden determinista y exclusiones", () => {
  it("N2 empates → slug asc; scores distintos → score desc", () => {
    const intent = makeIntent({ keywords: ["cozy"] });
    const games = [
      makeGame({ id: 1, slug: "b-game", keywords: ["cozy"] }),
      makeGame({ id: 2, slug: "a-game", keywords: ["cozy"] }),
      makeGame({ id: 3, slug: "c-game", keywords: ["other"] }),
    ];

    const { ranked } = rankMatches(intent, games);

    expect(ranked.map((match) => match.game.slug)).toEqual([
      "a-game",
      "b-game",
      "c-game",
    ]);
  });

  it("N3 exclusiones: mostrados, anclas y duplicados, con motivo auditable", () => {
    const anchor = makeGame({ id: 100, slug: "gta-v", keywords: ["crime"] });
    const intent = makeIntent({
      gameReferenced: ["GTA V"],
      keywords: ["crime"],
    });
    const games = [
      anchor,
      makeGame({ id: 7, slug: "shown", keywords: ["crime"] }),
      makeGame({ id: 1, slug: "dup", keywords: ["crime"] }),
      makeGame({ id: 2, slug: "dup", keywords: ["crime"] }),
      makeGame({ id: 3, slug: "fresh", keywords: ["crime"] }),
    ];

    const { ranked, excluded } = rankMatches(intent, games, {
      anchors: [anchor],
      excludeGameIds: [7],
    });

    // La primera aparición del duplicado se conserva; slug asc al empatar.
    expect(ranked.map((match) => match.game.slug)).toEqual(["dup", "fresh"]);
    expect(excluded).toEqual([
      { gameId: 100, slug: "gta-v", reason: "referenced-anchor" },
      { gameId: 7, slug: "shown", reason: "already-shown" },
      { gameId: 2, slug: "dup", reason: "duplicate-input" },
    ]);
  });

  it("N3b excludeReferenced=false → el ancla se rankEA con nota is-anchor", () => {
    const anchor = makeGame({ id: 100, slug: "gta-v", keywords: ["crime"] });
    const intent = makeIntent({
      gameReferenced: ["GTA V"],
      keywords: ["crime"],
    });

    const { ranked, excluded } = rankMatches(intent, [anchor], {
      anchors: [anchor],
      excludeReferenced: false,
    });

    expect(excluded).toEqual([]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].reasons.some((reason) => reason.note === "is-anchor")).toBe(
      true,
    );
  });
});
