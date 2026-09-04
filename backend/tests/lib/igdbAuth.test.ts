import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpClient, HttpResponse } from "../../src/igdb/types.js";
import { IgdbAuth } from "../../src/igdb/auth.js";
import { IgdbAuthError } from "../../src/igdb/errors.js";

// Con los comentarios de igdbClient.test.ts, he añadido explicaciones a cada test para que sea más fácil de entender.
class FakeHttpClient implements HttpClient {
  public calls: { url: string; body: string; headers: HeadersInit }[] = [];

  constructor(private responses: HttpResponse[]) {}

  async post(
    url: string,
    body: string,
    headers: HeadersInit,
  ): Promise<HttpResponse> {
    this.calls.push({ url, body, headers });
    const response = this.responses.shift();
    if (!response) {
      throw new Error("FakeHttpClient: no more queued responses");
    }
    return response;
  }
}

function jsonResponse(status: number, data: unknown): HttpResponse {
  return { status, json: async () => data };
}

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";

function tokenResponse(expiresIn = 7200): HttpResponse {
  return jsonResponse(200, {
    access_token: "token-abc",
    expires_in: expiresIn,
  });
}

describe("IgdbAuth", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("requests a token when none is cached, hitting the Twitch OAuth endpoint with credentials", async () => {
    const http = new FakeHttpClient([tokenResponse()]);
    const auth = new IgdbAuth("my-client-id", "my-secret", http);

    const token = await auth.getAccessToken();

    expect(token).toBe("token-abc");
    expect(http.calls).toHaveLength(1);
    const { url } = http.calls[0];
    expect(url.startsWith(TOKEN_URL)).toBe(true);
    expect(url).toContain("client_id=my-client-id");
    expect(url).toContain("client_secret=my-secret");
    expect(url).toContain("grant_type=client_credentials");
  });

  it("reuses the cached token while it is still valid (single HTTP call)", async () => {
    const http = new FakeHttpClient([tokenResponse()]);
    const auth = new IgdbAuth("id", "secret", http);

    await auth.getAccessToken();
    await auth.getAccessToken();
    await auth.getAccessToken();

    expect(http.calls).toHaveLength(1);
  });

  it("requests a new token once the cached one has expired", async () => {
    vi.useFakeTimers();
    // expires_in = 7200s, margen de refresco 1h → válido durante 3600s
    const http = new FakeHttpClient([tokenResponse(7200), tokenResponse(7200)]);
    const auth = new IgdbAuth("id", "secret", http);

    await auth.getAccessToken();
    expect(http.calls).toHaveLength(1);

    // Avanza 2h: el token (con margen) ya está expirado
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    await auth.getAccessToken();

    expect(http.calls).toHaveLength(2);
  });

  it("maps a failed token request into IgdbAuthError", async () => {
    const http = new FakeHttpClient([
      jsonResponse(400, { message: "invalid client" }),
    ]);
    const auth = new IgdbAuth("id", "secret", http);

    await expect(auth.getAccessToken()).rejects.toThrow(IgdbAuthError);
  });
});
