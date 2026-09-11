// Normalizamos y adaptamos los datos de IGDB a los campos de nuestra BDD.

/*
Converts an IGDB epoch timestamp (seconds) into a calendar year (UTC).
 */
export function extractYear(epochSeconds: number | undefined): number | null {
  if (epochSeconds === undefined) {
    return null;
  }
  //multiplicar por 1000 para convertir de segundos a milisegundos
  const date = new Date(epochSeconds * 1000);

  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.getUTCFullYear();
}

import {
  GameMode,
  Genre,
  Perspective,
  Platform,
  Theme,
} from "../types/enums.js";
import type { GameSearchIntent } from "../types/GameSearchIntent.js";

// Mapa de equivalencias IGDB -> TMWTP
const GENRE_MAP: Record<string, Genre> = {
  Adventure: "ADVENTURE",
  Arcade: "ARCADE",
  "Card & Board Game": "CARD_AND_BOARD_GAME",
  Fighting: "FIGHTING",
  "Hack and slash/Beat 'em up": "HACK_AND_SLASH_BEAT_EM_UP",
  Indie: "INDIE",
  MOBA: "MOBA",
  Music: "MUSIC",
  Pinball: "PINBALL",
  Platform: "PLATFORM",
  "Point-and-click": "POINT_AND_CLICK",
  Puzzle: "PUZZLE",
  "Quiz/Trivia": "QUIZ_TRIVIA",
  Racing: "RACING",
  "Real Time Strategy (RTS)": "REAL_TIME_STRATEGY",
  "Role-playing (RPG)": "ROLE_PLAYING_RPG",
  Shooter: "SHOOTER",
  Simulator: "SIMULATOR",
  Sport: "SPORT",
  Strategy: "STRATEGY",
  Tactical: "TACTICAL",
  "Turn-based strategy (TBS)": "TURN_BASED_STRATEGY",
  "Visual Novel": "VISUAL_NOVEL",
};

const THEME_MAP: Record<string, Theme> = {
  Action: "ACTION",
  Business: "BUSINESS",
  Comedy: "COMEDY",
  Drama: "DRAMA",
  Educational: "EDUCATIONAL",
  Erotic: "EROTIC",
  Fantasy: "FANTASY",
  "4X (explore, expand, exploit, and exterminate)": "FOUR_X",
  Historical: "HISTORICAL",
  Horror: "HORROR",
  Kids: "KIDS",
  Mystery: "MYSTERY",
  "Non-fiction": "NON_FICTION",
  "Open world": "OPEN_WORLD",
  Party: "PARTY",
  Romance: "ROMANCE",
  Sandbox: "SANDBOX",
  "Science fiction": "SCIENCE_FICTION",
  Stealth: "STEALTH",
  Survival: "SURVIVAL",
  Thriller: "THRILLER",
  Warfare: "WARFARE",
};

export interface EnumNormalization<T> {
  values: T[];
}

/*
 * Funcion simple: Recibe un array de nombres y un mapa de equivalencias (nombre -> enum).
 * Los nombres sin equivalencia simplemente no se mapean (nunca se inventa un
 * valor ni se acumulan: la regla "categoría IGDB no mapeada → keyword" quedó
 * eliminada de la arquitectura de keywords).
 */
function mapToEnum<T extends string>(
  names: string[] | undefined,
  map: Record<string, T>,
): EnumNormalization<T> {
  if (!names || names.length === 0) {
    return { values: [] };
  }
  const values: T[] = [];
  for (const name of names) {
    const mapped = map[name];
    if (mapped) {
      values.push(mapped);
    }
  }
  return { values: [...new Set(values)] };
}

//Llama a mapToEnum con el mapa de géneros. (Facilito)

export function normalizeGenres(
  names: string[] | undefined,
): EnumNormalization<Genre> {
  return mapToEnum(names, GENRE_MAP);
}

//Llama a mapToEnum con el mapa de themes. (Facilito)
export function normalizeThemes(
  names: string[] | undefined,
): EnumNormalization<Theme> {
  return mapToEnum(names, THEME_MAP);
}

// Crea un Record de Theme -> boolean, para saber si un theme está presente o no.
const PLATFORM_MAP: Record<string, Platform> = {
  "PC (Microsoft Windows)": "PC",
  Mac: "MAC",
  Linux: "LINUX",
  "PlayStation 5": "PS5",
  "PlayStation 4": "PS4",
  "PlayStation 3": "PS3",
  "PlayStation 2": "PS2",
  PlayStation: "PS1",
  "PS Vita": "PS_VITA",
  "PlayStation Portable": "PSP",
  "Xbox Series X|S": "XBOX_SERIES",
  "Xbox One": "XBOX_ONE",
  "Xbox 360": "XBOX_360",
  Xbox: "XBOX",
  "Nintendo Switch": "SWITCH",
  "Wii U": "WII_U",
  Wii: "WII",
  "Nintendo GameCube": "GAMECUBE",
  "Nintendo 64": "N64",
  "Super Nintendo Entertainment System (SNES)": "SNES",
  "Nintendo Entertainment System (NES)": "NES",
  "Nintendo 3DS": "NINTENDO_3DS",
  "Nintendo DS": "DS",
  "Game Boy": "GAME_BOY",
  "Game Boy Color": "GAME_BOY",
  "Game Boy Advance": "GAME_BOY_ADVANCE",
  iOS: "IOS",
  Android: "ANDROID",
};

//Igual que los anteriores, llama a mapToEnum con el mapa de plataformas.
export function normalizePlatforms(
  names: string[] | undefined,
): EnumNormalization<Platform> {
  return mapToEnum(names, PLATFORM_MAP);
}

// Crea un Record de GameMode -> boolean, para saber si un GameMode está presente o no.
const GAME_MODE_MAP: Record<string, GameMode> = {
  "Single player": "SINGLE_PLAYER",
  Multiplayer: "MULTIPLAYER",
  "Co-operative": "COOPERATIVE",
  "Split screen": "MULTIPLAYER",
  "Massively Multiplayer Online (MMO)": "MASSIVELY_MULTIPLAYER",
};
// Como antes.
export function normalizeGameModes(
  names: string[] | undefined,
): EnumNormalization<GameMode> {
  return mapToEnum(names, GAME_MODE_MAP);
}

// Mismo patron.
const PERSPECTIVE_MAP: Record<string, Perspective> = {
  "First person": "FIRST_PERSON",
  "Third person": "THIRD_PERSON",
  "Top-down": "TOP_DOWN",
  Isometric: "ISOMETRIC",
  "Side view": "SIDE_VIEW",
  Text: "TEXT",
};
//...
export function normalizePerspectives(
  names: string[] | undefined,
): EnumNormalization<Perspective> {
  return mapToEnum(names, PERSPECTIVE_MAP);
}

/*
 * Recibe un título y un año (opcional) y genera un slug normalizado para la BDD.
 */
export function generateSlug(title: string, year: number | null): string {
  const normalized = title
    .toLowerCase()
    .normalize("NFD") // separa acentos: "é" -> "e" + combining accent
    .replace(/[\u0300-\u036f]/g, "") // elimina los combining accents
    .replace(/[^a-z0-9]+/g, "-") // todo lo no alfanumerico -> "-"
    .replace(/^-+|-+$/g, ""); // guiones en extremos fuera

  return year === null ? normalized : `${normalized}-${year}`;
}

/*
 * Crea un mapa de keywords normalizadas (lowercase, trim) a su campo enum correspondiente.
 */
const GENRE_REVERSE: Map<Genre, string[]> = (() => {
  const map = new Map<Genre, string[]>();
  for (const [igdbName, genre] of Object.entries(GENRE_MAP) as [
    string,
    Genre,
  ][]) {
    const names = map.get(genre) ?? [];
    names.push(igdbName);
    map.set(genre, names);
  }
  return map;
})();

// Getter de los slugs IGDB posibles para un enum de genre.
export function genreIgbNames(genre: Genre): string[] {
  return GENRE_REVERSE.get(genre) ?? [];
}

// Record con los id de cada Theme.
const THEME_IGB_IDS: Record<Exclude<Theme, "UNKNOWN">, number> = {
  ACTION: 1,
  BUSINESS: 28,
  COMEDY: 27,
  DRAMA: 31,
  EDUCATIONAL: 34,
  EROTIC: 42,
  FANTASY: 17,
  FOUR_X: 41,
  HISTORICAL: 22,
  HORROR: 19,
  KIDS: 35,
  MYSTERY: 43,
  NON_FICTION: 32,
  OPEN_WORLD: 38,
  PARTY: 40,
  ROMANCE: 44,
  SANDBOX: 33,
  SCIENCE_FICTION: 18,
  STEALTH: 23,
  SURVIVAL: 21,
  THRILLER: 20,
  WARFARE: 39,
};
// Getter.
export function themeIgbId(theme: Theme): number | null {
  return theme === "UNKNOWN" ? null : THEME_IGB_IDS[theme];
}
// Reverse perspectiva: plataforma IGDB -> Platform (para el discovery).
const PLATFORM_REVERSE: Map<Platform, string[]> = (() => {
  const map = new Map<Platform, string[]>();
  for (const [igdbName, platform] of Object.entries(PLATFORM_MAP) as [
    string,
    Platform,
  ][]) {
    const names = map.get(platform) ?? [];
    names.push(igdbName);
    map.set(platform, names);
  }
  return map;
})();

// Nombres IGDB posibles para un enum de plataforma.
export function platformIgbNames(platform: Platform): string[] {
  return PLATFORM_REVERSE.get(platform) ?? [];
}

// Reverse perspectiva: nombre IGDB -> Perspective (para el discovery).
const PERSPECTIVE_REVERSE: Map<Perspective, string[]> = (() => {
  const map = new Map<Perspective, string[]>();
  for (const [igdbName, perspective] of Object.entries(PERSPECTIVE_MAP) as [
    string,
    Perspective,
  ][]) {
    const names = map.get(perspective) ?? [];
    names.push(igdbName);
    map.set(perspective, names);
  }
  return map;
})();

// Nombres IGDB posibles para un enum de perspectiva.
export function perspectiveIgbNames(perspective: Perspective): string[] {
  return PERSPECTIVE_REVERSE.get(perspective) ?? [];
}
/*
 * ============================================================================
 * Paso 1 del procesado de keywords: RESCATE de keywords a vocabularios enum.
 * ============================================================================
 * Esto ha costado pero creo que es muy útil. La idea es cazar generos, platagformas... que el llm ha metido como keywords.
 * Recorre las keywords y si encuentra alguna que coincide con un valor de enum (o un alias) la mueve al campo correspondiente del intent.
 */
type IntentField =
  "genres" | "themes" | "platforms" | "gameModes" | "perspectives";

const ENUM_KEYWORD_MAP: Record<string, { field: IntentField; value: string }> =
  (() => {
    const map: Record<string, { field: IntentField; value: string }> = {};
    const add = (field: IntentField, value: string, keys: string[]) => {
      for (const key of keys) {
        const normalized = intentKeywordKey(key);
        if (normalized && !map[normalized]) {
          map[normalized] = { field, value };
        }
      }
    };

    // Slug de cada valor de enum (sin UNKNOWN): nombres propios.
    for (const value of Object.values(Genre))
      if (value !== "UNKNOWN") add("genres", value, [value]);
    for (const value of Object.values(Theme))
      if (value !== "UNKNOWN") add("themes", value, [value]);
    for (const value of Object.values(Platform))
      if (value !== "UNKNOWN") add("platforms", value, [value]);
    for (const value of Object.values(GameMode))
      if (value !== "UNKNOWN") add("gameModes", value, [value]);
    for (const value of Object.values(Perspective))
      if (value !== "UNKNOWN") add("perspectives", value, [value]);

    // Aliases expli­citos (formas comunes que la LLM produce en keywords).
    add("genres", "ROLE_PLAYING_RPG", [
      "rpg",
      "role playing",
      "role-playing",
      "roleplay",
      "role play",
    ]);
    add("genres", "POINT_AND_CLICK", ["point and click"]);
    add("genres", "HACK_AND_SLASH_BEAT_EM_UP", [
      "hack and slash",
      "hack n slash",
      "beat em up",
      "beat'em up",
    ]);
    add("genres", "REAL_TIME_STRATEGY", ["rts", "real time strategy"]);
    add("genres", "TURN_BASED_STRATEGY", ["turn based strategy", "turn-based"]);
    add("genres", "CARD_AND_BOARD_GAME", ["card game", "board game"]);
    add("genres", "QUIZ_TRIVIA", ["trivia", "quiz"]);
    add("genres", "VISUAL_NOVEL", ["visual novel"]);

    add("themes", "SCIENCE_FICTION", ["sci fi", "sci-fi", "scifi"]);
    add("themes", "OPEN_WORLD", ["openworld", "open-world"]);
    add("themes", "NON_FICTION", ["non fiction", "nonfiction"]);
    add("themes", "FOUR_X", ["4x"]);

    add("platforms", "PS5", ["playstation 5", "playstation5", "ps 5"]);
    add("platforms", "PS4", ["playstation 4", "playstation4", "ps 4"]);
    add("platforms", "PS3", ["playstation 3", "playstation3", "ps 3"]);
    add("platforms", "PS2", ["playstation 2", "playstation2", "ps 2"]);
    add("platforms", "PS1", ["playstation", "playstation 1", "ps1", "ps 1"]);
    add("platforms", "PS_VITA", [
      "ps vita",
      "playstation vita",
      "playstation portable",
      "psp",
    ]);
    add("platforms", "XBOX_SERIES", [
      "xbox series",
      "xbox series x",
      "xbox series s",
      "xbox sx",
      "xbox ss",
    ]);
    add("platforms", "SWITCH", ["nintendo switch", "switch", "ns"]);
    add("platforms", "WII_U", ["wii u"]);
    add("platforms", "NINTENDO_3DS", ["3ds", "nintendo 3ds", "3ds xl"]);
    add("platforms", "GAME_BOY_ADVANCE", ["game boy advance", "gba"]);
    add("platforms", "GAME_BOY", ["game boy", "gameboy", "gb"]);
    add("platforms", "XBOX_360", ["xbox 360", "x360"]);
    add("platforms", "XBOX_ONE", ["xbox one"]);
    add("platforms", "N64", ["n64", "nintendo 64"]);
    add("platforms", "SNES", ["snes", "super nintendo"]);
    add("platforms", "NES", ["nes", "nintendo entertainment system"]);

    add("gameModes", "SINGLE_PLAYER", ["single player", "singleplayer"]);
    add("gameModes", "MULTIPLAYER", ["multiplayer", "multi player"]);
    add("gameModes", "COOPERATIVE", [
      "co-op",
      "coop",
      "co operative",
      "cooperative",
      "co op",
    ]);
    add("gameModes", "MASSIVELY_MULTIPLAYER", [
      "mmo",
      "massively multiplayer",
      "mmorpg",
      "online multiplayer",
    ]);

    add("perspectives", "FIRST_PERSON", ["first person", "fps", "fpv"]);
    add("perspectives", "THIRD_PERSON", ["third person", "tps"]);
    add("perspectives", "TOP_DOWN", ["top down", "topdown"]);
    add("perspectives", "SIDE_VIEW", [
      "side view",
      "side-view",
      "side scroller",
    ]);
    add("perspectives", "ISOMETRIC", ["isometric"]);

    return map;
  })(); //fin del ENUM_KEYWORD_MAP

// Normaliza una clave para el mapa (minúsculas, "_" y "/" → "-").
function intentKeywordKey(keyword: string): string {
  return keyword
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, "-")
    .replace(/[\s-]+/g, "-");
}

// Paso 1: resuelve si una keyword pertenece a un vocabulario enum. null = no.
export function resolveEnumFieldFromKeyword(
  keyword: string,
): { field: IntentField; value: string } | null {
  return ENUM_KEYWORD_MAP[intentKeywordKey(keyword)] ?? null;
}

/*
 * Recorre las keywords del intent y redirige al campo enum correspondiente
 */
export function redirectKeywordsToEnumFields(
  intent: GameSearchIntent,
): GameSearchIntent {
  const keywords = intent.keywords ?? [];
  if (keywords.length === 0) return intent;

  const kept: string[] = [];
  const lists: Record<IntentField, string[]> = {
    genres: [...(intent.objective?.genres ?? [])],
    themes: [...(intent.objective?.themes ?? [])],
    platforms: [...(intent.objective?.platforms ?? [])],
    gameModes: [...(intent.objective?.gameModes ?? [])],
    perspectives: [...(intent.objective?.perspectives ?? [])],
  };

  let changed = false;
  for (const keyword of keywords) {
    const hit = resolveEnumFieldFromKeyword(keyword);
    if (hit) {
      if (!lists[hit.field].includes(hit.value)) {
        lists[hit.field].push(hit.value);
        changed = true;
      }
    } else {
      kept.push(keyword);
    }
  }

  if (kept.length === keywords.length && !changed) return intent;

  const objective = {
    genres: lists.genres.length > 0 ? lists.genres : null,
    themes: lists.themes.length > 0 ? lists.themes : null,
    platforms: lists.platforms.length > 0 ? lists.platforms : null,
    gameModes: lists.gameModes.length > 0 ? lists.gameModes : null,
    perspectives: lists.perspectives.length > 0 ? lists.perspectives : null,
  } as NonNullable<GameSearchIntent["objective"]>;

  return {
    ...intent,
    keywords: kept.length > 0 ? kept : null,
    objective,
  };
}
