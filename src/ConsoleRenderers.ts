import { Game } from "./Game";
import { UserGame } from "./UserGame";

export function showGame(game: Game): void {
  console.log(
    `ID: ${game.id}, Título: ${game.title}, Año: ${game.year}, Plataformas: ${game.platforms.join(", ")}, Géneros: ${game.genres.join(", ")}`,
  );
}

export function showUserGame(game: Game, userGame: UserGame): void {
  console.log(
    `ID: ${game.id}, Título: ${game.title}, Año: ${game.year}, Plataformas: ${game.platforms.join(", ")}, Géneros: ${game.genres.join(", ")}, Estado: ${userGame.status}, Me gusta: ${userGame.liked ? "Sí" : "No"}, Calificación: ${userGame.rating ?? "-"}`,
  );
}

export function showMessage(text: string): void {
  console.log(text);
}
