import { OpenAIEmbeddings } from "@langchain/openai";

/*
 * Embeddings para el léxico de keywords (FASE 1-4 del roadmap). Modelo
 * decidido en FASE 0: text-embedding-3-small (1536 dims, barato).
 * Inyectable en tests: el algoritmo de asimilación solo pide
 * (terms: string[]) => Promise<number[][]>.
 */
export interface KeywordEmbedder {
  embed(terms: string[]): Promise<number[][]>;
}

export function createKeywordEmbedder(): KeywordEmbedder {
  const model = new OpenAIEmbeddings({
    model: "text-embedding-3-small",
  });

  return {
    async embed(terms: string[]): Promise<number[][]> {
      if (terms.length === 0) return [];
      // embedDocuments acepta lote; devuelve un vector por término en orden.
      return model.embedDocuments(terms);
    },
  };
}
