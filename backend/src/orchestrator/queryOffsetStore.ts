/*
 * Progreso de paginación IGDB cross-request. Para cada (query normalizada +
 * intent filtrado) recuerda el offset acumulado de la última página con
 * resultados, de modo que "buscar más" en una petición NUEVA no repita la
 * misma lista: retoma por donde se quedó la anterior.
 *
 * Es estado MÍNIMO y separado del pool global de raws: aquí SOLO vive un
 * cursor monotónico (qué página pedir), nunca contenido ni historial del
 * usuario. El contenido descubierto lo guarda DiscoveryCacheRepository; este
 * store únicamente evita repetir la MISMA consulta a IGDB cuando no había
 * nada compatible.
 *
 * Monotónico por diseño: el offset solo avanza con páginas no vacías (una
 * página vacía no mueve el cursor, igual que las listas vacías no se cachean
 * como agotadas). Sin expiración en v1: reiniciar por tiempo queda para una
 * fase con Redis/proceso compartido.
 */
export interface QueryOffsetStore {
  // Siguiente offset a pedir para la clave (0 si aún no se ha paginado).
  getNextOffset(key: string): Promise<number>;
  // Cuando una página con resultados se pide en el offset dado y devuelve
  // pageLength filas, el próximo offset es min(offset + pageLength, tope).
  setNextOffset(key: string, offset: number): Promise<void>;
}

export class InMemoryQueryOffsetStore implements QueryOffsetStore {
  private readonly offsets = new Map<string, number>();

  async getNextOffset(key: string): Promise<number> {
    return this.offsets.get(key) ?? 0;
  }

  async setNextOffset(key: string, offset: number): Promise<void> {
    this.offsets.set(key, offset);
  }
}
