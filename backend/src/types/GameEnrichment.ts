import { z } from "zod";

// Escala 0-1. null = no hay evidencia suficiente para inferir la cualidad.
const SemanticScore = z.number().min(0).max(1).nullable();

export const SemanticSchema = z.object({
  complexity: SemanticScore,
  coziness: SemanticScore,
  darkness: SemanticScore,
  difficulty: SemanticScore,
  exploration: SemanticScore,
  horror: SemanticScore,
  humor: SemanticScore,
  isolation: SemanticScore,
  narrative: SemanticScore,
  pace: SemanticScore,
  strategy: SemanticScore,
  tension: SemanticScore,
  violence: SemanticScore,
});

export type Semantic = z.infer<typeof SemanticSchema>;

/*
 * Output estructurado del LLM durante el enriquecimiento: semantic (13 dimensiones
 * SÓLO con evidencia), description_es/en breves y bilingües, y additionalKeywords
 * (vocabulario abierto, señal transitoria del gate de valor: jamás se persiste ni
 * se fusiona con Game.keywords).
 */
export const GameEnrichmentSchema = z.object({
  semantic: SemanticSchema,
  additionalKeywords: z.array(z.string()),
  description_es: z.string(),
  description_en: z.string(),
});

export type GameEnrichment = z.infer<typeof GameEnrichmentSchema>;

/*
 * Lo que el enriquecimiento PUEDE escribir en una ficha (contrato de
 * persistencia): descripciones bilingües y semánticas. Sin canal de
 * keywords: el vocabulario de keywords de la BDD es exclusivamente IGDB
 * (mappers.ts). Las keywords "adicionales" del LLM viajan como señal
 * transitoria del gate de valor, nunca llegan aquí.
 */
export interface EnrichmentEditable {
  description_es: string;
  description_en: string;
  semantic: Semantic;
}
