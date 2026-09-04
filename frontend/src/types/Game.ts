export interface Game {
  id: number;
  slug: string;
  title: string;
  description_es: string;
  description_en: string;
  coverUrl: string;
  releaseYear: number;
  genres: Genre[];
  platforms: Platform[];
  gameModes: GameMode[];
  perspectives: Perspective[];
  developers: string[];
  publishers: string[];
  searchCount: number;
  difficulty: number | null;
  pace: number | null;
  narrative: number | null;
  complexity: number | null;
  strategy: number | null;
  exploration: number | null;
  violence: number | null;
  horror: number | null;
  darkness: number | null;
  tension: number | null;
  humor: number | null;
  isolation: number | null;
}

export type Genre =
  | "ACTION"
  | "ADVENTURE"
  | "ARCADE"
  | "CASUAL"
  | "FIGHTING"
  | "HORROR"
  | "INDIE"
  | "MMO"
  | "PLATFORMER"
  | "PUZZLE"
  | "RACING"
  | "RPG"
  | "SHOOTER"
  | "SIMULATION"
  | "SPORTS"
  | "STRATEGY"
  | "UNKNOWN";

export type Platform =
  | "PC"
  | "MAC"
  | "LINUX"
  | "PS5"
  | "PS4"
  | "PS3"
  | "PS2"
  | "PS1"
  | "PS_VITA"
  | "PSP"
  | "XBOX_SERIES"
  | "XBOX_ONE"
  | "XBOX_360"
  | "XBOX"
  | "SWITCH"
  | "WII_U"
  | "WII"
  | "GAMECUBE"
  | "N64"
  | "SNES"
  | "NES"
  | "NINTENDO_3DS"
  | "DS"
  | "GAME_BOY"
  | "GAME_BOY_ADVANCE"
  | "IOS"
  | "ANDROID"
  | "UNKNOWN";

export type GameMode =
  "SINGLE_PLAYER" | "MULTIPLAYER" | "COOPERATIVE" | "COMPETITIVE" | "UNKNOWN";

export type Perspective =
  | "FIRST_PERSON"
  | "THIRD_PERSON"
  | "TOP_DOWN"
  | "ISOMETRIC"
  | "SIDE_VIEW"
  | "TEXT"
  | "UNKNOWN";
