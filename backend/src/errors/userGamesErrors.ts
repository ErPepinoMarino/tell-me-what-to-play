export class UserNotFoundError extends Error {
  constructor() {
    super("User not found");
    this.name = "UserNotFoundError";
  }
}

export class GameNotFoundError extends Error {
  constructor() {
    super("Game not found");
    this.name = "GameNotFoundError";
  }
}

export class GameNotInLibraryError extends Error {
  constructor() {
    super("Game not in library");
    this.name = "GameNotInLibraryError";
  }
}

export class GameAlreadyInLibraryError extends Error {
  constructor() {
    super("Game already in library");
    this.name = "GameAlreadyInLibraryError";
  }
}
