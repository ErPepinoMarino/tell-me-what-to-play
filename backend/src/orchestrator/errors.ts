// Errores de orquestación con mapeo HTTP directo en la ruta.
export class InterpretationError extends Error {
  constructor() {
    super("Intent interpretation failed after retry");
    this.name = "InterpretationError";
  }
}

export class LoginRequiredError extends Error {
  constructor() {
    super("Login required for this action");
    this.name = "LoginRequiredError";
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super("No active search session");
    this.name = "SessionExpiredError";
  }
}

export class MissingRecommendationCredentialsError extends Error {
  constructor() {
    super("Recommendation engine is not configured (missing API credentials)");
    this.name = "MissingRecommendationCredentialsError";
  }
}
