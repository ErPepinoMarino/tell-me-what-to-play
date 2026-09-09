import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { resetTestDatabase } from "../helpers/resetTestDatabase.js";
import { startTestServer, type TestServer } from "./startTestServer.js";

let server: TestServer;

describe("GET /api/games E2E", () => {
  beforeAll(async () => {
    server = await startTestServer();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    server.stop();
    await prisma.$disconnect();
  });

  it("returns games from PostgreSQL through the public HTTP route", async () => {
    const persistedGame = await prisma.games.create({
      data: {
        slug: "elden-ring",
        title: "Elden Ring",
        genres: ["SHOOTER", "ROLE_PLAYING_RPG"],
        themes: ["UNKNOWN"],
        platforms: ["PC"],
      },
    });

    const response = await fetch(`${server.baseUrl}/api/games?q=elden`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({
        id: persistedGame.id,
        slug: "elden-ring",
        title: "Elden Ring",
      }),
    ]);
  });

  it("returns 400 when the search query is missing", async () => {
    const response = await fetch(`${server.baseUrl}/api/games`);

    expect(response.status).toBe(400);
  });

  it("returns a game when the slug exists", async () => {
    const persistedGame = await prisma.games.create({
      data: {
        slug: "elden-ring",
        title: "Elden Ring",
        genres: ["SHOOTER", "ROLE_PLAYING_RPG"],
        themes: ["UNKNOWN"],
        platforms: ["PC"],
      },
    });

    const response = await fetch(`${server.baseUrl}/api/games/${persistedGame.slug}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: persistedGame.id,
      slug: "elden-ring",
      title: "Elden Ring",
    });
  });

  it("returns an empty response when the slug does not exist", async () => {
    const response = await fetch(`${server.baseUrl}/api/games/does-not-exist`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe("");
  });

  it("returns 400 when the game slug is invalid", async () => {
    const response = await fetch(`${server.baseUrl}/api/games/Invalid_Slug`);

    expect(response.status).toBe(400);
  });
});
