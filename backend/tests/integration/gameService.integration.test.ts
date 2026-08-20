import { beforeEach, describe, expect, it } from "vitest";
import { gameService } from "../../src/services/gameService.js";
import { prisma } from "../../src/lib/prisma.js";
import { resetTestDatabase } from "../helpers/resetTestDatabase.js";

describe("gameService.search integration", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('searches the real test database for "elden"', async () => {
    await prisma.games.create({
      data: {
        slug: "elden-ring",
        title: "Elden Ring",
        genres: ["Action RPG"],
        platforms: ["PC"],
      },
    });

    const result = await gameService.search("elden");

    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Elden Ring");
    expect(result[0]?.slug).toBe("elden-ring");
  });

  it('searches case-insensitively for "ELDEN"', async () => {
    await prisma.games.create({
      data: {
        slug: "elden-ring",
        title: "Elden Ring",
        genres: ["Action RPG"],
        platforms: ["PC"],
      },
    });

    const result = await gameService.search("ELDEN");

    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Elden Ring");
  });

  it("returns all matching games", async () => {
    await prisma.games.createMany({
      data: [
        {
          slug: "elden-ring",
          title: "Elden Ring",
          genres: ["Action RPG"],
          platforms: ["PC"],
        },
        {
          slug: "elden-ring-nightreign",
          title: "Elden Ring Nightreign",
          genres: ["Action RPG"],
          platforms: ["PC"],
        },
        {
          slug: "skyrim",
          title: "Skyrim",
          genres: ["Action RPG"],
          platforms: ["PC"],
        },
      ],
    });

    const result = await gameService.search("elden");
    const titles = result.map((game) => game.title);

    expect(result).toHaveLength(2);
    expect(titles).toContain("Elden Ring");
    expect(titles).toContain("Elden Ring Nightreign");
    expect(titles).not.toContain("Skyrim");
  });

  it("returns an empty array when no games match", async () => {
    await prisma.games.create({
      data: {
        slug: "elden-ring",
        title: "Elden Ring",
        genres: ["Action RPG"],
        platforms: ["PC"],
      },
    });

    const result = await gameService.search("zelda");

    expect(result).toEqual([]);
  });
});
