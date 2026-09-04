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

import type { GameMode, Genre, Perspective, Platform } from "../generated/prisma/enums.js";

// Mapa explícito: nombre IGDB -> Genre de TMWTP.
// Nombres tomados de la API real de IGDB; lo que no esté aquí queda "unclassified".
const GENRE_MAP: Record<string, Genre> = {
  "Action": "ACTION",
  "Adventure": "ADVENTURE",
  "Arcade": "ARCADE",
  "Casual": "CASUAL",
  "Fighting": "FIGHTING",
  "Horror": "HORROR",
  "Indie": "INDIE",
  "Massively Multiplayer": "MMO",
  "Platform": "PLATFORMER",
  "Puzzle": "PUZZLE",
  "Racing": "RACING",
  "Role-playing (RPG)": "RPG",
  "Shooter": "SHOOTER",
  "Simulation": "SIMULATION",
  "Sport": "SPORTS",
  "Strategy": "STRATEGY",
  "Visual Novel": "VISUAL_NOVEL",
};

// Nombres compuestos conocidos de IGDB que corresponden a más de un género TMWTP.
const COMPOSITE_GENRES: Record<string, Genre[]> = {
  "Action RPG": ["ACTION", "RPG"],
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
 * Mapea nombres de género de IGDB al enum Genre de TMWTP.
 * Primero intenta con los compuestos conocidos ("Action RPG" -> ACTION + RPG)
 * y después con el mapa simple. Lo no mapeable va a "unclassified".
 */
export function normalizeGenres(names: string[] | undefined): EnumNormalization<Genre> {
  if (!names || names.length === 0) {
    return { values: [], unclassified: [] };
  }

  const values: Genre[] = [];
  const unclassified: string[] = [];

  for (const name of names) {
    const composite = COMPOSITE_GENRES[name];
    const simple = GENRE_MAP[name];
    if (composite) {
      values.push(...composite);
    } else if (simple) {
      values.push(simple);
    } else {
      unclassified.push(name);
    }
  }

  return { values: [...new Set(values)], unclassified };
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
// IGDB solo tiene 5 game_modes; todos tienen equivalencia directa o colapsan
// en MULTIPLAYER (Split screen y MMO son formas de multiplayer).
const GAME_MODE_MAP: Record<string, GameMode> = {
  "Single player": "SINGLE_PLAYER",
  "Multiplayer": "MULTIPLAYER",
  "Co-operative": "COOPERATIVE",
  "Split screen": "MULTIPLAYER",
  "Massively Multiplayer Online (MMO)": "MULTIPLAYER",
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
 * Fusiona keywords y themes de IGDB (y futuros "unclassified") en un único
 * vocabulario abierto: keywords de IGDB primero, luego themes, luego extra.
 * Trim a cada término, se descartan los vacíos y se deduplica ignorando
 * mayúsculas/minúsculas (se conserva la primera forma que llega).
 */
export function normalizeKeywords(
  keywords: string[] | undefined,
  themes: string[] | undefined,
  extra: string[] | undefined = [],
): string[] {
  const seen = new Set<string>(); // forma lowercase ya vista
  const result: string[] = [];

  for (const term of [...(keywords ?? []), ...(themes ?? []), ...(extra ?? [])]) {
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
