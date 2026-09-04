import { prisma } from "../lib/prisma.js";
import type { Genre, Platform } from "../generated/prisma/enums.js";
import type { Game, GameToPersist } from "../types/Game.js";

// Filtro de pre-selección de candidatos para el orquestador. El matcher es
// rápido, pero traer el catálogo completo por petición no escala: el SQL
// selecciona los más plausibles por solape objetivo y corta con un límite.
export interface CandidateFilter {
  genres: string[];
  keywords: string[];
  platforms: string[];
  limit: number;
}

function toGame(
  game: Awaited<ReturnType<typeof prisma.games.findUnique>> & {},
): Game {
  return {
    id: game.id,
    slug: game.slug,
    sourceId: game.source_id,
    title: game.title,
    description_es: game.description_es ?? "",
    description_en: game.description_en ?? "",
    coverUrl: game.cover_url ?? "",
    releaseYear: game.release_year ?? 0,
    genres: game.genres,
    platforms: game.platforms,
    gameModes: game.game_modes,
    perspectives: game.perspectives,
    keywords: game.keywords,
    developers: game.developers,
    publishers: game.publishers,
    searchCount: game.search_count,
    difficulty: game.difficulty,
    pace: game.pace,
    narrative: game.narrative,
    complexity: game.complexity,
    coziness: game.coziness,
    strategy: game.strategy,
    exploration: game.exploration,
    violence: game.violence,
    horror: game.horror,
    darkness: game.darkness,
    tension: game.tension,
    humor: game.humor,
    isolation: game.isolation,
  };
}

export const prismaGameRepository = {
  async getAll(): Promise<Game[]> {
    const games = await prisma.games.findMany();

    return games.map(toGame);
  },

  async getBySlug(slug: string): Promise<Game | undefined> {
    const game = await prisma.games.findUnique({
      where: { slug },
    });

    if (!game) return undefined;

    return toGame(game);
  },

  async search(query: string): Promise<Game[]> {
    const games = await prisma.games.findMany({
      where: {
        title: {
          contains: query,
          mode: "insensitive",
        },
      },
    });

    return games.map(toGame);
  },

  async getBySlugs(slugs: string[]): Promise<Map<string, Game>> {
    if (slugs.length === 0) return new Map();

    const games = await prisma.games.findMany({
      where: { slug: { in: slugs } },
    });

    return new Map(games.map((game) => [game.slug, toGame(game)]));
  },

  async getBySourceId(sourceId: string): Promise<Game | undefined> {
    const game = await prisma.games.findUnique({
      where: { source_id: sourceId },
    });

    if (!game) return undefined;

    return toGame(game);
  },

  async findCandidates(filter: CandidateFilter): Promise<Game[]> {
    const overlaps = [];
    if (filter.genres.length > 0) {
      overlaps.push({ genres: { hasSome: filter.genres as Genre[] } });
    }
    if (filter.platforms.length > 0) {
      overlaps.push({ platforms: { hasSome: filter.platforms as Platform[] } });
    }
    if (filter.keywords.length > 0) {
      overlaps.push({ keywords: { hasSome: filter.keywords } });
    }

    const games = await prisma.games.findMany({
      where: overlaps.length > 0 ? { OR: overlaps } : undefined,
      orderBy: [{ search_count: "desc" }, { id: "asc" }],
      take: filter.limit,
    });

    return games.map(toGame);
  },

  async countGames(): Promise<number> {
    return prisma.games.count();
  },

  async incrementSearchCounts(ids: number[]): Promise<void> {
    if (ids.length === 0) return;

    await prisma.games.updateMany({
      where: { id: { in: ids } },
      data: { search_count: { increment: 1 } },
    });
  },

  async create(game: Game | GameToPersist): Promise<Game> {
    const createdGame = await prisma.games.create({
      data: {
        slug: game.slug,
        title: game.title,
        description_es: game.description_es,
        description_en: game.description_en,
        cover_url: game.coverUrl,
        release_year: game.releaseYear,
        genres: game.genres,

        platforms: game.platforms,
        game_modes: game.gameModes,
        perspectives: game.perspectives,
        keywords: game.keywords,
        source_id: game.sourceId,
        developers: game.developers,
        publishers: game.publishers,
        difficulty: game.difficulty,
        pace: game.pace,
        narrative: game.narrative,
        complexity: game.complexity,
        coziness: game.coziness,
        strategy: game.strategy,
        exploration: game.exploration,
        violence: game.violence,
        horror: game.horror,
        darkness: game.darkness,
        tension: game.tension,
        humor: game.humor,
        isolation: game.isolation,
      },
    });

    return toGame(createdGame);
  },
  async update(game: Game): Promise<Game> {
    const updatedGame = await prisma.games.update({
      where: {
        id: game.id,
      },
      data: {
        slug: game.slug,
        title: game.title,
        description_es: game.description_es,
        description_en: game.description_en,
        cover_url: game.coverUrl,
        release_year: game.releaseYear,
        genres: game.genres,

        platforms: game.platforms,
        game_modes: game.gameModes,
        perspectives: game.perspectives,
        keywords: game.keywords,
        source_id: game.sourceId,
        developers: game.developers,
        publishers: game.publishers,
        difficulty: game.difficulty,
        pace: game.pace,
        narrative: game.narrative,
        complexity: game.complexity,
        coziness: game.coziness,
        strategy: game.strategy,
        exploration: game.exploration,
        violence: game.violence,
        horror: game.horror,
        darkness: game.darkness,
        tension: game.tension,
        humor: game.humor,
        isolation: game.isolation,
      },
    });

    return toGame(updatedGame);
  },
  async delete(id: number): Promise<void> {
    await prisma.games.delete({
      where: { id },
    });
  },
};
