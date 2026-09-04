import { describe, expect, it } from "vitest";
import { matchGame } from "../../../src/matching/matchGame.js";
import { SCORE_MAX, SCORE_MIN } from "../../../src/matching/constants.js";
import { FIXTURES } from "./fixtures.js";

/*
 * Invariantes del matcher sobre TODOS los golden fixtures:
 * - I1: score = Σ contributions (exacto, orden de inserción tras el sort).
 * - I2: el score vive en su rango natural [-1, 1].
 * - I3: gates ⇒ invalid; sin gates ⇒ valid | excellent (nunca weak).
 * - I4: determinismo — dos evaluaciones idénticas producen resultados
 *   idénticos (profundidad completa).
 */
describe("matchGame — invariantes (sobre todos los fixtures)", () => {
  for (const fixture of FIXTURES) {
    it(`I1-I4: ${fixture.name}`, () => {
      const result = matchGame({
        intent: fixture.intent,
        game: fixture.game,
        anchors: fixture.anchors,
      });

      // I1: score = Σ contributions (la suma se hace en el orden ya ordenado)
      const sum = result.reasons.reduce(
        (total, reason) => total + reason.contribution,
        0,
      );
      expect(Math.abs(result.score - sum)).toBeLessThanOrEqual(1e-12);

      // I2: rango del score
      expect(result.score).toBeGreaterThanOrEqual(SCORE_MIN);
      expect(result.score).toBeLessThanOrEqual(SCORE_MAX);

      // I3: gates y tiers coherentes
      if (result.gatesViolated.length > 0) {
        expect(result.tier).toBe("invalid");
      } else {
        expect(["valid", "excellent"]).toContain(result.tier);
      }

      // I4: determinismo
      const again = matchGame({
        intent: fixture.intent,
        game: fixture.game,
        anchors: fixture.anchors,
      });
      expect(again).toEqual(result);
    });
  }

  it("I5: un juego con red flag violada nunca es mostrable", () => {
    for (const fixture of FIXTURES) {
      if (fixture.expect.gatesViolated?.includes("red-flag-violated")) {
        const result = matchGame({
          intent: fixture.intent,
          game: fixture.game,
          anchors: fixture.anchors,
        });
        expect(result.tier).toBe("invalid");
      }
    }
  });
});
