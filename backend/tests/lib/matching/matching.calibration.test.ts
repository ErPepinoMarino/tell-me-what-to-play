import { describe, expect, it } from "vitest";
import { rankMatches } from "../../../src/matching/rankMatches.js";
import { makeGame, makeIntent, makeSemantic } from "./fixtures.js";

/*
 * Escenarios de aceptación que cerraron la calibración (derivación de la
 * banda de pesos en src/matching/constants.ts):
 *
 * S1 "un juego oscuro de piratas": la temática (piratas) gana SIEMPRE al
 *     juego de temática equivocada con las semánticas perfectas, ya sea
 *     porque la ficha no conoce la oscuridad o porque es "menos oscuro".
 *
 * S2 "un juego lento, cozy en pixel art": el match de temática gana al
 *     juego correcto en vibe pero sin temática; PERO si el juego de pixel
 *     art CONTRADICE las dos dimensiones pedidas, el vibe perfecto gana.
 */

const SCENARIO_1_INTENT = makeIntent({
  keywords: ["pirates"],
  semantic: makeSemantic({ darkness: 0.8 }),
});

const COWBOYS_DARK = makeGame({
  id: 3,
  slug: "cowboys-dark",
  keywords: ["cowboys"],
  darkness: 0.9,
});

describe("calibración S1: la temática precede a las semánticas", () => {
  it("piratas con oscuridad desconocida gana claramente a cowboys muy oscuros", () => {
    const piratesUnknown = makeGame({
      id: 1,
      slug: "pirates-unknown",
      keywords: ["pirates"],
    });

    const { ranked } = rankMatches(SCENARIO_1_INTENT, [
      COWBOYS_DARK,
      piratesUnknown,
    ]);

    expect(ranked[0].game.slug).toBe("pirates-unknown");
    expect(ranked[0].tier).toBe("valid");
    expect(ranked[1].game.slug).toBe("cowboys-dark");
    expect(ranked[1].tier).toBe("weak");
    expect(ranked[0].score - ranked[1].score).toBeGreaterThan(0.4);
  });

  it("piratas 'menos oscuros' (contradicción suave) sigue ganando", () => {
    const piratesMild = makeGame({
      id: 2,
      slug: "pirates-mild",
      keywords: ["pirates"],
      darkness: 0.4,
    });

    const { ranked } = rankMatches(SCENARIO_1_INTENT, [
      COWBOYS_DARK,
      piratesMild,
    ]);

    expect(ranked[0].game.slug).toBe("pirates-mild");
    expect(ranked[0].tier).toBe("valid");
    expect(ranked[1].game.slug).toBe("cowboys-dark");
  });

  it("incluso contradiciendo la oscuridad de plano, la temática gana el orden", () => {
    const piratesBright = makeGame({
      id: 4,
      slug: "pirates-bright",
      keywords: ["pirates"],
      darkness: 0.1,
    });

    const { ranked } = rankMatches(SCENARIO_1_INTENT, [
      COWBOYS_DARK,
      piratesBright,
    ]);

    expect(ranked[0].game.slug).toBe("pirates-bright");
    // La contradicción amplificada bloquea la validez por keywords: la ficha
    // compite en orden pero no alcanza tier mostrable.
    expect(ranked[0].tier).toBe("weak");
  });
});

const SCENARIO_2_INTENT = makeIntent({
  keywords: ["pixel art"],
  semantic: makeSemantic({ pace: 0.1, coziness: 0.9 }),
});

const PIXEL_GAME = makeGame({
  id: 10,
  slug: "pixel-game",
  keywords: ["pixel art"],
});

const VIBE_GAME = makeGame({
  id: 11,
  slug: "vibe-game",
  keywords: ["realistic"],
  pace: 0.1,
  coziness: 1,
});

const PIXEL_FRANTIC = makeGame({
  id: 12,
  slug: "pixel-frantic",
  keywords: ["pixel art"],
  pace: 0.9,
  coziness: 0.1,
});

describe("calibración S2: lento, cozy y pixel art", () => {
  it("el match de temática gana al juego con vibe perfecto pero sin temática", () => {
    const { ranked } = rankMatches(SCENARIO_2_INTENT, [VIBE_GAME, PIXEL_GAME]);

    expect(ranked[0].game.slug).toBe("pixel-game");
    expect(ranked[0].tier).toBe("valid");
    expect(ranked[1].game.slug).toBe("vibe-game");
    expect(ranked[1].tier).toBe("weak");
  });

  it("giro: pixel art que contradice cozy y pace pierde contra el vibe perfecto", () => {
    const { ranked } = rankMatches(SCENARIO_2_INTENT, [
      PIXEL_FRANTIC,
      VIBE_GAME,
    ]);

    expect(ranked[0].game.slug).toBe("vibe-game");
    expect(ranked[1].game.slug).toBe("pixel-frantic");
    // Ambos por debajo del umbral de exhibición: el orden es correcto y la
    // decisión de mostrar es del orquestador (solo valid/excellent).
    expect(ranked[1].tier).toBe("weak");
  });
});
