import type { IgdbGameRaw } from "../igdb/types.js";

/*
 * Pool global de raws de IGDB descubiertos y aún no consumidos. A diferencia
 * de la caché por (query, intent) del DiscoveryRun (estado de UNA ejecución),
 * este pool es compartido entre peticiones: lo que un request descubrió queda
 * disponible para futuras búsquedas sin repetir llamadas IGDB.
 *
 * Contrato mínima. Sin TTL, LRU, Redis, PostgreSQL, locks ni estados de
 * procesamiento:
 *  - clave: sourceId = String(raw.id);
 *  - un mismo sourceId no puede duplicarse (first-write-wins: el primer raw
 *    que entra conserva su versión, los posteriores con el mismo id se ignoran);
 *  - un raw SOLO se elimina tras detectar que ya existe en PostgreSQL o al
 *    completar correctamente su promoción a PostgreSQL (gestión del gestor);
 *  - readAll no promete orden.
 */
export interface DiscoveryCacheRepository {
  readAll(): Promise<IgdbGameRaw[]>;
  set(raw: IgdbGameRaw): Promise<void>;
  addMany(raws: Iterable<IgdbGameRaw>): Promise<void>;
  remove(sourceId: string): Promise<void>;
}

/* Implementación inicial en memoria (pool por proceso). Intercambiable por
 * Redis (multi-proceso) o PostgreSQL sin tocar DiscoveryManager. */
export class InMemoryDiscoveryCacheRepository
  implements DiscoveryCacheRepository
{
  private pool = new Map<string, IgdbGameRaw>();

  async readAll(): Promise<IgdbGameRaw[]> {
    return [...this.pool.values()];
  }

  async set(raw: IgdbGameRaw): Promise<void> {
    const key = String(raw.id);
    if (!this.pool.has(key)) {
      this.pool.set(key, raw);
    }
  }

  async addMany(raws: Iterable<IgdbGameRaw>): Promise<void> {
    for (const raw of raws) {
      await this.set(raw);
    }
  }

  async remove(sourceId: string): Promise<void> {
    this.pool.delete(sourceId);
  }
}