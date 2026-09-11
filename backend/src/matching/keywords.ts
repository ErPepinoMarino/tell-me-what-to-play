// Normalización ligera de keywords para el matching: minúsculas + talo
// singular quitando una 's' final ("zombies" -> "zombie", "pirates" ->
// "pirate"). Regla deliberadamente mínima y segura: false negatives raros
// ("city"/"cities") son preferibles a falsos positivos.
export function keywordStem(keyword: string): string {
  const normalized = keyword.trim().toLowerCase();

  if (
    normalized.endsWith("s") &&
    !normalized.endsWith("ss") &&
    normalized.length > 3
  ) {
    return normalized.slice(0, -1);
  }

  return normalized;
}

import type { SearchKeyword } from "../types/keywords.js";

/*
 * Único mint de SearchKeyword: vocabulario de BÚSQUEDA (query del usuario,
 * pistas de búsqueda / SearchContext.hints, additionalKeywords del LLM). Son
 * términos que se comparan contra Game.keywords en el matcher o se resuelven
 * a IGDB para el WHERE, pero NUNCA se persisten. Su marca los hace no
 * asignables a IgdbKeyword[].
 */
export function mintSearchKeywords(terms: readonly string[]): readonly SearchKeyword[] {
  return Object.freeze([...terms]) as readonly SearchKeyword[];
}

/*
 * Palabras vacías que nunca deben convertirse en keyword: la construcción de
 * pistas de búsqueda (buildSearchHints en discovery) parte las queries en
 * palabras y, sin este filtro, "and" o "the" acabarían como pistas de
 * matching y en el léxico (hallazgo del minado FASE 1).
 * Compartido por las pistas de búsqueda (discovery) y el minado del léxico.
 */
export const KEYWORD_STOPWORDS = new Set([
  "and",
  "the",
  "of",
  "for",
  "with",
  "a",
  "an",
  "in",
  "on",
  "to",
  "by",
  "at",
  "or",
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "y",
  "o",
]);

/*
 * Torniquete de género (diseño: específico del español, idioma de la UI).
 * El modelo a veces "expande inclusivamente" lo que el usuario pide
 * ("vaqueros" → cowboys + cowgirls) aunque el prompt lo prohíbe.
 * Esto ha pasado tantas veces testeando que ha hecho necesario especificarlo.
 * Supongo que sera cosa del gpt 4, es lo que hay.
 */

// Parejas de género en inglés [masculino, femenino], en singular.
const GENDER_PAIRS: [string, string][] = [
  ["cowboy", "cowgirl"],
  ["hero", "heroine"],
  ["actor", "actress"],
  ["waiter", "waitress"],
  ["boy", "girl"],
  ["man", "woman"],
  ["male", "female"],
];

// ¿El término es esta cara de la pareja? Tolera plural (+s/+es).
function matchesSide(term: string, side: string): boolean {
  const lower = term.trim().toLowerCase();
  if (!lower.startsWith(side)) return false;
  const rest = lower.slice(side.length);
  return rest === "" || rest === "s" || rest === "es";
}

function stripAccents(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const MASCULINE_ENDINGS = ["o", "os", "or", "ores", "on", "ones"];
const FEMININE_ENDINGS = [
  "a",
  "as",
  "ora",
  "oras",
  "esa",
  "esas",
  "ona",
  "onas",
];

// Tokens del mensaje con género gramatical evidente (sin tildes, >3
// letras, fuera de stopwords: así "más"→"mas" no cuenta como femenino).
function messageGenders(message: string): { masc: boolean; fem: boolean } {
  const tokens = stripAccents(message)
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length > 3 && !KEYWORD_STOPWORDS.has(t));
  let masc = false;
  let fem = false;
  for (const token of tokens) {
    if (token === "mas") continue;
    if (FEMININE_ENDINGS.some((ending) => token.endsWith(ending))) {
      fem = true;
    } else if (MASCULINE_ENDINGS.some((ending) => token.endsWith(ending))) {
      masc = true;
    }
  }
  return { masc, fem };
}

export interface GenderCheckedKeywords {
  kept: string[] | null;
  dropped: string[];
}

// Filtra añadidos con género contradicho por el mensaje. null se preserva.
export function filterGenderMismatchedAdditions(
  message: string,
  added: string[] | null | undefined,
): GenderCheckedKeywords {
  if (!added) return { kept: added ?? null, dropped: [] };
  const loweredMessage = message.trim().toLowerCase();
  const { masc, fem } = messageGenders(message);
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const term of added) {
    let side: "masc" | "fem" | null = null;
    for (const [mascSide, femSide] of GENDER_PAIRS) {
      if (matchesSide(term, femSide)) {
        side = "fem";
        break;
      }
      if (matchesSide(term, mascSide)) {
        side = "masc";
        break;
      }
    }
    if (side === null) {
      kept.push(term);
      continue;
    }
    // Mención literal en el mensaje manda sobre todo lo demás.
    if (loweredMessage.includes(term.trim().toLowerCase())) {
      kept.push(term);
      continue;
    }
    if (side === "fem" && masc && !fem) {
      dropped.push(term);
      continue;
    }
    if (side === "masc" && fem && !masc) {
      dropped.push(term);
      continue;
    }
    kept.push(term);
  }
  return { kept, dropped };
}
