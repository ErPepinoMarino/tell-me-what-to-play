import { describe, expect, it } from "vitest";
import {
  BraveResearchProvider,
  ResearchProviderError,
  parseBraveContext,
} from "../../src/services/braveResearchProvider.js";

// Payload de ejemplo con la forma que devuelve Brave LLM Context.
const SAMPLE_PAYLOAD = {
  grounding: {
    generic: [
      {
        url: "https://www.eurogamer.net/halo-3-review",
        title: "Eurogamer review",
        snippets: ["Slow paced epic shooter.", "Tense campaign moments."],
      },
      {
        url: "https://www.ign.com/halo-3",
        title: "IGN review",
        snippets: ["A massive sci-fi shooter."],
      },
    ],
  },
};

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
  } as unknown as Response;
}

function makeFetch(
  responder: (url: string) => Response,
): typeof fetch & { lastUrl?: string } {
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fn.lastUrl = url;
    return responder(url);
  }) as typeof fetch & { lastUrl?: string };
  return fn;
}

describe("parseBraveContext", () => {
  it("flattens grounding.generic snippets into Evidence[]", () => {
    const result = parseBraveContext(SAMPLE_PAYLOAD);

    expect(result).toEqual([
      {
        source: "https://www.eurogamer.net/halo-3-review",
        snippet: "Slow paced epic shooter.",
      },
      {
        source: "https://www.eurogamer.net/halo-3-review",
        snippet: "Tense campaign moments.",
      },
      {
        source: "https://www.ign.com/halo-3",
        snippet: "A massive sci-fi shooter.",
      },
    ]);
  });

  it("returns an empty array when there are no sources", () => {
    const result = parseBraveContext({
      grounding: { generic: [] },
    });
    expect(result).toEqual([]);
  });

  it("throws a ZodError on a malformed payload", () => {
    expect(() => parseBraveContext({ wrong: "shape" })).toThrow();
  });
});

describe("BraveResearchProvider.searchEvidence", () => {
  it("calls the endpoint with the query and auth header, and returns evidence", async () => {
    const fetchFn = makeFetch(() => jsonResponse(SAMPLE_PAYLOAD));
    const provider = new BraveResearchProvider(
      "test-api-key",
      fetchFn,
      "https://api.search.brave.com/res/v1/llm/context",
    );

    const result = await provider.searchEvidence("Halo 3");

    expect(fetchFn.lastUrl).toBe(
      "https://api.search.brave.com/res/v1/llm/context?q=Halo%203",
    );
    expect(result).toHaveLength(3);
    expect(result[0].source).toBe("https://www.eurogamer.net/halo-3-review");
  });

  it("throws ResearchProviderError when the API responds with an error", async () => {
    const provider = new BraveResearchProvider(
      "test-api-key",
      makeFetch(() => jsonResponse({}, false, 429)),
    );

    await expect(provider.searchEvidence("Halo 3")).rejects.toThrow(
      ResearchProviderError,
    );
  });

  it("throws ResearchProviderError carrying the status code", async () => {
    const provider = new BraveResearchProvider(
      "test-api-key",
      makeFetch(() => jsonResponse({}, false, 500)),
    );

    await provider.searchEvidence("Halo 3").catch((err) => {
      expect(err).toBeInstanceOf(ResearchProviderError);
      expect((err as ResearchProviderError).status).toBe(500);
    });
  });
});
