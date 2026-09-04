import { describe, expect, it } from "vitest";
import { ensureSeedCatalog } from "../../src/services/seedCatalogService.js";
import { FakeCatalogLayer, makeGame } from "../helpers/fakes.js";

describe("ensureSeedCatalog", () => {
  it("crea todas las fichas del seed en un catálogo vacío", async () => {
    const catalog = new FakeCatalogLayer();

    const result = await ensureSeedCatalog(catalog);

    expect(result.created).toBeGreaterThan(0);
    expect(result.skipped).toBe(0);
    expect(catalog.all().length).toBe(result.created);
  });

  it("es idempotente: segunda pasada solo salta existentes", async () => {
    const catalog = new FakeCatalogLayer();

    const first = await ensureSeedCatalog(catalog);
    const second = await ensureSeedCatalog(catalog);

    expect(second.created).toBe(0);
    expect(second.skipped).toBe(first.created);
    expect(catalog.all().length).toBe(first.created);
  });

  it("nunca sobreescribe fichas enriquecidas de la BDD con datos del seed", async () => {
    const catalog = new FakeCatalogLayer();
    catalog.seed([
      makeGame({
        id: 1,
        slug: "elden-ring-2022",
        title: "Elden Ring (versión PG enriquecida)",
        difficulty: 0.8,
      }),
    ]);

    const result = await ensureSeedCatalog(catalog);

    // La ficha existente NO se toca; el resto del seed sí se crea
    expect(result.skipped).toBe(1);
    expect(result.created).toBeGreaterThan(0);
    const persisted = catalog.get(1)!;
    expect(persisted.title).toBe("Elden Ring (versión PG enriquecida)");
    expect(persisted.difficulty).toBe(0.8);
  });
});
