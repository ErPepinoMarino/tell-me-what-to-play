import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const baseUrl = "http://127.0.0.1:3001";
let serverProcess: ChildProcess;

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

describe("GET /api/health E2E", () => {
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

  afterAll(() => {
    serverProcess.kill();
  });

  it("returns the backend health status", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "Backend funcionando" });
  });
});
