import { prismaGameRepository } from "../repositories/prismaGameRepository.js";
import type { CatalogLayer } from "./types.js";

// Adaptador fino: el orquestador depende de la interfaz, nunca de Prisma.
export const prismaCatalogLayer: CatalogLayer = {
  findCandidates: (filter) => prismaGameRepository.findCandidates(filter),
  getBySlugs: (slugs) => prismaGameRepository.getBySlugs(slugs),
  getBySlug: (slug) => prismaGameRepository.getBySlug(slug),
  getBySourceId: (sourceId) => prismaGameRepository.getBySourceId(sourceId),
  searchByTitle: (query) => prismaGameRepository.search(query),
  createIgdb: (game) => prismaGameRepository.createIgdb(game),
  syncCatalogKeywords: (game, raw) =>
    prismaGameRepository.syncCatalogKeywords(game, raw),
  updateReEnrich: (game, patch) =>
    prismaGameRepository.updateReEnrich(game, patch),
  incrementSearchCounts: (ids) =>
    prismaGameRepository.incrementSearchCounts(ids),
  countGames: () => prismaGameRepository.countGames(),
};
