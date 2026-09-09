import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "./startTestServer.js";

let server: TestServer;

describe("GET /api/health E2E", () => {
  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(() => {
    server.stop();
  });

  it("returns the backend health status", async () => {
    const response = await fetch(`${server.baseUrl}/api/health`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "Backend funcionando" });
  });
});
