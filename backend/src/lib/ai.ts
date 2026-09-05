import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { GameSearchIntentSchema } from "../types/GameSearchIntent.js";

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
 * Clasificador de relación refine-vs-new (anon sin sesión): un modelo
 * dedicado con output mínimo — solo decide si el mensaje AFINA la búsqueda
 * anterior o EMPIEZA OTRA. Ver classifyRelation en intentService.
 */
const RelationSchema = z.object({
  relation: z.enum(["new", "refine"]),
});

const relationModel = model.withStructuredOutput(RelationSchema, {
  strict: true,
});

export function gameRelationAIModel() {
  return relationModel;
}
