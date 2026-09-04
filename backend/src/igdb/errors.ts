// Base error for all IGDB-related failures
export class IgdbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IgdbError";
  }
}

// 401/403 — authentication/authorization failure
export class IgdbAuthError extends IgdbError {
  constructor(message: string = "IGDB authentication failed") {
    super(message);
    this.name = "IgdbAuthError";
  }
}

// 429 — rate limit exceeded
export class IgdbRateLimitError extends IgdbError {
  constructor(message: string = "IGDB rate limit exceeded") {
    super(message);
    this.name = "IgdbRateLimitError";
  }
}

// 5xx — IGDB server error
export class IgdbServerError extends IgdbError {
  constructor(message: string = "IGDB server error") {
    super(message);
    this.name = "IgdbServerError";
  }
}
