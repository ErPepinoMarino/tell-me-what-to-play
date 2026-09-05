import { createIgdbClient } from "../igdb/index.js";
import { createEnrichmentService } from "../services/enrichmentService.js";
import { createBudgetedIntentExtractor } from "../services/intentService.js";
import { createExplanationComposer } from "../services/explanationService.js";
import { createKeywordEmbedder } from "../lib/embeddings.js";
import { createKeywordLexiconService } from "../services/keywordLexiconService.js";
import { InMemoryBudgetLedger } from "../budget/budgetLedger.js";
import { InMemorySessionStore } from "../sessions/sessionStore.js";
import { RECOMMENDATION_CONFIG } from "../recommendation/constants.js";
import { DiscoveryManager } from "./discovery.js";
import { RecommendationOrchestrator } from "./recommendationOrchestrator.js";
import { MissingRecommendationCredentialsError } from "./errors.js";
import { prismaCatalogLayer, jsonCacheLayer } from "./adapters.js";
import { prisma } from "../lib/prisma.js";

let singleton: RecommendationOrchestrator | undefined;

/*
 * Construcción perezosa: el server arranca aunque falten credenciales de
 * IGDB/Brave y la ruta responde 503 hasta que existan. El presupuesto y la
 * sesión son singletons por proceso (memoria).
 */
export function createRecommendationOrchestrator(): RecommendationOrchestrator {
  let igdb;
  let enrichment;
  try {
    igdb = createIgdbClient();
    enrichment = createEnrichmentService();
  } catch (error) {
    console.error("[recommendation] missing credentials:", error);
    throw new MissingRecommendationCredentialsError();
  }

  const budget = new InMemoryBudgetLedger({
    igdb: RECOMMENDATION_CONFIG.igdbDailyLimit,
    brave: RECOMMENDATION_CONFIG.braveDailyLimit,
    llm: RECOMMENDATION_CONFIG.llmDailyLimit,
    embedding: RECOMMENDATION_CONFIG.embeddingDailyLimit,
  });

  const sessions = new InMemorySessionStore({
    ttlMs: RECOMMENDATION_CONFIG.sessionTtlMinutes * 60 * 1000,
    maxEntries: RECOMMENDATION_CONFIG.sessionMaxEntries,
  });

  /*
   * Léxico de keywords: diccionario completo de IGDB (ver
   * scripts/seedKeywordDictionary.ts). Carga perezosa de keyword_lexicon y
   * canonicalización de keywords del usuario/enrichment/siembra. Política
   * CONSERVADORA: lo que no matchea (literal/stem/embedding) se DROP — el
   * diccionario es cerrado, nunca crece. Con el servicio de embeddings
   * caído o presupuesto seco degrada a literal.
   */
  const lexicon = createKeywordLexiconService({
    loader: async () => prisma.keyword_lexicon.findMany(),
    embedder: createKeywordEmbedder(),
    budget,
  });

  const discovery = new DiscoveryManager(
    igdb,
    enrichment,
    prismaCatalogLayer,
    budget,
    RECOMMENDATION_CONFIG,
    lexicon,
  );

  return new RecommendationOrchestrator({
    intents: createBudgetedIntentExtractor(budget),
    cache: jsonCacheLayer,
    catalog: prismaCatalogLayer,
    discovery,
    sessions,
    explainer: createExplanationComposer(budget),
    lexicon,
  });
}

export function getRecommendationOrchestrator(): RecommendationOrchestrator {
  singleton ??= createRecommendationOrchestrator();
  return singleton;
}
