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

/*
 * Palabras vacías que nunca deben convertirse en keyword: el siembra de
 * discovery parte las queries en palabras y, sin este filtro, "and" o "the"
 * acababan en el catálogo y en el léxico (hallazgo del minado FASE 1).
 * Compartido por el siembra (discovery) y el minado del léxico.
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
