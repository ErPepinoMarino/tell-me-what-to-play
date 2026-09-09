// Errores de orquestación con mapeo HTTP directo en la ruta.
export class InterpretationError extends Error {
  constructor() {
    super("Intent interpretation failed after retry");
    this.name = "InterpretationError";
  }
}

export class MissingRecommendationCredentialsError extends Error {
  constructor() {
    super("Recommendation engine is not configured (missing API credentials)");
    this.name = "MissingRecommendationCredentialsError";
  }
}
