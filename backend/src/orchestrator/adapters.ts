import { prismaGameRepository } from "../repositories/prismaGameRepository.js";
import { jsonGameRepository } from "../repositories/jsonGameRepository.js";
import type { CatalogLayer, CacheLayer } from "./types.js";

// Adaptadores finos: el orquestador depende de interfaces, nunca de Prisma
// ni del cache directamente. Mismo principio que matching/ y ResearchProvider.
export const prismaCatalogLayer: CatalogLayer = {
  findCandidates: (filter) => prismaGameRepository.findCandidates(filter),
  getBySlugs: (slugs) => prismaGameRepository.getBySlugs(slugs),
  getBySlug: (slug) => prismaGameRepository.getBySlug(slug),
  getBySourceId: (sourceId) => prismaGameRepository.getBySourceId(sourceId),
  searchByTitle: (query) => prismaGameRepository.search(query),
  create: (game) => prismaGameRepository.create(game),
  update: (game) => prismaGameRepository.update(game),
  incrementSearchCounts: (ids) =>
    prismaGameRepository.incrementSearchCounts(ids),
  countGames: () => prismaGameRepository.countGames(),
};

export const jsonCacheLayer: CacheLayer = {
  getAll: () => jsonGameRepository.getAll(),
  searchByTitle: (query) => jsonGameRepository.search(query),
};
