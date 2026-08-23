import { prisma } from "../lib/prisma.js";

type UserGameStatus = "PENDING" | "PLAYED" | "COMPLETED";
type UserGameRecommendation =
  "HIGHLY_RECOMMENDED" | "RECOMMENDED" | "MEH" | "NOT_RECOMMENDED";

type UserGameInput = {
  status?: UserGameStatus | null;
  recommendation?: UserGameRecommendation | null;
  review?: string | null;
};

export const prismaUserGamesRepository = {
  async getByUserId(userId: number) {
    return prisma.user_games.findMany({
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
  },

  async getByUserAndGame(userId: number, gameId: number) {
    return prisma.user_games.findUnique({
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
      return await prisma.user_games.create({
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
    return prisma.user_games.update({
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
  },

  async remove(userId: number, gameId: number) {
    return prisma.user_games.delete({
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
  },
};
