import { readFile, writeFile } from "node:fs/promises";

async function main() {
  // Leer el JSON
  const json = await readFile("./src/data/games_seed.json", "utf-8");

  // Convertir el texto en objetos JavaScript
  const games = JSON.parse(json);

  // Generar el contenido del archivo TypeScript
  const output =
    `import type { Game } from "@/types/Game";\n\n` +
    `export const games: Game[] = ` +
    JSON.stringify(games, null, 2) +
    `;\n`;

  // Escribir games.ts
  await writeFile("./src/data/games.ts", output);

  console.log("✅ games.ts generado correctamente.");
}

main().catch(console.error);
