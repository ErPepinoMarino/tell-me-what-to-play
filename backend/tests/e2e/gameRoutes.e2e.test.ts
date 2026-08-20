import { spawn, type ChildProcess } from "node:child_process";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { resetTestDatabase } from "../helpers/resetTestDatabase.js";

const baseUrl = "http://127.0.0.1:3001";
let serverProcess: ChildProcess;

//esperamos que arranque el server
async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Backend server did not start within 10 seconds");
}

describe("GET /api/games E2E", () => {
  beforeAll(async () => {
    serverProcess = spawn(
      process.execPath,
      ["--import", "tsx/esm", "src/server.ts"],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: "ignore",
      },
    );

    await waitForServer();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    serverProcess.kill();
    await prisma.$disconnect();
  });

  it("returns games from PostgreSQL through the public HTTP route", async () => {
    const persistedGame = await prisma.games.create({
      data: {
        slug: "elden-ring",
        title: "Elden Ring",
        genres: ["Action RPG"],
        platforms: ["PC"],
      },
    });

    const response = await fetch(`${baseUrl}/api/games?q=elden`);
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
    const response = await fetch(`${baseUrl}/api/games`);

    expect(response.status).toBe(400);
  });

  it("returns a game when the slug exists", async () => {
    const persistedGame = await prisma.games.create({
      data: {
        slug: "elden-ring",
        title: "Elden Ring",
        genres: ["Action RPG"],
        platforms: ["PC"],
      },
    });

    const response = await fetch(`${baseUrl}/api/games/${persistedGame.slug}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: persistedGame.id,
      slug: "elden-ring",
      title: "Elden Ring",
    });
  });

  it("returns an empty response when the slug does not exist", async () => {
    const response = await fetch(`${baseUrl}/api/games/does-not-exist`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe("");
  });

  it("returns 400 when the game slug is invalid", async () => {
    const response = await fetch(`${baseUrl}/api/games/Invalid_Slug`);

    expect(response.status).toBe(400);
  });
});
