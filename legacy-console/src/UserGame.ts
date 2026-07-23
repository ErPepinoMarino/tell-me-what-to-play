export class UserGame {
  //lo hago clase y no interface porque incluiremos funciones en un futuro y debe mantener su estado.
  gameId: number;
  status: "Wished" | "Owned" | "Playing" | "Completed";
  liked?: boolean | undefined;
  rating?: number | undefined;
  constructor(
    gameId: number,
    status: "Wished" | "Owned" | "Playing" | "Completed",
    liked?: boolean,
    rating?: number,
  ) {
    this.gameId = gameId;
    this.status = status;
    this.liked = liked;
    this.rating = rating;
  }
}
