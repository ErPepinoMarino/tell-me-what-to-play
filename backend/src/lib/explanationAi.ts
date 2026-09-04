// Básicamente lo mismo que ai.ts y enrichmentAi.ts pero para la redacción
// de la explicación conversacional: temperatura algo mayor porque es
// lenguaje natural, no extracción de datos.
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.4,
});

export function gameExplanationAIModel() {
  return model;
}
