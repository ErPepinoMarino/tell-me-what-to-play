import { UserGame } from "./UserGame";

export class User {
  readonly id: number;
  private games: UserGame[];
  constructor(id: number, games: UserGame[]) {
    this.id = id;
    this.games = games;
  }

  public addGameToUser(userGame: UserGame): void {
    this.games.push(userGame);
  }

  public searchGameById(gameId: number): UserGame | undefined {
    return this.games.find((userGame) => userGame.gameId === gameId);
  }
  public getGamesId(): number[] {
    return this.games.map((userGame) => userGame.gameId);
  }
}
