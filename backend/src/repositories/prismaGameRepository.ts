import { prisma } from "../lib/prisma.js";
import {
  brandStoredIgdbKeywords,
  extractIgdbKeywords,
} from "../igdb/keywords.js";
import type {
  Game,
  IgdbGame,
  IgdbGameToPersist,
} from "../types/Game.js";
import type { ReEnrichPatch } from "../orchestrator/types.js";
import type { IgdbGameRaw } from "../igdb/types.js";
import type {
  GameMode,
  Genre,
  Perspective,
  Platform,
  Theme,
} from "../types/enums.js";

// Filtro de pre-selección de candidatos para el orquestador. Semántica
// conjuntiva: TODO lo pedido debe estar (contrato de filtros duros). El SQL
// selecciona los juegos que cumplen todos los requisitos y corta con un límite.
export interface CandidateFilter {
  genres: string[];
  themes: string[];
  keywords: string[];
  platforms: string[];
  gameModes: string[];
  perspectives: string[];
  releaseYear: number | null;
  yearFrom: number | null;
  yearTo: number | null;
  limit: number;
}

type GameRow = Awaited<ReturnType<typeof prisma.games.findUnique>> & {};

// Base común de una fila a dominio.
function gameBase(game: GameRow) {
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
    themes: game.themes,
    platforms: game.platforms,
    gameModes: game.game_modes,
    perspectives: game.perspectives,
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

// Lee una fila a dominio. Las keywords se re-marcan como IgdbKeyword[]: la
// BD guarda las keywords que el pipeline sellado escribió desde el raw de
// IGDB (invariante Game.keywords === raw.keywords).
export function toGame(game: GameRow): IgdbGame {
  return {
    ...gameBase(game),
    keywords: brandStoredIgdbKeywords(game.keywords),
  };
}

/*
 * Columnas de una ficha excepto keywords: compartidas por las dos únicas
 * operaciones de escritura de keywords (createIgdb y syncCatalogKeywords,
 * que usa su propio update de una sola columna).
 */
function createData(
  game: IgdbGameToPersist,
  keywords: readonly string[],
) {
  return {
    slug: game.slug,
    title: game.title,
    description_es: game.description_es,
    description_en: game.description_en,
    cover_url: game.coverUrl,
    release_year: game.releaseYear,
    genres: game.genres,
    themes: game.themes,
    platforms: game.platforms,
    game_modes: game.gameModes,
    perspectives: game.perspectives,
    keywords: [...keywords],
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
  };
}

export const prismaGameRepository = {
  async getAll(): Promise<Game[]> {
    const games = await prisma.games.findMany();

    return games.map(toGame);
  },

  async getById(id: number): Promise<Game | undefined> {
    const game = await prisma.games.findUnique({
      where: { id },
    });

    if (!game) return undefined;

    return toGame(game);
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
    /*
     * Pre-filtro conjuntivo (contrato de filtros duros): cada keyword,
     * género y plataforma pedida debe estar en el juego (el juego puede
     * tener más). Un candidato que falle un requisito está condenado en el
     * matcher: no merece sitio en el pool (cap).
     */
    const requirements: Record<string, unknown>[] = [];
    for (const keyword of filter.keywords) {
      requirements.push({ keywords: { has: keyword } });
    }
    for (const genre of filter.genres) {
      requirements.push({ genres: { has: genre as Genre } });
    }
    for (const theme of filter.themes) {
      requirements.push({ themes: { has: theme as Theme } });
    }
    for (const platform of filter.platforms) {
      requirements.push({ platforms: { has: platform as Platform } });
    }
    for (const mode of filter.gameModes ?? []) {
      requirements.push({ game_modes: { has: mode as GameMode } });
    }
    for (const perspective of filter.perspectives ?? []) {
      requirements.push({ perspectives: { has: perspective as Perspective } });
    }

    const yearCondition: {
      equals?: number;
      gte?: number;
      lte?: number;
    } = {};
    if (filter.releaseYear !== null) yearCondition.equals = filter.releaseYear;
    if (filter.yearFrom !== null) yearCondition.gte = filter.yearFrom;
    if (filter.yearTo !== null) yearCondition.lte = filter.yearTo;
    if (Object.keys(yearCondition).length > 0) {
      requirements.push({ release_year: yearCondition });
    }

    const games = await prisma.games.findMany({
      where:
        requirements.length > 0 ? { AND: requirements } : undefined,
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

  /*
   * ÚNICA operación de escritura de keywords del pipeline IGDB: recibe un
   * IgdbGameToPersist cuyas keywords ya salieron del mint sellado
   * extractIgdbKeywords(raw). Un string[] plano o un vocabulario de búsqueda
   * no compila aquí.
   */
  async createIgdb(game: IgdbGameToPersist): Promise<IgdbGame> {
    const createdGame = await prisma.games.create({
      data: createData(game, game.keywords),
    });

    return toGame(createdGame);
  },

  /*
   * Sincronización EXPLÍCITA de keywords desde IGDB (la única vía para
   * refrescar/reparar keywords de un juego, separada del enrichment):
   * sobrescribe la columna con extractIgdbKeywords(raw) — el raw fresco.
   */
  async syncCatalogKeywords(
    game: IgdbGame,
    raw: IgdbGameRaw,
  ): Promise<IgdbGame> {
    const updatedGame = await prisma.games.update({
      where: {
        id: game.id,
      },
      data: {
        keywords: [...extractIgdbKeywords(raw)],
      },
    });

    return toGame(updatedGame);
  },

  /*
   * Re-enrichment: SOLO escribe el patch (descripciones, semánticas y, para
   * fichas sin identidad, objetivos). `keywords` NO está en el patch
   * (keywords?: never): la columna queda intacta por construcción.
   */
  async updateReEnrich(game: Game, patch: ReEnrichPatch): Promise<Game> {
    const updatedGame = await prisma.games.update({
      where: {
        id: game.id,
      },
      data: {
        slug: game.slug,
        title: game.title,
        description_es: patch.description_es,
        description_en: patch.description_en,
        cover_url: patch.coverUrl ?? game.coverUrl,
        release_year: patch.releaseYear ?? game.releaseYear,
        genres: patch.genres ?? game.genres,
        themes: patch.themes ?? game.themes,
        platforms: patch.platforms ?? game.platforms,
        game_modes: patch.gameModes ?? game.gameModes,
        perspectives: patch.perspectives ?? game.perspectives,
        source_id: patch.sourceId !== undefined ? patch.sourceId : game.sourceId,
        developers: patch.developers ?? game.developers,
        publishers: patch.publishers ?? game.publishers,
        difficulty: patch.semantic.difficulty ?? game.difficulty,
        pace: patch.semantic.pace ?? game.pace,
        narrative: patch.semantic.narrative ?? game.narrative,
        complexity: patch.semantic.complexity ?? game.complexity,
        coziness: patch.semantic.coziness ?? game.coziness,
        strategy: patch.semantic.strategy ?? game.strategy,
        exploration: patch.semantic.exploration ?? game.exploration,
        violence: patch.semantic.violence ?? game.violence,
        horror: patch.semantic.horror ?? game.horror,
        darkness: patch.semantic.darkness ?? game.darkness,
        tension: patch.semantic.tension ?? game.tension,
        humor: patch.semantic.humor ?? game.humor,
        isolation: patch.semantic.isolation ?? game.isolation,
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