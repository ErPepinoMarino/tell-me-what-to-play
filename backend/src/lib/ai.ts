import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import {
  GameSearchIntentSchema,
  RefineDeltaSchema,
} from "../types/GameSearchIntent.js";

const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0,
});

const structuredModel = model.withStructuredOutput(GameSearchIntentSchema, {
  strict: true,
});

export function gameIntentAIModel() {
  return structuredModel;
}

/*
 * Clasificador de relación entre el mensaje actual y la intención previa.
 * Output mínimo: solo decide new/refine/nonsensical. No extrae intención.
 */
const RelationSchema = z.object({
  relation: z.enum(["new", "refine", "nonsensical"]),
});

const relationModel = model.withStructuredOutput(RelationSchema, {
  strict: true,
});

export function gameRelationAIModel() {
  return relationModel;
}

/*
 * Extracción delta del refinamiento: el usuario YA decidió refinar (relación
 * decidida por el extractor de intención); este modelo solo extrae qué se
 * AÑADE/AJUSTA, qué se QUITA y qué exclusiones nuevas trae el mensaje. Nunca
 * regenera el intent completo: el merge es determinista (applyRefineDelta).
 */
const refineDeltaModel = model.withStructuredOutput(RefineDeltaSchema, {
  strict: true,
});

export function gameRefineDeltaAIModel() {
  return refineDeltaModel;
}
