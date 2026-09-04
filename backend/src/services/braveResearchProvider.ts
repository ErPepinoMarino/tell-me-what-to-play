import type { Evidence, ResearchProvider } from "./research.js";
import { BraveContextSchema } from "./braveContextSchema.js";

// Error tipado de la capa de investigación web,
// para que el pipeline pueda distinguirlo de otros fallos y reintentar/fallar.
export class ResearchProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ResearchProviderError";
  }
}

// Aplana la respuesta de Brave (grounding.generic[].snippets[]) en una lista
// plana de Evidence. Exportado para poder probarlo de forma aislada.
export function parseBraveContext(json: unknown): Evidence[] {
  const parsed = BraveContextSchema.parse(json);
  return parsed.grounding.generic.flatMap((source) =>
    source.snippets.map((snippet) => ({
      source: source.url,
      snippet,
    })),
  );
}

/*
 * ResearchProvider real que consulta el endpoint LLM Context de Brave Search API.
 * Nuestra responsabilidad es SOLO obtener evidencia externa; el LLM la interpreta.
 */
export class BraveResearchProvider implements ResearchProvider {
  constructor(
    private apiKey: string,
    private fetchFn: typeof fetch = fetch,
    private baseUrl = "https://api.search.brave.com/res/v1/llm/context",
  ) {}

  async searchEvidence(query: string): Promise<Evidence[]> {
    const res = await this.fetchFn(
      `${this.baseUrl}?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "X-Subscription-Token": this.apiKey,
          Accept: "application/json",
        },
      },
    );

    if (!res.ok) {
      throw new ResearchProviderError(
        `Brave Search API responded with ${res.status}`,
        res.status,
      );
    }

    const json: unknown = await res.json();
    return parseBraveContext(json);
  }
}
