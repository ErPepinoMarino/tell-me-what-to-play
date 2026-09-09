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
          genres: ["SHOOTER"],
          themes: null,
          platforms: null,
          gameModes: null,
          perspectives: null,
        },
      }),
    );

    // "3d" a secas atrae juegos de cualquier género (doomed con must SHOOTER):
    // la variante productiva "3d shooter" va antes.
    expect(variants).toEqual(["3d shooter", "3d"]);
  });

  it("normaliza y descarta keywords vacías", () => {
    expect(
      buildQueryVariants(makeIntent({ keywords: ["  Pirates  ", ""] })),
    ).toEqual(["pirates"]);
  });

  it("unicidad tolerancia-cero: sin variantes dobles tipo 'cowboys cowboys'", () => {
    expect(
      buildQueryVariants(makeIntent({ keywords: ["cowboys", "Cowboys "] })),
    ).toEqual(["cowboys"]);
  });

  it("sin keywords usa los términos de género", () => {
    const variants = buildQueryVariants(
      makeIntent({
        objective: {
          genres: ["ROLE_PLAYING_RPG"],
          themes: null,
          platforms: null,
          gameModes: null,
          perspectives: null,
        },
      }),
    );

    expect(variants.length).toBeGreaterThan(0);
  });

  it("solo tema + modo (mmo fantasía) genera variante: siempre se llama a IGDB", () => {
    const variants = buildQueryVariants(
      makeIntent({
        objective: {
          genres: null,
          themes: ["FANTASY"],
          platforms: null,
          gameModes: ["MASSIVELY_MULTIPLAYER"],
          perspectives: null,
        },
      }),
    );

    expect(variants).toEqual(["fantasy mmo"]);
  });

  it("solo plataforma genera variante en vez de no-query", () => {
    const variants = buildQueryVariants(
      makeIntent({
        objective: {
          genres: null,
          themes: null,
          platforms: ["PC"],
          gameModes: null,
          perspectives: null,
        },
      }),
    );

    expect(variants).toEqual(["pc"]);
  });
});
