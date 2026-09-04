import { describe, expect, it } from "vitest";
import { matchGame } from "../../../src/matching/matchGame.js";
import { rankMatches } from "../../../src/matching/rankMatches.js";
import {
  COV_MIN,
  EPSILON,
  MATCH_WEIGHTS,
  OBJ_SUBWEIGHTS,
  SCORE_MAX,
  SCORE_MIN,
  SEMANTIC_FIELDS,
} from "../../../src/matching/constants.js";
import { FIXTURES, makeGame, makeIntent } from "./fixtures.js";
import type { MatchResult } from "../../../src/matching/types.js";

const clamp = (value: number): number =>
  Math.min(SCORE_MAX, Math.max(SCORE_MIN, value));

function sumContributions(result: MatchResult): number {
  return result.reasons.reduce((sum, reason) => sum + reason.contribution, 0);
}

/*
 * Invariantes I1–I7 verificadas sobre TODOS los golden fixtures.
 * I2 es la propiedad reina: el score es exactamente clamp(Σ contributions),
 * así el score se puede desmontar razón a razón ante cualquiera.
 */
describe("matching invariants", () => {
  for (const fixture of FIXTURES) {
    const result = matchGame({
      intent: fixture.intent,
      game: fixture.game,
      anchors: fixture.anchors,
    });

    it(`I1 score 0..1 — ${fixture.name}`, () => {
      expect(result.score).toBeGreaterThanOrEqual(SCORE_MIN);
      expect(result.score).toBeLessThanOrEqual(SCORE_MAX);
    });

    it(`I2 score = clamp(Σ contributions) — ${fixture.name}`, () => {
      expect(clamp(sumContributions(result))).toBeCloseTo(result.score, 9);
    });

    it(`I4 gates ⇒ invalid — ${fixture.name}`, () => {
      if (result.gatesViolated.length > 0) {
        expect(result.tier).toBe("invalid");
      }
    });

    it(`I5 cobertura limita excellent — ${fixture.name}`, () => {
      const covSem = result.coverage.semanticDims / SEMANTIC_FIELDS.length;
      if (covSem < COV_MIN.excellent) {
        expect(result.tier).not.toBe("excellent");
      }
    });

    it(`I6 determinismo (mismo input → mismo output) — ${fixture.name}`, () => {
      const again = matchGame({
        intent: fixture.intent,
        game: fixture.game,
        anchors: fixture.anchors,
      });
      expect(again).toEqual(result);
    });

    it(`I7 razones ordenadas por |contribution| y field — ${fixture.name}`, () => {
      for (let i = 1; i < result.reasons.length; i++) {
        const prev = result.reasons[i - 1];
        const current = result.reasons[i];
        const magnitudeDiff =
          Math.abs(prev.contribution) - Math.abs(current.contribution);
        if (Math.abs(magnitudeDiff) > EPSILON) {
          expect(magnitudeDiff).toBeGreaterThan(0);
        } else {
          expect(prev.field <= current.field).toBe(true);
        }
      }
    });
  }

  it("I3 los pesos suman 1", () => {
    expect(
      MATCH_WEIGHTS.semantic +
        MATCH_WEIGHTS.objective +
        MATCH_WEIGHTS.keywords +
        MATCH_WEIGHTS.reference,
    ).toBeCloseTo(1, 9);
    expect(
      OBJ_SUBWEIGHTS.genres + OBJ_SUBWEIGHTS.gameModes + OBJ_SUBWEIGHTS.perspectives,
    ).toBeCloseTo(1, 9);
  });

  it("I8 rankMatches determinista (mismo input → mismo output)", () => {
    const intent = makeIntent({ keywords: ["cozy"] });
    const games = [
      makeGame({ id: 1, slug: "b-game", keywords: ["cozy"] }),
      makeGame({ id: 2, slug: "a-game", keywords: ["cozy"] }),
    ];
    expect(rankMatches(intent, games)).toEqual(rankMatches(intent, games));
  });
});
