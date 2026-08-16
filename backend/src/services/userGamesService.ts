import { Role } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { prismaUserGamesRepository } from "../repositories/prismaUserGamesRepository.js";

const ensureGameExists = async (gameId: number) => {
  const game = await prisma.games.findUnique({
    where: { id: gameId },
  });

  if (!game) {
    throw new Error("game not found");
  }

  return game;
};

const ensureLibraryAccess = (
  actorRole: Role,
  actorUserId: number,
  targetUserId: number,
) => {
  if (actorRole === "ADMIN") {
    return;
  }

  if (actorUserId !== targetUserId) {
    throw new Error("not found");
  }
};

export const userGamesService = {
  async getLibrary(actorUserId: number, actorRole: Role, targetUserId: number) {
    ensureLibraryAccess(actorRole, actorUserId, targetUserId);

    return prismaUserGamesRepository.getByUserId(targetUserId);
  },

  async addToLibrary(
    actorUserId: number,
    actorRole: Role,
    targetUserId: number,
    gameId: number,
  ) {
    ensureGameExists(gameId);
    ensureLibraryAccess(actorRole, actorUserId, targetUserId);

    const existing = await prismaUserGamesRepository.getByUserAndGame(
      targetUserId,
      gameId,
    );

    if (existing) {
      throw new Error("game already in library");
    }

    return prismaUserGamesRepository.add(targetUserId, gameId, {
      status: "PENDING",
    });
  },

  async updateLibraryEntry(
    actorUserId: number,
    actorRole: Role,
    targetUserId: number,
    gameId: number,
    input: {
      status?: "PENDING" | "PLAYED" | "COMPLETED" | null;
      recommendation?:
        "HIGHLY_RECOMMENDED" | "RECOMMENDED" | "MEH" | "NOT_RECOMMENDED" | null;
      review?: string | null;
    },
  ) {
    ensureGameExists(gameId);
    ensureLibraryAccess(actorRole, actorUserId, targetUserId);

    const entry = await prismaUserGamesRepository.getByUserAndGame(
      targetUserId,
      gameId,
    );

    if (!entry) {
      throw new Error("game not in library");
    }

    return prismaUserGamesRepository.update(targetUserId, gameId, input);
  },

  async removeFromLibrary(
    actorUserId: number,
    actorRole: Role,
    targetUserId: number,
    gameId: number,
  ) {
    ensureGameExists(gameId);
    ensureLibraryAccess(actorRole, actorUserId, targetUserId);

    const entry = await prismaUserGamesRepository.getByUserAndGame(
      targetUserId,
      gameId,
    );

    if (!entry) {
      throw new Error("game not in library");
    }

    return prismaUserGamesRepository.remove(targetUserId, gameId);
  },
};
