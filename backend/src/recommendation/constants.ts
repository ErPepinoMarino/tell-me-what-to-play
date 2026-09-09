// Configuración de la recomendación. Todo valor es configurable por entorno
// y los literales son los valores iniciales acordados en el diseño.
function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const RECOMMENDATION_CONFIG = {
  // Contrato con el usuario
  maxResults: intFromEnv("RECOMMENDATION_MAX_RESULTS", 8),
  targetValidResults: intFromEnv("RECOMMENDATION_TARGET_VALID_RESULTS", 6),
  // Tier mínimo mostrable: weak/invalid jamás se muestran, ni como relleno
  minTier: "valid",

  // Pool interno de candidatos que el matcher evalúa por petición
  matchPoolCap: intFromEnv("RECOMMENDATION_MATCH_POOL_CAP", 1000),

  // Descubrimiento por petición (filosofía de gasto):
  // - Relleno por necesidad: hasta maxNewGamesPerRequest fichas nuevas
  //   (worst case = 8 juegos en la BDD; para antes si muestra 8 válidos).
  // - Crecimiento orgánico (respuesta ya llena): organicUnitsPerRequest
  //   acciones = 2 re-enriquecimientos o 2 juegos nuevos.
  maxNewGamesPerRequest: intFromEnv(
    "RECOMMENDATION_MAX_NEW_GAMES_PER_REQUEST",
    8,
  ),
  organicUnitsPerRequest: intFromEnv(
    "RECOMMENDATION_ORGANIC_UNITS_PER_REQUEST",
    2,
  ),
  // Fichas enriquecidas por búsqueda IGDB (la lista se reutiliza entre
  // unidades sin repetir la llamada hasta agotarla)
  maxNewGamesPerDiscoveryUnit: intFromEnv(
    "RECOMMENDATION_MAX_NEW_PER_DISCOVERY_UNIT",
    2,
  ),
  /*
   * Candidatos que pide cada búsqueda IGDB del relleno. Más que el techo de
   * fichas nuevas: los primeros resultados pueden existir ya en el catálogo
   * o haberse mostrado en la sesión, y el relleno necesita margen para
   * encontrar juegos NUEVOS sin repetir la llamada.
   */
  igdbSearchLimit: intFromEnv("RECOMMENDATION_IGDB_SEARCH_LIMIT", 30),
  /*
   * Tope de la llamada AMPLIA de rescate (solo "more" cuando lo estricto
   * no crea nada): trae de sobra para que la criba local en cascada elija.
   * Cuesta 1 unidad IGDB traiga 10 o 50; lo caro (enrich) sigue acotado
   * por maxNewGamesPerRequest.
   */
  igdbBroadSearchLimit: intFromEnv(
    "RECOMMENDATION_IGDB_BROAD_SEARCH_LIMIT",
    50,
  ),
  /*
   * Gate de calidad del descubrimiento: una ficha descubierta por relleno
   * necesita señal mínima de la comunidad IGDB (nº de ratings) para no
   * gastar enriquecimiento en basura. undefined/ausente = desconocido = se
   * conserva ("null no significa cero"). Las anclas nunca pasan por el gate.
   */
  minIgdbRatingCount: intFromEnv("RECOMMENDATION_MIN_IGDB_RATING_COUNT", 3),
  unitTimeoutMs: intFromEnv("RECOMMENDATION_UNIT_TIMEOUT_MS", 20000),
  // La explicación conversacional es secundaria: timeout propio más corto
  explanationTimeoutMs: intFromEnv(
    "RECOMMENDATION_EXPLANATION_TIMEOUT_MS",
    8000,
  ),
  // Tope temporal del relleno síncrono: si se supera, se devuelve parcial
  // y el usuario continúa con "Más así" (mitiga cortes del proxy).
  fillDeadlineMs: intFromEnv("RECOMMENDATION_FILL_DEADLINE_MS", 20000),

  // Coste de cada unidad de enriquecimiento en llamadas a Brave
  braveQueriesPerEnrichment: intFromEnv(
    "RECOMMENDATION_BRAVE_QUERIES_PER_ENRICH",
    2,
  ),

  // Re-enrichment: una ficha con menos semánticas conocidas que esta cifra
  // es candidata a investigarse de nuevo
  reEnrichMinKnownSemantics: intFromEnv(
    "RECOMMENDATION_REENRICH_MIN_KNOWN_SEMANTICS",
    7,
  ),

  // Presupuesto diario de APIs (ley dura)
  igdbDailyLimit: intFromEnv("IGDB_DAILY_LIMIT", 300),
  braveDailyLimit: intFromEnv("BRAVE_DAILY_LIMIT", 600),
  /*
   * LLM por interacción: 1 interpretación (0 en "more") + 1 por juego
   * enriquecido (hasta 2 por unidad de descubrimiento: normal ~4, peor
   * caso 8 unidades → hasta 16) + 1 por re-enriquecimiento + 1 explicación
   * por respuesta. Los enriquecimientos ya están acotados por el techo
   * de IGDB (300 unidades → ≤ 600 llamadas); el límite LLM es la guarda
   * contra spam de búsquedas cuando el catálogo ya responde sin
   * descubrimiento.
   */
  llmDailyLimit: intFromEnv("LLM_DAILY_LIMIT", 2000),

  /*
   * Embeddings (léxico de keywords): 1 por canonicalize() que necesite
   * vectores de términos desconocidos (cacheados). Son llamadas muy baratas;
   * el límite es la guarda contra bucles patológicos.
   */
  embeddingDailyLimit: intFromEnv("EMBEDDING_DAILY_LIMIT", 2000),

  // Límite superior del catálogo propio
  maxCatalogSize: intFromEnv("RECOMMENDATION_MAX_CATALOG_SIZE", 350000),
} as const;

export type RecommendationConfig = typeof RECOMMENDATION_CONFIG;
