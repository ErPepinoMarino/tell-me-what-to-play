import { describe, expect, it } from "vitest";
import { buildQueryVariants } from "../../src/orchestrator/candidates.js";
import { makeIntent } from "../helpers/fakes.js";

describe("buildQueryVariants", () => {
  it("combina las keywords y añade cada keyword individual como rescate", () => {
    const variants = buildQueryVariants(
      makeIntent({ keywords: ["batman", "pixel art"] }),
    );

    // La combinada primero (más específica); las individuales al final:
    // IGDB busca por título y la combinada suele devolver 0 aunque cada
    // término por separado rinda.
    expect(variants).toEqual(["batman pixel art", "batman", "pixel art"]);
  });

  it("con más de 3 keywords añade también el segundo bloque", () => {
    const variants = buildQueryVariants(
      makeIntent({ keywords: ["a", "b", "c", "d", "e"] }),
    );

    expect(variants).toEqual(["a b c", "d e", "a", "b", "c", "d", "e"]);
  });

  it("con una sola keyword no duplica la variante individual", () => {
    expect(buildQueryVariants(makeIntent({ keywords: ["pirates"] }))).toEqual([
      "pirates",
    ]);
  });

  it("con una sola keyword y género: la variante con género va primero", () => {
    const variants = buildQueryVariants(
      makeIntent({
        keywords: ["3d"],
        objective: {
          genres: ["HORROR"],
          platforms: null,
          gameModes: null,
          perspectives: null,
        },
      }),
    );

    // "3d" a secas atrae juegos de cualquier género (doomed con must HORROR):
    // la variante productiva "3d horror" va antes.
    expect(variants).toEqual(["3d horror", "3d"]);
  });

  it("normaliza y descarta keywords vacías", () => {
    expect(
      buildQueryVariants(makeIntent({ keywords: ["  Pirates  ", ""] })),
    ).toEqual(["pirates"]);
  });

  it("sin keywords usa los términos de género", () => {
    const variants = buildQueryVariants(
      makeIntent({
        objective: {
          genres: ["RPG"],
          platforms: null,
          gameModes: null,
          perspectives: null,
        },
      }),
    );

    expect(variants.length).toBeGreaterThan(0);
  });
});
