import { describe, expect, it } from "vitest";
import { hashRefreshToken } from "../../src/lib/refreshToken.js";

//Prueba trivial, el metodo es muy chorra pero nos sirve para ver la sintaxis de Vitest
describe("hashRefreshToken", () => {
  it("returns the expected SHA-256 hash for a known token", () => {
    const token = "abc";

    const result = hashRefreshToken(token);

    expect(result).toBe(
      //Este es el hash SHA-256 de "abc" en hexadecimal, lo hemos pre-calculado.
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("returns different hashes for different tokens", () => {
    expect(hashRefreshToken("abc")).not.toBe(hashRefreshToken("abd"));
  });
});
