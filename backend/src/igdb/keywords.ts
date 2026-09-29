/*
 * ÚNICO módulo que fabrica IgdbKeyword (los casts fuera están prohibidos por lint).
 *  - extractIgdbKeywords(raw): único mint legítimo — raw.keywords tal cual (orden
 *    y multiplicidad del raw, sin trim/dedupe/canonicalizar) + freeze.
 *  - brandStoredIgdbKeywords: re-aserción de lectura de los ya persistidos.
 */
import type { IgdbGameRaw } from "./types.js";
import type { IgdbKeyword } from "../types/keywords.js";

export function extractIgdbKeywords(raw: IgdbGameRaw): readonly IgdbKeyword[] {
  const names = (raw.keywords ?? []).map((keyword) => keyword.name);
  return Object.freeze(names) as readonly IgdbKeyword[];
}

export function brandStoredIgdbKeywords(
  names: readonly string[],
): readonly IgdbKeyword[] {
  return Object.freeze([...names]) as readonly IgdbKeyword[];
}