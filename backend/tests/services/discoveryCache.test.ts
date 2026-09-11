import { describe, expect, it } from "vitest";
import { InMemoryDiscoveryCacheRepository } from "../../src/orchestrator/discoveryCache.js";
import { makeRaw } from "../helpers/fakes.js";

describe("InMemoryDiscoveryCacheRepository", () => {
  it("readAll devuelve todos los raws almacenados", async () => {
    const cache = new InMemoryDiscoveryCacheRepository();
    await cache.addMany([makeRaw(1, "A"), makeRaw(2, "B")]);

    const all = await cache.readAll();
    expect(all.map((raw) => raw.id)).toEqual([1, 2]);
  });

  it("addMany no duplica un sourceId: gana la primera versión", async () => {
    const cache = new InMemoryDiscoveryCacheRepository();
    await cache.addMany([
      makeRaw(1, "Primera"),
      makeRaw(1, "Segunda"),
      makeRaw(2, "Sola"),
    ]);

    const all = await cache.readAll();
    expect(all).toHaveLength(2);
    expect(all.map((raw) => raw.name)).toEqual(["Primera", "Sola"]);
  });

  it("addMany acepta iterables y respeta dedup entre llamadas", async () => {
    const cache = new InMemoryDiscoveryCacheRepository();
    const raws = new Set([makeRaw(1, "A"), makeRaw(2, "B"), makeRaw(1, "A dup")]);

    await cache.addMany(raws);
    await cache.addMany([makeRaw(1, "A otra vez"), makeRaw(3, "C")]);

    expect((await cache.readAll()).map((raw) => raw.id)).toEqual([1, 2, 3]);
  });

  it("remove retira el raw por sourceId y es idempotente", async () => {
    const cache = new InMemoryDiscoveryCacheRepository();
    await cache.addMany([makeRaw(1, "A"), makeRaw(2, "B")]);

    await cache.remove("1");
    await cache.remove("1");
    await cache.remove("inexistente");

    const all = await cache.readAll();
    expect(all.map((raw) => raw.id)).toEqual([2]);
  });

  it("readAll no tiene orden prometido pero es estable en memoria", async () => {
    const cache = new InMemoryDiscoveryCacheRepository();
    await cache.addMany([makeRaw(3, "C"), makeRaw(1, "A")]);
    await cache.remove("3");

    expect((await cache.readAll()).map((raw) => raw.id)).toEqual([1]);
    expect((await cache.readAll()).map((raw) => raw.id)).toEqual([1]);
  });
});