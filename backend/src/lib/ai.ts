import { ChatOpenAI } from "@langchain/openai";
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
