import type { HttpClient, HttpResponse, IgdbClient } from "./types.js";
import { HttpIgdbClient } from "./client.js";

// Native fetch implementation of HttpClient
class FetchHttpClient implements HttpClient {
  async post(url: string, body: string, headers: HeadersInit): Promise<HttpResponse> {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    return {
      status: response.status,
      json: () => response.json(),
    };
  }
}

// Factory function to create a production-ready IGDB client
export function createIgdbClient(): IgdbClient {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing IGDB credentials: TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be set",
    );
  }

  return new HttpIgdbClient(new FetchHttpClient(), clientId, clientSecret);
}

// Re-exports for consumers
export type { IgdbClient, IgdbGameRaw, HttpClient, HttpResponse } from "./types.js";
export { HttpIgdbClient } from "./client.js";
export { IgdbAuth } from "./auth.js";
export { IgdbError, IgdbAuthError, IgdbRateLimitError, IgdbServerError } from "./errors.js";
