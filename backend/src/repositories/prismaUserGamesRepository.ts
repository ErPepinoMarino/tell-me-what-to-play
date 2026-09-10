import { prisma } from "../lib/prisma.js";
import { toGame } from "./prismaGameRepository.js";
import type { Game } from "../types/Game.js";

type UserGameStatus = "PENDING" | "PLAYED" | "COMPLETED";
type UserGameRecommendation =
  "HIGHLY_RECOMMENDED" | "RECOMMENDED" | "MEH" | "NOT_RECOMMENDED";

type UserGameInput = {
  status?: UserGameStatus | null;
  recommendation?: UserGameRecommendation | null;
  review?: string | null;
};

/*
 * Contrato de la API: el juego embebido viaja en formato dominio (camelCase)
 * como en GET /api/games, no como modelo Prisma crudo (snake_case).
 */
type UserGameEntry = {
  user_id: number;
  game_id: number;
  status: UserGameStatus | null;
  recommendation: UserGameRecommendation | null;
  review: string | null;
  games: Game;
};

type EmbeddedGame = Awaited<ReturnType<typeof prisma.games.findUnique>> & {};

type UserGameRow = {
  user_id: number;
  game_id: number;
  status: UserGameStatus | null;
  recommendation: UserGameRecommendation | null;
  review: string | null;
  games: EmbeddedGame;
};

function toEntry(row: UserGameRow): UserGameEntry {
  return {
    user_id: row.user_id,
    game_id: row.game_id,
    status: row.status,
    recommendation: row.recommendation,
    review: row.review,
    games: toGame(row.games),
  };
}


export const prismaUserGamesRepository = {
  async getByUserId(userId: number) {
    const rows = await prisma.user_games.findMany({
      where: { user_id: userId },
      include: {
        games: true,
      },
      orderBy: {
        games: {
          title: "asc",
        },
      },
    });
    return rows.map(toEntry);
  },

  async getByUserAndGame(userId: number, gameId: number) {
    const row = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: {
          user_id: userId,
          game_id: gameId,
        },
      },
      include: {
        games: true,
      },
    });
    return row ? toEntry(row) : null;
  },

  async add(userId: number, gameId: number, input: UserGameInput = {}) {
    const existing = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: {
          user_id: userId,
          game_id: gameId,
        },
      },
    });
    //miramos si el juego existe en la librería del usuario.
    if (existing) {
      throw new Error("game already in library");
    }
    //Esto puede parecer raro pero es para manejar una race condition.
    //Primero metemos el juego en la libreroia (o lo intentamos con un try)
    try {
      const createdEntry = await prisma.user_games.create({
        data: {
          user_id: userId,
          game_id: gameId,
          status: input.status ?? null,
          recommendation: input.recommendation ?? null,
          review: input.review ?? null,
        },
        include: {
          games: true,
        },
      });
      return toEntry(createdEntry);
    } catch (error) {
      // La clave única (user_id, game_id) es la autoridad de integridad.
      // Prisma/PostgreSQL lanza P2002 (unique violation) que traducimos al error de negocio.
      // Esto quiere decir que ha llegado mas de una request al mismo tiempo y la primera ha creado el registro, la segunda ha fallado.
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw new Error("game already in library", { cause: error });
      }

      throw error;
    }
  },

  async update(userId: number, gameId: number, input: UserGameInput) {
    const updatedEntry = await prisma.user_games.update({
      where: {
        user_id_game_id: {
          user_id: userId,
          game_id: gameId,
        },
      },
      data: {
        status: input.status ?? null,
        recommendation: input.recommendation ?? null,
        review: input.review ?? null,
      },
      include: {
        games: true,
      },
    });
    return toEntry(updatedEntry);
  },

  async remove(userId: number, gameId: number) {
    const removedEntry = await prisma.user_games.delete({
      where: {
        user_id_game_id: {
          user_id: userId,
          game_id: gameId,
        },
      },
      include: {
        games: true,
      },
    });
    return toEntry(removedEntry);
  },
};
