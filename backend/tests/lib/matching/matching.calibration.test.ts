import { describe, expect, it } from "vitest";
import { rankMatches } from "../../../src/matching/rankMatches.js";
import { makeGame, makeIntent, makeSemantic } from "./fixtures.js";

/*
 * Escenarios de producto del modelo de filtros duros (recalibrados):
 *
 * S1 "un juego oscuro de piratas": la temática ya no puntúa, FILTRA. El
 *     juego de cowboys con semánticas perfectas queda FUERA (no tiene la
 *     keyword "pirates"); el de piratas pasa aunque contradiga algo la
 *     oscuridad, y su acuerdo semántico lo ordena.
 *
 * S2 "lento, cozy en pixel art": el match de temática desconocido gana al
 *     que contradice las dimensiones pedidas: una contradicción fuerte
 *     aporta NEGATIVO (peor que "no sé cómo es").
 */

describe("escenario S1: la temática filtra, la semántica ordena", () => {
  const INTENT = makeIntent({
    keywords: ["pirates"],
    semantic: makeSemantic({ darkness: 0.8 }),
  });

  it("el juego de cowboys con oscuridad perfecta queda excluido (must keyword)", () => {
    const cowboysDark = makeGame({
      id: 3,
      slug: "cowboys-dark",
      keywords: ["cowboys"],
      darkness: 0.9,
    });
    const piratesMild = makeGame({
      id: 2,
      slug: "pirates-mild",
      keywords: ["pirates"],
      darkness: 0.4,
    });

    const { ranked } = rankMatches(INTENT, [cowboysDark, piratesMild]);

    const cowboys = ranked.find((item) => item.game.slug === "cowboys-dark");
    expect(cowboys?.tier).toBe("invalid");
    expect(cowboys?.gatesViolated).toContain("must-violated");

    expect(ranked[0].game.slug).toBe("pirates-mild");
    expect(ranked[0].tier).toBe("valid");
  });

  it("entre fichas de piratas, la menos oscura gana a la muy oscura (acuerdo)", () => {
    const piratesBright = makeGame({
      id: 4,
      slug: "pirates-bright",
      keywords: ["pirates"],
      darkness: 0.1,
    });
    const piratesDark = makeGame({
      id: 5,
      slug: "pirates-dark",
      keywords: ["pirates"],
      darkness: 0.7,
    });

    const { ranked } = rankMatches(INTENT, [piratesBright, piratesDark]);

    expect(ranked[0].game.slug).toBe("pirates-dark");
    expect(ranked[1].game.slug).toBe("pirates-bright");
  });
});

describe("escenario S2: contradecir hunduye por debajo de lo desconocido", () => {
  const INTENT = makeIntent({
    keywords: ["pixel art"],
    semantic: makeSemantic({ pace: 0.1, coziness: 0.9 }),
  });

  it("el pixel-art sin semánticas gana al pixel-art frenético (contradicción negativa)", () => {
    const pixelGame = makeGame({
      id: 10,
      slug: "pixel-game",
      keywords: ["pixel art"],
    });
    const pixelFrantic = makeGame({
      id: 12,
      slug: "pixel-frantic",
      keywords: ["pixel art"],
      pace: 0.9,
      coziness: 0.1,
    });

    const { ranked } = rankMatches(INTENT, [pixelFrantic, pixelGame]);

    expect(ranked[0].game.slug).toBe("pixel-game");
    expect(ranked[0].score).toBe(0);
    expect(ranked[1].game.slug).toBe("pixel-frantic");
    expect(ranked[1].score).toBeLessThan(0);
  });

  it("el juego con vibe perfecto pero sin temática queda fuera (must keyword)", () => {
    const vibeGame = makeGame({
      id: 11,
      slug: "vibe-game",
      keywords: ["realistic"],
      pace: 0.1,
      coziness: 1,
    });

    const { ranked } = rankMatches(INTENT, [vibeGame]);

    expect(ranked[0].game.slug).toBe("vibe-game");
    expect(ranked[0].tier).toBe("invalid");
  });
});

describe("escenario S3: 'similar a X pero que no sea X'", () => {
  it("la franquicia excluida por título no aparece nunca", () => {
    const intent = makeIntent({
      keywords: ["car stealing"],
      excluded: {
        keywords: ["gta", "grand theft auto"],
        genres: null,
        platforms: null,
        gameModes: null,
        perspectives: null,
        releaseYear: null,
        yearFrom: null,
        yearTo: null,
      },
    });

    const gtaGame = makeGame({
      id: 20,
      slug: "gta-san-andreas",
      title: "Grand Theft Auto: San Andreas",
      keywords: ["car stealing", "open world"],
    });
    const thiefGame = makeGame({
      id: 21,
      slug: "car-thief-sim",
      title: "Car Thief Simulator",
      keywords: ["car stealing"],
    });

    const { ranked } = rankMatches(intent, [gtaGame, thiefGame]);

    expect(ranked[0].game.slug).toBe("car-thief-sim");
    const gta = ranked.find((item) => item.game.slug === "gta-san-andreas");
    expect(gta?.tier).toBe("invalid");
    expect(gta?.gatesViolated).toContain("red-flag-violated");
  });
});
