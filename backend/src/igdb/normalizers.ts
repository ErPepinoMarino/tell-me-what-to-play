// Pure functions: IGDB raw values -> TMWTP domain values.
// No HTTP, no Prisma, no AI. Fully deterministic and testable offline.
// Basicamente funciones puras de lógica y matemática pura, trabajo para la IA.
// Normalizamos y adaptamos los datos de IGDB a los campos de nuestra BDD.

/*
Converts an IGDB epoch timestamp (seconds) into a calendar year (UTC).
Returns null when the date is absent or invalid — we never invent data.
 */

export function extractYear(epochSeconds: number | undefined): number | null {
  if (epochSeconds === undefined) {
    return null;
  }
  //multiplicar por 1000 para convertir de segundos a milisegundos
  const date = new Date(epochSeconds * 1000);

  // Si el timestamp es inválido, date.getTime() devuelve NaN. En ese caso, devolvemos null.
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  // Transformamos a UTC.
  return date.getUTCFullYear();
}

import type {
  GameMode,
  Genre,
  Perspective,
  Platform,
  Theme,
} from "../generated/prisma/enums.js";

// Mapa explícito: nombre IGDB -> Genre de TMWTP (1:1 con la taxonomía real
// de IGDB; nombres tomados de la API, por eso no hay "Action" ni "Casual").
const GENRE_MAP: Record<string, Genre> = {
  "Adventure": "ADVENTURE",
  "Arcade": "ARCADE",
  "Card & Board Game": "CARD_AND_BOARD_GAME",
  "Fighting": "FIGHTING",
  "Hack and slash/Beat 'em up": "HACK_AND_SLASH_BEAT_EM_UP",
  "Indie": "INDIE",
  "MOBA": "MOBA",
  "Music": "MUSIC",
  "Pinball": "PINBALL",
  "Platform": "PLATFORM",
  "Point-and-click": "POINT_AND_CLICK",
  "Puzzle": "PUZZLE",
  "Quiz/Trivia": "QUIZ_TRIVIA",
  "Racing": "RACING",
  "Real Time Strategy (RTS)": "REAL_TIME_STRATEGY",
  "Role-playing (RPG)": "ROLE_PLAYING_RPG",
  "Shooter": "SHOOTER",
  "Simulator": "SIMULATOR",
  "Sport": "SPORT",
  "Strategy": "STRATEGY",
  "Tactical": "TACTICAL",
  "Turn-based strategy (TBS)": "TURN_BASED_STRATEGY",
  "Visual Novel": "VISUAL_NOVEL",
};

// Mapa explícito: nombre IGDB -> Theme de TMWTP (taxonomía /v4/themes).
const THEME_MAP: Record<string, Theme> = {
  "Action": "ACTION",
  "Business": "BUSINESS",
  "Comedy": "COMEDY",
  "Drama": "DRAMA",
  "Educational": "EDUCATIONAL",
  "Erotic": "EROTIC",
  "Fantasy": "FANTASY",
  "4X (explore, expand, exploit, and exterminate)": "FOUR_X",
  "Historical": "HISTORICAL",
  "Horror": "HORROR",
  "Kids": "KIDS",
  "Mystery": "MYSTERY",
  "Non-fiction": "NON_FICTION",
  "Open world": "OPEN_WORLD",
  "Party": "PARTY",
  "Romance": "ROMANCE",
  "Sandbox": "SANDBOX",
  "Science fiction": "SCIENCE_FICTION",
  "Stealth": "STEALTH",
  "Survival": "SURVIVAL",
  "Thriller": "THRILLER",
  "Warfare": "WARFARE",
};

export interface EnumNormalization<T> {
  values: T[];
  unclassified: string[];
}

/*
 * Genérico compartido por todos los normalizadores de enums.
 * Filosofía del pipeline: lo conocido se mapea al enum;
 * lo desconocido NUNCA se descarta, se conserva en "unclassified"
 * para que el mapper lo añada a keywords. Así ningún importador
 * (IGDB hoy, RAWG/Steam mañana) pierde información.
 */
function mapToEnum<T extends string>(
  names: string[] | undefined,
  map: Record<string, T>,
): EnumNormalization<T> {
  if (!names || names.length === 0) {
    return { values: [], unclassified: [] };
  }
  const values: T[] = [];
  const unclassified: string[] = [];
  for (const name of names) {
    const mapped = map[name];
    if (mapped) {
      values.push(mapped);
    } else {
      unclassified.push(name);
    }
  }
  return { values: [...new Set(values)], unclassified };
}

/*
 * Mapea nombres de género de IGDB al enum Genre de TMWTP (1:1).
 * Lo no mapeable va a "unclassified" (→ keywords, nunca se descarta).
 */
export function normalizeGenres(names: string[] | undefined): EnumNormalization<Genre> {
  return mapToEnum(names, GENRE_MAP);
}

/*
 * Mapea nombres de theme de IGDB al enum Theme de TMWTP (1:1).
 */
export function normalizeThemes(names: string[] | undefined): EnumNormalization<Theme> {
  return mapToEnum(names, THEME_MAP);
}

// Mapa explícito: nombre IGDB -> Platform de TMWTP.
// Nombres exactos de la API de IGDB. Las plataformas son metadata técnica:
// lo que no tenga equivalencia se DESCARTA (no va a keywords).
const PLATFORM_MAP: Record<string, Platform> = {
  "PC (Microsoft Windows)": "PC",
  "Mac": "MAC",
  "Linux": "LINUX",
  "PlayStation 5": "PS5",
  "PlayStation 4": "PS4",
  "PlayStation 3": "PS3",
  "PlayStation 2": "PS2",
  "PlayStation": "PS1",
  "PS Vita": "PS_VITA",
  "PlayStation Portable": "PSP",
  "Xbox Series X|S": "XBOX_SERIES",
  "Xbox One": "XBOX_ONE",
  "Xbox 360": "XBOX_360",
  "Xbox": "XBOX",
  "Nintendo Switch": "SWITCH",
  "Wii U": "WII_U",
  "Wii": "WII",
  "Nintendo GameCube": "GAMECUBE",
  "Nintendo 64": "N64",
  "Super Nintendo Entertainment System (SNES)": "SNES",
  "Nintendo Entertainment System (NES)": "NES",
  "Nintendo 3DS": "NINTENDO_3DS",
  "Nintendo DS": "DS",
  "Game Boy": "GAME_BOY",
  "Game Boy Color": "GAME_BOY",
  "Game Boy Advance": "GAME_BOY_ADVANCE",
  "iOS": "IOS",
  "Android": "ANDROID",
};

/*
 * Mapea nombres de plataforma de IGDB al enum Platform de TMWTP.
 * Lo no mapeable (ej. "Sega Saturn", "Ouya") va a "unclassified" -> keywords.
 */
export function normalizePlatforms(names: string[] | undefined): EnumNormalization<Platform> {
  return mapToEnum(names, PLATFORM_MAP);
}

// Mapa explícito: nombre IGDB -> GameMode de TMWTP.
// Los game_modes de IGDB (id 1-6): Single player, Multiplayer, Co-operative,
// Split screen, Massively Multiplayer Online, Battle Royale. Split screen
// colapsa en MULTIPLAYER; Battle Royale queda "unclassified" -> keyword.
const GAME_MODE_MAP: Record<string, GameMode> = {
  "Single player": "SINGLE_PLAYER",
  "Multiplayer": "MULTIPLAYER",
  "Co-operative": "COOPERATIVE",
  "Split screen": "MULTIPLAYER",
  "Massively Multiplayer Online (MMO)": "MASSIVELY_MULTIPLAYER",
};

export function normalizeGameModes(names: string[] | undefined): EnumNormalization<GameMode> {
  return mapToEnum(names, GAME_MODE_MAP);
}

// Mapa explícito: nombre IGDB -> Perspective de TMWTP.
// IGDB tiene más perspectivas (ej. "Auditory", "Virtual Reality") que quedarían
// como unclassified -> keywords, sin perder la información.
const PERSPECTIVE_MAP: Record<string, Perspective> = {
  "First person": "FIRST_PERSON",
  "Third person": "THIRD_PERSON",
  "Top-down": "TOP_DOWN",
  "Isometric": "ISOMETRIC",
  "Side view": "SIDE_VIEW",
  "Text": "TEXT",
};

export function normalizePerspectives(names: string[] | undefined): EnumNormalization<Perspective> {
  return mapToEnum(names, PERSPECTIVE_MAP);
}

/*
 * Keywords de IGDB + "unclassified" de los enums (los THEMES ya no se
 * fusionan aquí: tienen su propia columna). Trim, sin vacíos y deduplicando
 * case-insensitive (se conserva la primera forma que llega).
 */
export function normalizeKeywords(
  keywords: string[] | undefined,
  extra: string[] | undefined = [],
): string[] {
  const seen = new Set<string>(); // forma lowercase ya vista
  const result: string[] = [];

  for (const term of [...(keywords ?? []), ...(extra ?? [])]) {
    const trimmed = term?.trim();
    if (!trimmed) continue; // vacío o solo espacios
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue; // duplicado case-insensitive
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

/*
 * Genera el slug determinista del juego a partir del título y el año.
 * Minúsculas, acentos normalizados, todo lo no alfanumérico -> "-",
 * guiones colapsados y sin guiones en los extremos.
 * El año se añade como sufijo solo si existe.
 * NOTA: las colisiones no se resuelven aquí (la función es pura y no conoce
 * la BDD); el import service añadirá el igdb_id como sufijo si hace falta.
 */
export function generateSlug(title: string, year: number | null): string {
  const normalized = title
    .toLowerCase()
    .normalize("NFD") // separa acentos: "é" -> "e" + combining accent
    .replace(/[\u0300-\u036f]/g, "") // elimina los combining accents
    .replace(/[^a-z0-9]+/g, "-") // todo lo no alfanumérico -> "-"
    .replace(/^-+|-+$/g, ""); // guiones en extremos fuera

  return year === null ? normalized : `${normalized}-${year}`;
}

/*
 * Resolución inversa enum → nombres IGDB, para las consultas filtradas de
 * discovery (where genres = (id) exige los IDs reales de IGDB, que resolvemos
 * por nombre con los mismos mapas que usan los mappers).
 */
const GENRE_REVERSE: Map<Genre, string[]> = (() => {
  const map = new Map<Genre, string[]>();
  for (const [igdbName, genre] of Object.entries(GENRE_MAP) as [string, Genre][]) {
    const names = map.get(genre) ?? [];
    names.push(igdbName);
    map.set(genre, names);
  }
  return map;
})();

// Slug IGDB de un theme (resolución directa por slug en filteredSearch).
const THEME_SLUGS: Record<Exclude<Theme, "UNKNOWN">, string> = {
  ACTION: "action",
  BUSINESS: "business",
  COMEDY: "comedy",
  DRAMA: "drama",
  EDUCATIONAL: "educational",
  EROTIC: "erotic",
  FANTASY: "fantasy",
  FOUR_X: "4x-explore-expand-exploit-and-exterminate",
  HISTORICAL: "historical",
  HORROR: "horror",
  KIDS: "kids",
  MYSTERY: "mystery",
  NON_FICTION: "non-fiction",
  OPEN_WORLD: "open-world",
  PARTY: "party",
  ROMANCE: "romance",
  SANDBOX: "sandbox",
  SCIENCE_FICTION: "science-fiction",
  STEALTH: "stealth",
  SURVIVAL: "survival",
  THRILLER: "thriller",
  WARFARE: "warfare",
};

// Nombres IGDB posibles para un enum de género (vacío si UNKNOWN).
export function genreIgbNames(genre: Genre): string[] {
  return GENRE_REVERSE.get(genre) ?? [];
}

// Slug IGDB de un theme.
export function themeIgbSlug(theme: Theme): string | null {
  return theme === "UNKNOWN" ? null : THEME_SLUGS[theme];
}

// ID numérico de IGDB de cada theme (taxonomía estable /v4/themes).
// Mapa FIJO: no se consulta IGDB en runtime (los IDs no cambian).
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

export function themeIgbId(theme: Theme): number | null {
  return theme === "UNKNOWN" ? null : THEME_IGB_IDS[theme];
}

// Reverse: slug IGDB de theme -> enum (para el guard anti-sueño del intent:
// si la LLM metió "horror" en keywords, se redirige a themes).
export const THEME_BY_SLUG: Record<string, Exclude<Theme, "UNKNOWN">> =
  Object.fromEntries(
    Object.entries(THEME_SLUGS).map(([theme, slug]) => [slug, theme]),
  ) as Record<string, Exclude<Theme, "UNKNOWN">>;

const PLATFORM_REVERSE: Map<Platform, string[]> = (() => {
  const map = new Map<Platform, string[]>();
  for (const [igdbName, platform] of Object.entries(PLATFORM_MAP) as [string, Platform][]) {
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
  for (const [igdbName, perspective] of Object.entries(PERSPECTIVE_MAP) as [string, Perspective][]) {
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

// Slug IGDB de una keyword canónica ("pixel art" → "pixel-art").
export function keywordIgbSlug(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, "-");
}
