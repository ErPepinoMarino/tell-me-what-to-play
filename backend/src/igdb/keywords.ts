/*
 * ÚNICO módulo que fabrica IgdbKeyword. Regla de la arquitectura:
 * "la creación de un IgdbKeyword debe estar limitada al código que recibe
 * datos reales procedentes del RAW de IGDB".
 *
 *  - extractIgdbKeywords(raw): el único mint legítimo. Lee exclusivamente
 *    `raw.keywords`, en el orden y con la multiplicidad exacta del raw, sin
 *    trim, sin lowercase, sin dedupe, sin ordenar, sin canonicalizar. La
 *    única transformación es {id,name} → name, necesaria para representar
 *    el array de IGDB en nuestro dominio. Freeze: barrera de runtime contra
 *    mutación in-place posterior.
 *  - brandStoredIgdbKeywords(names): re-aserción de lectura. Concede la
 *    marca a strings que YA salieron de extractIgdbKeywords y volvieron de
 *    la BDD (provenance="igdb"). NO es un mint arbitrario: solo tiene
 *    sentido para filas cuya escritura pasó por el pipeline sellado. La
 *    migración de la BD existente debe verificar el contenido antes de
 *    conceder provenance="igdb" (fail-closed). Fuera de este módulo está
 *    prohibido fabricar IgdbKeyword con casts (ver eslint.config.js).
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