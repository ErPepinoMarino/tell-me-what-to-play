import { createIgdbClient } from "../igdb/index.js";
import { createEnrichmentService } from "../services/enrichmentService.js";
import { createBudgetedIntentExtractor } from "../services/intentService.js";
import { createExplanationComposer } from "../services/explanationService.js";
import { InMemoryBudgetLedger } from "../budget/budgetLedger.js";
import { InMemorySessionStore } from "../sessions/sessionStore.js";
import { RECOMMENDATION_CONFIG } from "../recommendation/constants.js";
import { DiscoveryManager } from "./discovery.js";
import { RecommendationOrchestrator } from "./recommendationOrchestrator.js";
import { MissingRecommendationCredentialsError } from "./errors.js";
import { prismaCatalogLayer, jsonCacheLayer } from "./adapters.js";

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
  });

  const sessions = new InMemorySessionStore({
    ttlMs: RECOMMENDATION_CONFIG.sessionTtlMinutes * 60 * 1000,
    maxEntries: RECOMMENDATION_CONFIG.sessionMaxEntries,
  });

  const discovery = new DiscoveryManager(
    igdb,
    enrichment,
    prismaCatalogLayer,
    budget,
  );

  return new RecommendationOrchestrator({
    intents: createBudgetedIntentExtractor(budget),
    cache: jsonCacheLayer,
    catalog: prismaCatalogLayer,
    discovery,
    sessions,
    explainer: createExplanationComposer(budget),
  });
}

export function getRecommendationOrchestrator(): RecommendationOrchestrator {
  singleton ??= createRecommendationOrchestrator();
  return singleton;
}
