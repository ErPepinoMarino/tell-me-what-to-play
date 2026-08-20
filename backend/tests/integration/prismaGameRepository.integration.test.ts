import { beforeEach, describe, expect, it } from "vitest";
import { prismaGameRepository } from "../../src/repositories/prismaGameRepository.js";
import { prisma } from "../../src/lib/prisma.js";
import { resetTestDatabase } from "../helpers/resetTestDatabase.js";
import type { Game } from "../../src/types/Game.js";

describe("prismaGameRepository.getBySlug integration", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("returns a game when the slug exists", async () => {
    await prisma.games.create({
      data: {
        slug: "elden-ring",
        title: "Elden Ring",
        genres: ["Action RPG"],
        platforms: ["PC"],
      },
    });

    const result = await prismaGameRepository.getBySlug("elden-ring");

    expect(result).toMatchObject({
      slug: "elden-ring",
      title: "Elden Ring",
    });
  });

  it("returns all persisted games", async () => {
    await prisma.games.createMany({
      data: [
        {
          slug: "elden-ring",
          title: "Elden Ring",
          genres: ["Action RPG"],
          platforms: ["PC"],
        },
        {
          slug: "hades",
          title: "Hades",
          genres: ["Action"],
          platforms: ["PC"],
        },
      ],
    });

    const result = await prismaGameRepository.getAll();

    expect(result).toHaveLength(2);
    expect(result.map((game) => game.slug)).toEqual(
      expect.arrayContaining(["elden-ring", "hades"]),
    );
  });

  it("returns the expected empty value when the slug does not exist", async () => {
    const result = await prismaGameRepository.getBySlug("does-not-exist");

    expect(result).toBeUndefined();
  });

  it("finds a game by partial title match", async () => {
    await prisma.games.create({
      data: {
        slug: "elden-ring",
        title: "Elden Ring",
        genres: ["Action RPG"],
        platforms: ["PC"],
      },
    });

    const result = await prismaGameRepository.search("elden");

    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Elden Ring");
  });

  it("creates and returns a game", async () => {
    const game: Game = {
      id: 0,
      slug: "hades",
      title: "Hades",
      description: "A rogue-like dungeon crawler.",
      coverUrl: "https://example.com/hades.jpg",
      releaseYear: 2020,
      genres: ["Action", "Roguelike"],
      platforms: ["PC"],
      rating: 9.0,
    };

    const result = await prismaGameRepository.create(game);
    const persistedGame = await prisma.games.findUnique({
      where: { slug: game.slug },
    });

    expect(result).toMatchObject({
      slug: game.slug,
      title: game.title,
      description: game.description,
      coverUrl: game.coverUrl,
      releaseYear: game.releaseYear,
      genres: game.genres,
      platforms: game.platforms,
      rating: game.rating,
    });
    expect(result.id).toBeGreaterThan(0);

    expect(persistedGame).toMatchObject({
      slug: game.slug,
      title: game.title,
      description: game.description,
      cover_url: game.coverUrl,
      release_year: game.releaseYear,
      genres: game.genres,
      platforms: game.platforms,
    });
    expect(Number(persistedGame?.rating)).toBe(game.rating);
  });

  it("updates and persists a game", async () => {
    const createdGame = await prisma.games.create({
      data: {
        slug: "hades",
        title: "Hades",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });

    const updatedGame: Game = {
      id: createdGame.id,
      slug: "hades-ii",
      title: "Hades II",
      description: "A sequel.",
      coverUrl: "https://example.com/hades-ii.jpg",
      releaseYear: 2024,
      genres: ["Action", "Roguelike"],
      platforms: ["PC", "Nintendo Switch"],
      rating: 9.2,
    };

    const result = await prismaGameRepository.update(updatedGame);
    const persistedGame = await prisma.games.findUnique({
      where: { id: createdGame.id },
    });

    expect(result).toMatchObject(updatedGame);
    expect(persistedGame).toMatchObject({
      id: createdGame.id,
      slug: updatedGame.slug,
      title: updatedGame.title,
      description: updatedGame.description,
      cover_url: updatedGame.coverUrl,
      release_year: updatedGame.releaseYear,
      genres: updatedGame.genres,
      platforms: updatedGame.platforms,
    });
    expect(Number(persistedGame?.rating)).toBe(updatedGame.rating);
  });

  it("deletes a game and removes it from the database", async () => {
    const createdGame = await prisma.games.create({
      data: {
        slug: "hades",
        title: "Hades",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });

    await expect(
      prismaGameRepository.delete(createdGame.id),
    ).resolves.toBeUndefined();

    const persistedGame = await prisma.games.findUnique({
      where: { id: createdGame.id },
    });

    expect(persistedGame).toBeNull();
  });

  it("propagates the unique slug constraint error", async () => {
    await prisma.games.create({
      data: {
        slug: "hades",
        title: "Hades",
        genres: ["Action"],
        platforms: ["PC"],
      },
    });

    const duplicateGame: Game = {
      id: 0,
      slug: "hades",
      title: "Another Hades",
      description: "A duplicate slug.",
      coverUrl: "https://example.com/another-hades.jpg",
      releaseYear: 2020,
      genres: ["Action"],
      platforms: ["PC"],
      rating: 8.0,
    };

    await expect(
      prismaGameRepository.create(duplicateGame),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
