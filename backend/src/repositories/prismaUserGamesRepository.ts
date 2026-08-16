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

    if (existing) {
      throw new Error("game already in library");
    }

    return prisma.user_games.create({
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
