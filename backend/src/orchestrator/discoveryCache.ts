import type { IgdbGameRaw } from "../igdb/types.js";

/*
 * Pool global de raws de IGDB descubiertos y aún no consumidos. Compartido
 * entre peticiones (a diferencia de la caché por (query, intent) del
 * DiscoveryRun): lo que un request descubrió queda disponible sin repetir IGDB.
 * Contrato mínimo, sin TTL/LRU/Redis/locks: clave = sourceId, sin duplicados
 * (first-write-wins), un raw solo se borra al confirmarlo en PostgreSQL.
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