import { Game } from "./Game";
import { User } from "./User";

export class GameLibrary {
  private games: Game[];

  constructor() {
    this.games = [];
  }
  add(game: Game) {
    this.games.push(game); //como el add de las listas de c#, no te rayes.
  }
  remove(id: number) {
    this.games = this.games.filter((game) => game.id !== id); //filter no modifica el array, devuelve la copia modificada, por eso reasignamos a this.games
  }
  searchByTitle(title: string): Game[] {
    return this.games.filter((game) => game.title.toLowerCase().includes(title.toLowerCase())); //Pasamos a minuscula para ignorar mayusculas y minusculas
  }
  list(): readonly Game[] {
    return this.games;
  }
  public getGamesByIds(ids: number[]): Game[] {
    return this.games.filter((game) => ids.includes(game.id));
  }
}
