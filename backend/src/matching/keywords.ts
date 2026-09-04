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
