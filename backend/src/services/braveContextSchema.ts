import { z } from "zod";

/*
 * Respuesta del endpoint LLM Context de Brave Search API.
 * Solo validamos las partes que usamos: grounding.generic[] con url + snippets[].
 * El resto de campos que Brave pueda devolver se ignora.
 */
export const BraveContextSchema = z.object({
  grounding: z.object({
    generic: z.array(
      z.object({
        url: z.string(),
        title: z.string().optional(),
        snippets: z.array(z.string()),
      }),
    ),
  }),
});

export type BraveContext = z.infer<typeof BraveContextSchema>;
