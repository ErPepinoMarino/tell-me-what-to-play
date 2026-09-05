import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../../src/types/Game.js";

vi.mock("../../src/repositories/prismaGameRepository.js", () => ({
  prismaGameRepository: {
    search: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

//Esto importa el repositorio mockeado, no el real. IMPORTANTE
import { prismaGameRepository } from "../../src/repositories/prismaGameRepository.js";
import { gameService } from "../../src/services/gameService.js";

describe("gameService.search", () => {
  const searchMock = vi.mocked(prismaGameRepository.search);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the repository with "elden" and returns its games', async () => {
    const games: Game[] = [
      {
        id: 1,
        sourceId: null,
        slug: "elden-ring",
        title: "Elden Ring",
        description_es: "An action RPG.",
        description_en: "An action RPG.",
        coverUrl: "https://example.com/elden-ring.jpg",
        releaseYear: 2022,
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
      },
    ];
    searchMock.mockResolvedValue(games);

    //Este es el codigo real que estamos probando, no el mock
    const result = await gameService.search("elden");

    expect(searchMock).toHaveBeenCalledWith("elden");
    expect(result).toEqual(games);
  });
  it("devuelve array vacío", async () => {
    // ARRANGE
    searchMock.mockResolvedValue([]);

    // ACT
    const result = await gameService.search("xyz");

    // ASSERT
    expect(result).toEqual([]);
  });

  it("propaga el error", async () => {
    // ARRANGE
    searchMock.mockRejectedValue(new Error("Database error"));

    // ACT + ASSERT
    await expect(gameService.search("elden")).rejects.toThrow("Database error");
  });
});

describe("gameService semantic attribute validation", () => {
  const createMock = vi.mocked(prismaGameRepository.create);

  const validGame: Game = {
    id: 0,
    sourceId: null,
    slug: "test-game-2020",
    title: "Test Game",
    description_es: "",
    description_en: "",
    coverUrl: "",
    releaseYear: 2020,
    genres: ["UNKNOWN"],
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws RangeError when a semantic attribute is below 0", async () => {
    await expect(
      gameService.create({ ...validGame, difficulty: -0.1 }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("throws RangeError when a semantic attribute exceeds 1", async () => {
    await expect(
      gameService.create({ ...validGame, pace: 1.1 }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("throws RangeError on update when a semantic attribute is out of range", async () => {
    await expect(
      gameService.update({ ...validGame, id: 1, horror: 2 }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("accepts null semantic attributes without throwing", async () => {
    createMock.mockResolvedValue(validGame);
    await expect(gameService.create(validGame)).resolves.toBeDefined();
  });

  it("accepts boundary values 0 and 1 without throwing", async () => {
    const boundaryGame = {
      ...validGame,
      difficulty: 0,
      pace: 1,
      tension: 0,
      humor: 1,
    };
    createMock.mockResolvedValue(boundaryGame);
    await expect(gameService.create(boundaryGame)).resolves.toBeDefined();
  });

  it("accepts intermediate values without throwing", async () => {
    const intermediateGame = {
      ...validGame,
      difficulty: 0.5,
      darkness: 0.75,
      humor: 0.25,
    };
    createMock.mockResolvedValue(intermediateGame);
    await expect(gameService.create(intermediateGame)).resolves.toBeDefined();
  });
});
