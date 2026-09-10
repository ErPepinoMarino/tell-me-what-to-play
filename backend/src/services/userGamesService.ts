import { prismaGameRepository } from "../repositories/prismaGameRepository.js";
import { prismaUserRepository } from "../repositories/prismaUserRepository.js";
import { prismaUserGamesRepository } from "../repositories/prismaUserGamesRepository.js";
import type { Role } from "../generated/prisma/enums.js";
import {
  UserNotFoundError,
  GameNotFoundError,
  GameNotInLibraryError,
  GameAlreadyInLibraryError,
} from "../errors/userGamesErrors.js";

async function getUserRole(userId: number): Promise<Role> {
  const role = await prismaUserRepository.getRoleById(userId);

  if (!role) {
    throw new UserNotFoundError();
  }

  return role;
}

const ensureGameExists = async (gameId: number) => {
  const game = await prismaGameRepository.getById(gameId);

  if (!game) {
    throw new GameNotFoundError();
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
    throw new UserNotFoundError();
  }
};

export const userGamesService = {
  async getLibrary(actorUserId: number, targetUserId: number) {
    const actorRole = await getUserRole(actorUserId);
    ensureLibraryAccess(actorRole, actorUserId, targetUserId);

    return prismaUserGamesRepository.getByUserId(targetUserId);
  },

  async addToLibrary(
    actorUserId: number,
    targetUserId: number,
    gameId: number,
  ) {
    const [actorRole] = await Promise.all([
      getUserRole(actorUserId),
      ensureGameExists(gameId),
    ]);
    ensureLibraryAccess(actorRole, actorUserId, targetUserId);

    const existing = await prismaUserGamesRepository.getByUserAndGame(
      targetUserId,
      gameId,
    );

    if (existing) {
      throw new GameAlreadyInLibraryError();
    }

    return prismaUserGamesRepository.add(targetUserId, gameId, {
      status: "PENDING",
    });
  },

  async updateLibraryEntry(
    actorUserId: number,
    targetUserId: number,
    gameId: number,
    input: {
      status?: "PENDING" | "PLAYED" | "COMPLETED" | null;
      recommendation?:
        "HIGHLY_RECOMMENDED" | "RECOMMENDED" | "MEH" | "NOT_RECOMMENDED" | null;
      review?: string | null;
    },
  ) {
    const [actorRole] = await Promise.all([
      getUserRole(actorUserId),
      ensureGameExists(gameId),
    ]);
    ensureLibraryAccess(actorRole, actorUserId, targetUserId);

    const entry = await prismaUserGamesRepository.getByUserAndGame(
      targetUserId,
      gameId,
    );

    if (!entry) {
      throw new GameNotInLibraryError();
    }

    return prismaUserGamesRepository.update(targetUserId, gameId, input);
  },

  async removeFromLibrary(
    actorUserId: number,
    targetUserId: number,
    gameId: number,
  ) {
    const [actorRole] = await Promise.all([
      getUserRole(actorUserId),
      ensureGameExists(gameId),
    ]);
    ensureLibraryAccess(actorRole, actorUserId, targetUserId);

    const entry = await prismaUserGamesRepository.getByUserAndGame(
      targetUserId,
      gameId,
    );

    if (!entry) {
      throw new GameNotInLibraryError();
    }

    return prismaUserGamesRepository.remove(targetUserId, gameId);
  },
};
