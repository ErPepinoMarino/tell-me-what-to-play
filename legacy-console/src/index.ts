import { GameLibrary } from "./GameLibrary";
import { startMenu } from "./ConsoleMenu";
import { UserGame } from "./UserGame";
import { User } from "./User";

// Crear una instancia de GameLibrary
const library = new GameLibrary();

//Creamos los juegos de ejemplo
library.add({
  id: 1,
  title: "The Legend of Zelda: Breath of the Wild",
  year: 2017,
  platforms: ["Nintendo Switch", "Wii U"],
  genres: ["Action-adventure"],
});
library.add({
  id: 2,
  title: "God of War",
  year: 2018,
  platforms: ["PlayStation 4"],
  genres: ["Action-adventure"],
});
library.add({
  id: 3,
  title: "Red Dead Redemption 2",
  year: 2018,
  platforms: ["PlayStation 4", "Xbox One", "PC"],
  genres: ["Action-adventure"],
});
library.add({
  id: 4,
  title: "The Witcher 3: Wild Hunt",
  year: 2015,
  platforms: ["PlayStation 4", "Xbox One", "PC", "Nintendo Switch"],
  genres: ["Action role-playing"],
});
library.add({
  id: 5,
  title: "Super Mario Odyssey",
  year: 2017,
  platforms: ["Nintendo Switch"],
  genres: ["Platform"],
});

//Creamos un usuario de ejemplo
const user = new User(1, []);

// Agregar algunos UserGame al usuario
user.addGameToUser(new UserGame(1, "Wished", false, 0));
user.addGameToUser(new UserGame(2, "Owned", true, 5));
user.addGameToUser(new UserGame(3, "Playing", true, 4));
user.addGameToUser(new UserGame(4, "Completed", true, 5));

startMenu(library, user);
