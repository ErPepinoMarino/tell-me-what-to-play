/// <reference types="node" />
import * as readline from "readline";
import { stdin as input, stdout as output } from "process";
import { GameLibrary } from "./GameLibrary";
import { User } from "./User";
import { showGame, showUserGame, showMessage } from "./ConsoleRenderers";

const rl: readline.Interface = readline.createInterface({ input, output });

export function startMenu(libraryIn: GameLibrary, userIn: User): void {
  showMenu();
  askOption(libraryIn, userIn);
}

function askOption(libraryIn: GameLibrary, userIn: User) {
  rl.question("Seleccione una opción: ", (option) => {
    switch (option) {
      case "1":
        searchGame(libraryIn, userIn);
        return;
      case "2":
        verCatalogoDelUser(userIn, libraryIn);
        return;
      case "3":
        showMessage("Saliendo del programa...");
        rl.close();
        return;
      default:
        showMessage(
          "Opción inválida. Por favor, seleccione una opción válida.",
        );
        returnToMenu(libraryIn, userIn);
        return;
    }
  });
}

function showMenu(): void {
  showMessage("========================");
  showMessage(" Tell Me What To Play");
  showMessage("========================");
  showMessage("1. Buscar juego");
  showMessage("2. Ver catálogo");
  showMessage("3. Salir");
}

function searchGame(libraryIn: GameLibrary, userIn: User) {
  //Buscamos el juego, vemos si esta entre los juegos del usuario y mostramos el resultado
  rl.question("\n Ingrese el título del juego a buscar: ", (title) => {
    const results = libraryIn.searchByTitle(title); //buscamos el juego existe
    if (results.length > 0) {
      //Buscamos si el juego esta en la lista del usuario
      let foundGames: number = 0;
      results.forEach((game) => {
        const userGame = userIn.searchGameById(game.id);

        //si esta en la lista del usuario, mostramos el resultado
        if (userGame) {
          showUserGame(game, userGame);
          foundGames++;
        }
      });
      //si no se encontro ningun juego en la lista del usuario, mostramos que no se encontro
      if (foundGames === 0) {
        showMessage(
          "No se encontraron juegos con ese título en la lista del usuario.",
        );
      }
    } else {
      //Si no encontamos ningun juego en la biblioteca, mostramos que no se encontro
      showMessage("No se encontraron juegos con ese título.");
    }
    returnToMenu(libraryIn, userIn);
  });
}
function verCatalogoDelUser(userIn: User, libraryIn: GameLibrary) {
  //Consigue los id de la coleccion con gamesId, los busca en la biblioteca con getGamesByIds y los muestra si coinciden con los de la biblioteca, si no, muestra que no hay juegos en la biblioteca.
  const userGameIds = userIn.getGamesId();
  const userGames = libraryIn.getGamesByIds(userGameIds);
  if (userGames.length > 0) {
    userGames.forEach((game) => {
      const userGame = userIn.searchGameById(game.id);
      if (userGame) {
        showUserGame(game, userGame);
      }
    });
  } else {
    showMessage("El usuario no tiene juegos en su catálogo.");
  }
  returnToMenu(libraryIn, userIn);
}

function returnToMenu(library: GameLibrary, userIn: User) {
  showMenu();
  askOption(library, userIn);
}
