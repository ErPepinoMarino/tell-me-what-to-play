import "./env.js";
import { ImportService } from "../src/services/importService.js";
import { createIgdbClient } from "../src/igdb/index.js";
import { createEnrichmentService } from "../src/services/enrichmentService.js";
import { prismaGameRepository } from "../src/repositories/prismaGameRepository.js";

function parseArgs(argv: string[]): { query: string; limit: number } {
  const query = argv[0];
  if (!query) {
    console.error("Uso: tsx scripts/importGames.ts <query> [--limit N]");
    process.exit(1);
  }

  const limitIndex = argv.indexOf("--limit");
  const limit =
    limitIndex !== -1 && argv[limitIndex + 1]
      ? Number.parseInt(argv[limitIndex + 1], 10)
      : 10;

  if (!Number.isFinite(limit) || limit < 1) {
    console.error("ERROR: --limit debe ser un número positivo.");
    process.exit(1);
  }

  return { query, limit };
}

async function main(): Promise<void> {
  const { query, limit } = parseArgs(process.argv.slice(2));

  const importService = new ImportService(
    createIgdbClient(),
    createEnrichmentService(),
    prismaGameRepository,
  );

  console.log(`# Importando "${query}" (límite ${limit})...`);
  const result = await importService.importByQuery(query, limit);

  console.log(`# Creados: ${result.created}`);
  console.log(`# Omitidos (ya existían): ${result.skipped}`);
  if (result.errors.length > 0) {
    console.error(
      `# Errores (${result.errors.length}): ` +
        result.errors
          .map((e) => `[rawId ${e.rawId}] ${e.error.message}`)
          .join("\n"),
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("ERROR crítico:", error);
  process.exit(1);
});
