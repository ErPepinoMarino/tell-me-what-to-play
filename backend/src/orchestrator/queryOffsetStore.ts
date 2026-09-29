/*
 * Progreso de paginación IGDB cross-request: guarda el offset de la última página
 * con resultados por (query normalizada + intent), para que "buscar más" no repita
 * la misma lista. Solo un cursor monotónico —nunca contenido ni historial del
 * usuario—, que avanza con páginas no vacías y no expira en v1.
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
