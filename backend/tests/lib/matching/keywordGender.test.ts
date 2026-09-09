import { describe, expect, it } from "vitest";
import { filterGenderMismatchedAdditions } from "../../../src/matching/keywords.js";

describe("filterGenderMismatchedAdditions", () => {
  it("vaqueros no suma cowgirls (expansión inclusiva dropeada)", () => {
    const { kept, dropped } = filterGenderMismatchedAdditions(
      "mas juegos de vaqueros",
      ["cowgirls"],
    );
    expect(kept).toEqual([]);
    expect(dropped).toEqual(["cowgirls"]);
  });

  it("vaqueras conserva cowgirls", () => {
    const { kept, dropped } = filterGenderMismatchedAdditions(
      "solo vaqueras",
      ["cowgirls"],
    );
    expect(kept).toEqual(["cowgirls"]);
    expect(dropped).toEqual([]);
  });

  it("la mención literal en inglés manda", () => {
    const { kept, dropped } = filterGenderMismatchedAdditions(
      "busco algo con cowgirls",
      ["cowgirls"],
    );
    expect(kept).toEqual(["cowgirls"]);
    expect(dropped).toEqual([]);
  });

  it("sin evidencia en contra conserva (conservador)", () => {
    const { kept, dropped } = filterGenderMismatchedAdditions("dame más", [
      "cowgirls",
    ]);
    expect(kept).toEqual(["cowgirls"]);
    expect(dropped).toEqual([]);
  });

  it("null se preserva como null", () => {
    expect(filterGenderMismatchedAdditions("hola", null)).toEqual({
      kept: null,
      dropped: [],
    });
  });

  it("términos sin género no se tocan", () => {
    const { kept, dropped } = filterGenderMismatchedAdditions(
      "mas juegos de vaqueros",
      ["cowboys", "zombies"],
    );
    expect(kept).toEqual(["cowboys", "zombies"]);
    expect(dropped).toEqual([]);
  });

  it("rechazo explícito con evidencia femenina conserva (lo cubre remove)", () => {
    const { kept, dropped } = filterGenderMismatchedAdditions(
      "no quiero vaqueras, solo vaqueros",
      ["cowboys"],
    );
    expect(kept).toEqual(["cowboys"]);
    expect(dropped).toEqual([]);
  });
});
