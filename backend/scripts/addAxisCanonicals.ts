/*
 * TEMPORAL: añade "2d" y "3d" como canónicos curados al draft del léxico.
 * Conceptos centrales de estilo visual que faltaban; sin ellos, "3d" asimilaba
 * erróneamente a "3d racing" por embedding (falsa fusión detectada en el
 * dry-run de FASE 3). lexicon:accept calcula sus embeddings. Se borra tras usar.
 */
import fs from "node:fs";

const draftPath = "reports/lexicon-draft.json";
const draft = JSON.parse(fs.readFileSync(draftPath, "utf8"));

for (const canonical of ["2d", "3d"]) {
  if (!draft.entries.some((entry: { canonical: string }) => entry.canonical === canonical)) {
    draft.entries.push({
      canonical,
      frequency: 0,
      aliases: [],
      source: "curated",
    });
  }
}

fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));
console.log(`# Draft: ${draft.entries.length} entradas (2d y 3d añadidos como curados)`);
