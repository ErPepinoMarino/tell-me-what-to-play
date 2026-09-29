/*
 * CLI manual del bootstrap del catálogo popular. La lógica vive en
 * src/services/seedCatalogService.ts (el server también la ejecuta al arrancar);
 * este CLI permite forzarla sin levantar la API.
 * Uso: npm run seed:catalog   (desde backend/, con PG accesible)
 */
import "./env.js";
import { prismaCatalogLayer } from "../src/orchestrator/adapters.js";
import { ensureSeedCatalog } from "../src/services/seedCatalogService.js";
import { prisma } from "../src/lib/prisma.js";

async function main(): Promise<void> {
  const result = await ensureSeedCatalog(prismaCatalogLayer);
  console.log(
    `# Seed de catálogo completado: ${result.created} creadas, ${result.skipped} ya existentes.`,
  );
  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("# ERROR: no se pudo sembrar el catálogo:", error);
    process.exit(1);
  });
