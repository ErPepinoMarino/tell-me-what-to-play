// Básicamente lo mismo que ai.ts pero por si quisiéramos usar un modelo distinto para cada cosa.
import { ChatOpenAI } from "@langchain/openai";
import { GameEnrichmentSchema } from "../types/GameEnrichment.js";

const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0,
});

const structuredModel = model.withStructuredOutput(GameEnrichmentSchema, {
  strict: true,
});

export function gameEnrichmentAIModel() {
  return structuredModel;
}
