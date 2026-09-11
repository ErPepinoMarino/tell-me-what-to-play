/*
 * Tres conceptos de keywords que NO deben compartir tipo:
 *
 *  - IgdbKeyword    → SOLO del vocabulario de `raw.keywords` de IGDB
 *                     (mint sellado en src/igdb/keywords.ts). Es lo único
 *                     persistible en las keywords de un juego IGDB.
 *  - SearchKeyword  → vocabulario de BÚSQUEDA: query del usuario, hints,
 *                     additionalKeywords del LLM. Jamás persistible.
 *  - CuratedKeyword → vocabulario curado/manual (seed). Jamás finge IGDB.
 *
 * Las marcas son símbolos únicos NO exportados: la única forma de fabricar
 * un valor es un cast `as` (prohibido por lint fuera de los módulos de
 * confianza) o un mint explícito. Ninguna de estas marcas es asignable a
 * otra, y todas sí son asignables a `string`/`readonly string[]`.
 */
declare const igdbKeywordBrand: unique symbol;
declare const searchKeywordBrand: unique symbol;
declare const curatedKeywordBrand: unique symbol;

export type IgdbKeyword = string & { readonly [igdbKeywordBrand]: true };
export type SearchKeyword = string & { readonly [searchKeywordBrand]: true };
export type CuratedKeyword = string & { readonly [curatedKeywordBrand]: true };