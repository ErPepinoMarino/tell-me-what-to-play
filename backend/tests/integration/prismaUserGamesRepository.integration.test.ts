import { beforeEach, describe, expect, it } from "vitest";
import { prismaUserGamesRepository } from "../../src/repositories/prismaUserGamesRepository.js";
import { prisma } from "../../src/lib/prisma.js";
import { resetTestDatabase } from "../helpers/resetTestDatabase.js";

async function createUserAndGame() {
  const user = await prisma.users.create({
    data: { email: "user@example.com" },
  });
  const game = await prisma.games.create({
    data: {
      slug: "elden-ring",
      title: "Elden Ring",
      genres: ["Action RPG"],
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
          genres: ["Adventure"],
          platforms: ["Switch"],
        },
      }),
      prisma.games.create({
        data: {
          slug: "elden-ring",
          title: "Elden Ring",
          genres: ["Action RPG"],
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
    ).rejects.toThrow("game already in library");
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
