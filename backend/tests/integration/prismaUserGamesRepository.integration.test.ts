import { beforeEach, describe, expect, it } from "vitest";
import { prismaUserGamesRepository } from "../../src/repositories/prismaUserGamesRepository.js";
import { prisma } from "../../src/lib/prisma.js";
import { GameAlreadyInLibraryError } from "../../src/errors/userGamesErrors.js";
import { resetTestDatabase } from "../helpers/resetTestDatabase.js";

async function createUserAndGame() {
  const user = await prisma.users.create({
    data: { email: "user@example.com" },
  });
  const game = await prisma.games.create({
    data: {
      slug: "elden-ring",
      title: "Elden Ring",
      genres: ["SHOOTER", "ROLE_PLAYING_RPG"],
      themes: ["UNKNOWN"],
      platforms: ["PC"],
    },
  });

  return { user, game };
}

describe("prismaUserGamesRepository integration", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("adds and retrieves a game from a user's library", async () => {
    const { user, game } = await createUserAndGame();

    const added = await prismaUserGamesRepository.add(user.id, game.id, {
      status: "PENDING",
      recommendation: "RECOMMENDED",
      review: "Worth playing",
    });
    const found = await prismaUserGamesRepository.getByUserAndGame(
      user.id,
      game.id,
    );

    expect(added.status).toBe("PENDING");
    expect(added.recommendation).toBe("RECOMMENDED");
    expect(added.review).toBe("Worth playing");
    expect(found?.user_id).toBe(user.id);
    expect(found?.game_id).toBe(game.id);
    expect(found?.games.title).toBe("Elden Ring");
  });

  it("returns a user's games ordered by title", async () => {
    const user = await prisma.users.create({
      data: { email: "user@example.com" },
    });
    const [zelda, elden] = await Promise.all([
      prisma.games.create({
        data: {
          slug: "zelda",
          title: "Zelda",
            genres: ["ADVENTURE"],
          themes: ["UNKNOWN"],
          platforms: ["SWITCH"],
        },
      }),
      prisma.games.create({
        data: {
          slug: "elden-ring",
          title: "Elden Ring",
            genres: ["SHOOTER", "ROLE_PLAYING_RPG"],
          themes: ["UNKNOWN"],
          platforms: ["PC"],
        },
      }),
    ]);

    await prisma.user_games.createMany({
      data: [
        { user_id: user.id, game_id: zelda.id },
        { user_id: user.id, game_id: elden.id },
      ],
    });

    const result = await prismaUserGamesRepository.getByUserId(user.id);

    expect(result.map((entry) => entry.games.title)).toEqual([
      "Elden Ring",
      "Zelda",
    ]);
  });

  it("returns null when a user-game entry does not exist", async () => {
    const { user, game } = await createUserAndGame();

    const result = await prismaUserGamesRepository.getByUserAndGame(
      user.id,
      game.id,
    );

    expect(result).toBeNull();
  });

  it("rejects adding a duplicate user-game entry", async () => {
    const { user, game } = await createUserAndGame();
    await prismaUserGamesRepository.add(user.id, game.id);

    await expect(
      prismaUserGamesRepository.add(user.id, game.id),
    ).rejects.toBeInstanceOf(GameAlreadyInLibraryError);
  });

  it("races two concurrent adds and keeps a single entry", async () => {
    const { user, game } = await createUserAndGame();

    // Simulamos dos requests simultáneas: la clave única (user_id, game_id)
    // decide el ganador y el perdedor debe recibir el error tipado (bien por
    // el pre-check, bien por la violación P2002 en la carrera).
    const results = await Promise.allSettled([
      prismaUserGamesRepository.add(user.id, game.id),
      prismaUserGamesRepository.add(user.id, game.id),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(GameAlreadyInLibraryError);

    const rows = await prisma.user_games.findMany({
      where: { user_id: user.id, game_id: game.id },
    });
    expect(rows).toHaveLength(1);
  });

  it("updates a user's game entry", async () => {
    const { user, game } = await createUserAndGame();
    await prismaUserGamesRepository.add(user.id, game.id);

    const result = await prismaUserGamesRepository.update(user.id, game.id, {
      status: "COMPLETED",
      recommendation: "HIGHLY_RECOMMENDED",
      review: "Finished",
    });
    const persisted = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: { user_id: user.id, game_id: game.id },
      },
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.recommendation).toBe("HIGHLY_RECOMMENDED");
    expect(result.review).toBe("Finished");
    expect(persisted).toMatchObject({
      status: "COMPLETED",
      recommendation: "HIGHLY_RECOMMENDED",
      review: "Finished",
    });
  });

  it("removes a user's game entry", async () => {
    const { user, game } = await createUserAndGame();
    await prismaUserGamesRepository.add(user.id, game.id);

    const removed = await prismaUserGamesRepository.remove(user.id, game.id);
    const persisted = await prisma.user_games.findUnique({
      where: {
        user_id_game_id: { user_id: user.id, game_id: game.id },
      },
    });

    expect(removed.user_id).toBe(user.id);
    expect(removed.game_id).toBe(game.id);
    expect(persisted).toBeNull();
  });
});
