import type { Game } from "../types/Game.js";
import { prismaGameRepository } from "../repositories/prismaGameRepository.js";

const repository = prismaGameRepository;

/*
 * Servicio de lectura de juegos. La escritura de fichas/keywords NO vive
 * aquí: solo createIgdb / createCurated / syncCatalogKeywords del repositorio
 * pueden escribir keywords (ver CatalogLayer). gameService.create/update se
 * eliminaron por no tener callers de producción y por abrir una superficie
 * genérica de escritura.
 */
export const gameService = {
  async getBySlug(slug: string): Promise<Game | undefined> {
    return repository.getBySlug(slug);
  },

  async search(query: string) {
    return repository.search(query);
  },
};