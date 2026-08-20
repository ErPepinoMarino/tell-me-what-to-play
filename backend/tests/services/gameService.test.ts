import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../../src/types/Game.js";

vi.mock("../../src/repositories/prismaGameRepository.js", () => ({
  prismaGameRepository: {
    search: vi.fn(),
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
        slug: "elden-ring",
        title: "Elden Ring",
        description: "An action RPG.",
        coverUrl: "https://example.com/elden-ring.jpg",
        releaseYear: 2022,
        genres: ["Action RPG"],
        platforms: ["PC"],
        rating: 9.5,
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
