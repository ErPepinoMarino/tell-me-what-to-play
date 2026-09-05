import { beforeEach, describe, expect, it } from "vitest";
import { prismaGameRepository } from "../../src/repositories/prismaGameRepository.js";
import { prisma } from "../../src/lib/prisma.js";
import { resetTestDatabase } from "../helpers/resetTestDatabase.js";
import type { Game, GameToPersist } from "../../src/types/Game.js";
import type {
  GameMode,
  Perspective,
} from "../../src/generated/prisma/enums.js";

const defaults = {
  game_modes: ["UNKNOWN"] as GameMode[],
  perspectives: ["UNKNOWN"] as Perspective[],
  developers: [] as string[],
  publishers: [] as string[],
  search_count: 0,
};

describe("prismaGameRepository", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("returns a game by slug", async () => {
    await prisma.games.create({
      data: {
        ...defaults,
        slug: "elden-ring-2022",
        title: "Elden Ring",
        genres: ["SHOOTER"],
        themes: ["UNKNOWN"],
        platforms: ["PC"],
      },
    });

    const result = await prismaGameRepository.getBySlug("elden-ring-2022");

    expect(result).toMatchObject({
      slug: "elden-ring-2022",
      title: "Elden Ring",
    });
  });

  it("returns all persisted games", async () => {
    await prisma.games.createMany({
      data: [
        {
          ...defaults,
          slug: "elden-ring-2022",
          title: "Elden Ring",
          genres: ["SHOOTER"],
          themes: ["UNKNOWN"],
          platforms: ["PC"],
        },
        {
          ...defaults,
          slug: "hades-2020",
          title: "Hades",
          genres: ["SHOOTER"],
          themes: ["UNKNOWN"],
          platforms: ["PC"],
        },
      ],
    });

    const result = await prismaGameRepository.getAll();

    expect(result).toHaveLength(2);
    expect(result.map((game) => game.slug)).toEqual(
      expect.arrayContaining(["elden-ring-2022", "hades-2020"]),
    );
  });

  it("returns undefined for an unknown slug", async () => {
    await expect(
      prismaGameRepository.getBySlug("does-not-exist"),
    ).resolves.toBeUndefined();
  });

  it("searches by partial title", async () => {
    await prisma.games.create({
      data: {
        ...defaults,
        slug: "elden-ring-2022",
        title: "Elden Ring",
        genres: ["SHOOTER"],
        themes: ["UNKNOWN"],
        platforms: ["PC"],
      },
    });

    const result = await prismaGameRepository.search("elden");

    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Elden Ring");
  });

  it("creates and returns an objective game", async () => {
    const game: Game = {
      id: 0,
      sourceId: null,
      slug: "hades-2020",
      title: "Hades",
      description_es: "A rogue-like dungeon crawler.",
      description_en: "A rogue-like dungeon crawler.",
      coverUrl: "https://example.com/hades.jpg",
      releaseYear: 2020,
      genres: ["SHOOTER"],

      themes: ["UNKNOWN"],

      platforms: ["PC"],
      gameModes: ["UNKNOWN"],
      perspectives: ["UNKNOWN"],
      developers: [],
      publishers: [],
      keywords: [],
      searchCount: 0,
      difficulty: null,
      pace: null,
      narrative: null,
      complexity: null,
      strategy: null,
      exploration: null,
      violence: null,
      horror: null,
      darkness: null,
      tension: null,
      humor: null,
      isolation: null,
      coziness: null,
    };

    const result = await prismaGameRepository.create(game);
    const persistedGame = await prisma.games.findUnique({
      where: { slug: game.slug },
    });

    expect(result).toEqual({ ...game, id: expect.any(Number) });
    expect(persistedGame).toMatchObject({
      slug: game.slug,
      genres: ["SHOOTER"],
      themes: ["UNKNOWN"],
      platforms: ["PC"],
      game_modes: ["UNKNOWN"],
      perspectives: ["UNKNOWN"],
      developers: [],
      publishers: [],
      keywords: [],
      search_count: 0,
    });
  });

  it("creates a game from GameToPersist (importer path): BDD assigns id and search_count", async () => {
    const game: GameToPersist = {
      sourceId: "53354",
      slug: "elden-ring-2022",
      title: "Elden Ring",
      description_es: null,
      description_en: null,
      coverUrl:
        "https://images.igdb.com/igdb/image/upload/t_cover_big/coXXYY.jpg",
      releaseYear: 2022,
      genres: ["SHOOTER", "ROLE_PLAYING_RPG"],
      themes: ["UNKNOWN"],
      platforms: ["PC", "PS5"],
      gameModes: ["SINGLE_PLAYER"],
      perspectives: ["THIRD_PERSON"],
      keywords: ["open world", "souls-like"],
      developers: ["FromSoftware"],
      publishers: ["Bandai Namco"],
      difficulty: null,
      pace: null,
      narrative: null,
      complexity: null,
      coziness: null,
      strategy: null,
      exploration: null,
      violence: null,
      horror: null,
      darkness: null,
      tension: null,
      humor: null,
      isolation: null,
    };

    const result = await prismaGameRepository.create(game);

    // id y search_count los genera PostgreSQL
    expect(result.id).toEqual(expect.any(Number));
    expect(result.searchCount).toBe(0);
    expect(result).toMatchObject({
      slug: game.slug,
      title: game.title,
      releaseYear: 2022,
      genres: ["SHOOTER", "ROLE_PLAYING_RPG"],
      keywords: ["open world", "souls-like"],
    });

    // description_es/description_en se persisten como null (toGame las expone como string vacio)
    const persisted = await prisma.games.findUnique({
      where: { slug: game.slug },
    });
    expect(persisted?.description_es).toBeNull();
    expect(persisted?.description_en).toBeNull();

    // getBySlug permite al ImportService detectar colisiones de slug
    const found = await prismaGameRepository.getBySlug("elden-ring-2022");
    expect(found?.id).toBe(result.id);
  });
  it("updates and persists a game", async () => {
    const createdGame = await prisma.games.create({
      data: {
        ...defaults,
        slug: "hades-2020",
        title: "Hades",
        genres: ["SHOOTER"],
        themes: ["UNKNOWN"],
        platforms: ["PC"],
      },
    });
    const updatedGame: Game = {
      id: createdGame.id,
      sourceId: null,
      slug: "hades-ii-2024",
      title: "Hades II",
      description_es: "A sequel.",
      description_en: "A sequel.",
      coverUrl: "https://example.com/hades-ii.jpg",
      releaseYear: 2024,
      genres: ["SHOOTER"],

      themes: ["UNKNOWN"],

      platforms: ["PC", "SWITCH"],
      gameModes: ["UNKNOWN"],
      perspectives: ["UNKNOWN"],
      developers: [],
      publishers: [],
      keywords: [],
      searchCount: 0,
      difficulty: null,
      pace: null,
      narrative: null,
      complexity: null,
      strategy: null,
      exploration: null,
      violence: null,
      horror: null,
      darkness: null,
      tension: null,
      humor: null,
      isolation: null,
      coziness: null,
    };

    const result = await prismaGameRepository.update(updatedGame);

    expect(result).toEqual(updatedGame);
  });

  it("allows the same title in different years", async () => {
    const first = await prisma.games.create({
      data: {
        ...defaults,
        slug: "example-1998",
        title: "Example",
        release_year: 1998,
        genres: ["UNKNOWN"],
        themes: ["UNKNOWN"],
        platforms: ["UNKNOWN"],
      },
    });
    const second = await prisma.games.create({
      data: {
        ...defaults,
        slug: "example-2024",
        title: "Example",
        release_year: 2024,
        genres: ["UNKNOWN"],
        themes: ["UNKNOWN"],
        platforms: ["UNKNOWN"],
      },
    });

    expect(first.slug).not.toBe(second.slug);
    await expect(
      prisma.games.findMany({ where: { title: "Example" } }),
    ).resolves.toHaveLength(2);
  });

  it("deletes a game", async () => {
    const createdGame = await prisma.games.create({
      data: {
        ...defaults,
        slug: "hades-2020",
        title: "Hades",
        genres: ["SHOOTER"],
        themes: ["UNKNOWN"],
        platforms: ["PC"],
      },
    });

    await expect(
      prismaGameRepository.delete(createdGame.id),
    ).resolves.toBeUndefined();
    await expect(
      prisma.games.findUnique({ where: { id: createdGame.id } }),
    ).resolves.toBeNull();
  });

  it("propagates duplicate slug errors", async () => {
    await prisma.games.create({
      data: {
        ...defaults,
        slug: "hades-2020",
        title: "Hades",
        genres: ["SHOOTER"],
        themes: ["UNKNOWN"],
        platforms: ["PC"],
      },
    });
    const duplicateGame: Game = {
      id: 0,
      sourceId: null,
      slug: "hades-2020",
      title: "Another Hades",
      description_es: "A duplicate slug.",
      description_en: "A duplicate slug.",
      coverUrl: "https://example.com/another-hades.jpg",
      releaseYear: 2020,
      genres: ["SHOOTER"],

      themes: ["UNKNOWN"],

      platforms: ["PC"],
      gameModes: ["UNKNOWN"],
      perspectives: ["UNKNOWN"],
      developers: [],
      publishers: [],
      keywords: [],
      searchCount: 0,
      difficulty: null,
      pace: null,
      narrative: null,
      complexity: null,
      strategy: null,
      exploration: null,
      violence: null,
      horror: null,
      darkness: null,
      tension: null,
      humor: null,
      isolation: null,
      coziness: null,
    };

    await expect(
      prismaGameRepository.create(duplicateGame),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  describe("semantic attributes", () => {
    beforeEach(async () => {
      await resetTestDatabase();
    });

    it("returns null for all semantic attributes when none are set", async () => {
      await prisma.games.create({
        data: {
          ...defaults,
          slug: "elden-ring-2022",
          title: "Elden Ring",
          genres: ["SHOOTER"],
          themes: ["UNKNOWN"],
          platforms: ["PC"],
        },
      });

      const result = await prismaGameRepository.getBySlug("elden-ring-2022");

      expect(result?.difficulty).toBeNull();
      expect(result?.pace).toBeNull();
      expect(result?.narrative).toBeNull();
      expect(result?.complexity).toBeNull();
      expect(result?.strategy).toBeNull();
      expect(result?.exploration).toBeNull();
      expect(result?.violence).toBeNull();
      expect(result?.horror).toBeNull();
      expect(result?.darkness).toBeNull();
      expect(result?.tension).toBeNull();
      expect(result?.humor).toBeNull();
      expect(result?.isolation).toBeNull();
    });

    it("persists and reads all twelve semantic attribute values", async () => {
      const game: Game = {
        id: 0,
        sourceId: null,
        slug: "hades-2020",
        title: "Hades",
        description_es: "Action roguelite.",
        description_en: "Action roguelite.",
        coverUrl: "https://example.com/hades.jpg",
        releaseYear: 2020,
        genres: ["SHOOTER"],

        themes: ["UNKNOWN"],

        platforms: ["PC"],
        gameModes: ["UNKNOWN"],
        perspectives: ["UNKNOWN"],
        developers: [],
        publishers: [],
        keywords: [],
        searchCount: 0,
        difficulty: 0.8,
        pace: 0.7,
        narrative: 0.2,
        complexity: 0.5,
        strategy: 0.3,
        exploration: 0.4,
        violence: 0.6,
        horror: 0.1,
        darkness: 0.5,
        tension: 0.7,
        humor: 0.1,
        isolation: 0.4,
        coziness: null,
      };

      const created = await prismaGameRepository.create(game);

      expect(created.difficulty).toBe(0.8);
      expect(created.pace).toBe(0.7);
      expect(created.narrative).toBe(0.2);
      expect(created.complexity).toBe(0.5);
      expect(created.strategy).toBe(0.3);
      expect(created.exploration).toBe(0.4);
      expect(created.violence).toBe(0.6);
      expect(created.horror).toBe(0.1);
      expect(created.darkness).toBe(0.5);
      expect(created.tension).toBe(0.7);
      expect(created.humor).toBe(0.1);
      expect(created.isolation).toBe(0.4);

      const read = await prismaGameRepository.getBySlug(game.slug);
      expect(read?.difficulty).toBe(0.8);
      expect(read?.isolation).toBe(0.4);
    });

    it("accepts the boundary values 0 and 1", async () => {
      const game: Game = {
        id: 0,
        sourceId: null,
        slug: "portal-2-2011",
        title: "Portal 2",
        description_es: "Puzzle.",
        description_en: "Puzzle.",
        coverUrl: "https://example.com/portal.jpg",
        releaseYear: 2011,
        genres: ["PUZZLE"],

        themes: ["UNKNOWN"],

        platforms: ["PC"],
        gameModes: ["UNKNOWN"],
        perspectives: ["UNKNOWN"],
        developers: [],
        publishers: [],
        keywords: [],
        searchCount: 0,
        difficulty: 0,
        pace: 1,
        narrative: 0,
        complexity: 1,
        strategy: 0,
        exploration: 0,
        violence: 0,
        horror: 0,
        darkness: 0,
        tension: 1,
        humor: 1,
        isolation: 0,
        coziness: null,
      };

      const created = await prismaGameRepository.create(game);
      expect(created.difficulty).toBe(0);
      expect(created.pace).toBe(1);
      expect(created.humor).toBe(1);
      expect(created.tension).toBe(1);
    });

    it("persists an update to semantic attribute values", async () => {
      const base = await prisma.games.create({
        data: {
          ...defaults,
          slug: "celeste-2018",
          title: "Celeste",
          genres: ["PLATFORM"],
          themes: ["UNKNOWN"],
          platforms: ["PC"],
        },
      });

      const updated = await prismaGameRepository.update({
        id: base.id,
        sourceId: null,
        slug: "celeste-2018",
        title: "Celeste",
        description_es: "",
        description_en: "",
        coverUrl: "",
        releaseYear: 2018,
        genres: ["PLATFORM"],

        themes: ["UNKNOWN"],

        platforms: ["PC"],
        gameModes: ["UNKNOWN"],
        perspectives: ["UNKNOWN"],
        developers: [],
        publishers: [],
        keywords: [],
        searchCount: 0,
        difficulty: 0.75,
        pace: 0.6,
        narrative: 0.5,
        complexity: 0.4,
        strategy: 0.2,
        exploration: 0.3,
        violence: 0,
        horror: 0,
        darkness: 0.4,
        tension: 0.8,
        humor: 0.3,
        isolation: 0.5,
        coziness: null,
      });

      expect(updated.difficulty).toBe(0.75);
      expect(updated.tension).toBe(0.8);
    });
  });
});
