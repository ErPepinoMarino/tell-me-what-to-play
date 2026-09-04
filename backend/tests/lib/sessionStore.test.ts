import { describe, expect, it } from "vitest";
import {
  appendShownIds,
  InMemorySessionStore,
} from "../../src/sessions/sessionStore.js";

function makeStore(ttlMs = 30 * 60 * 1000, maxEntries = 10) {
  let now = 1_000_000;
  const store = new InMemorySessionStore({
    ttlMs,
    maxEntries,
    now: () => now,
  });
  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("InMemorySessionStore", () => {
  it("ensure crea la sesión y get devuelve la misma referencia", () => {
    const { store } = makeStore();

    const session = store.ensure(1);
    session.currentIntent = null;
    store.save(1, session);

    expect(store.get(1)).toBe(session);
  });

  it("expira la sesión al superar el TTL", () => {
    const { store, advance } = makeStore(1000);

    store.ensure(1);
    advance(999);
    expect(store.get(1)).toBeDefined();

    // El get anterior renovó lastUsedAt (TTL deslizante): expira 1000ms después
    advance(1000);
    expect(store.get(1)).toBeUndefined();
  });

  it("el TTL es deslizante: cada acceso renueva lastUsedAt", () => {
    const { store, advance } = makeStore(1000);

    store.ensure(1);
    advance(900);
    store.get(1);
    advance(900);
    expect(store.get(1)).toBeDefined();

    advance(1000);
    expect(store.get(1)).toBeUndefined();
  });

  it("expulsa las sesiones más antiguas al superar maxEntries", () => {
    const { store, advance } = makeStore(10_000, 3);

    store.ensure(1);
    advance(10);
    store.ensure(2);
    advance(10);
    store.ensure(3);
    advance(10);
    store.ensure(4);

    expect(store.get(1)).toBeUndefined();
    expect(store.get(2)).toBeDefined();
    expect(store.get(3)).toBeDefined();
    expect(store.get(4)).toBeDefined();
  });

  it("evict elimina la sesión explícitamente", () => {
    const { store } = makeStore();

    store.ensure(1);
    store.evict(1);

    expect(store.get(1)).toBeUndefined();
  });
});

describe("appendShownIds", () => {
  it("añade los ids nuevos", () => {
    expect(appendShownIds([1, 2], [3], 10)).toEqual([1, 2, 3]);
  });

  it("recorta por el principio (FIFO) al superar el cap", () => {
    expect(appendShownIds([1, 2, 3], [4, 5], 4)).toEqual([2, 3, 4, 5]);
  });

  it("devuelve los ids tal cual si no se supera el cap", () => {
    expect(appendShownIds([], [1], 200)).toEqual([1]);
  });
});
