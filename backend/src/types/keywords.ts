/*
 * Dos conceptos que NO comparten tipo: IgdbKeyword (solo raw.keywords de IGDB, mint
 * sellado en src/igdb/keywords.ts; única semántica de Game.keywords) y SearchKeyword
 * (vocabulario de BÚSQUEDA: query, hints y additionalKeywords del LLM; jamás
 * persistible). Marcas = símbolos únicos no exportados, fabricables solo con cast.
 */
declare const igdbKeywordBrand: unique symbol;
declare const searchKeywordBrand: unique symbol;

export type IgdbKeyword = string & { readonly [igdbKeywordBrand]: true };
export type SearchKeyword = string & { readonly [searchKeywordBrand]: true };