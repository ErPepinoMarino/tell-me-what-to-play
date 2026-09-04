import path from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prismaBin = path.resolve(__dirname, "../node_modules/.bin/prisma");

// Cargamos el .env.test de la raíz del proyecto (misma ubicación que usa Vitest vía Vite).
// override: true fuerza que .env.test sea la fuente de verdad única, aunque exista
// una variable DATABASE_URL ambiental en la sesión (p.ej. exportada a mano).
dotenv.config({
  path: path.resolve(process.cwd(), "../.env.test"),
  override: true,
});

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("No se encontró DATABASE_URL en .env.test");
  process.exit(1);
}

// Usamos la URL de test completa para conectarnos y gestionar la BDD
const testConnectionString = databaseUrl;

// Extraemos el nombre de la BDD de test de forma robusta usando URL
const parsedUrl = new URL(testConnectionString);
const dbName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));

// Conectamos a la base de datos de mantenimiento "postgres" (mismo host/puerto/credenciales)
// para poder crear la BDD de test si no existe.
const adminUrl = new URL(testConnectionString);
adminUrl.pathname = "/postgres";

console.log(
  `# Conectando a PostgreSQL en ${adminUrl.hostname}:${adminUrl.port ?? 5432}`,
);
console.log(`# Base de datos de test objetivo: ${dbName}`);

const adminClient = new Client({ connectionString: adminUrl.toString() });

async function main(): Promise<void> {
  await adminClient.connect();

  // Comprobamos si la BDD de test ya existe
  const result = await adminClient.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [dbName],
  );

  const exists = result.rowCount === 1;

  if (exists) {
    console.log(`# La base de datos ${dbName} ya existe.`);
  } else {
    console.log(`Creando la base de datos ${dbName}...`);
    await adminClient.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    console.log(`# Base de datos ${dbName} creada.`);
  }

  await adminClient.end();

  // Aplicamos las migraciones a la BDD de test (misma estructura que la principal)
  console.log(`#Aplicando migraciones a ${dbName}...`);

  const envForMigration = {
    ...process.env,
    DATABASE_URL: testConnectionString,
  };

  // Ejecutamos el binario local de Prisma (7.9.1) para evitar que npx
  // resuelva a una versión global distinta. No modificamos prisma.config.ts.
  const migrateResult = spawnSync(prismaBin, ["migrate", "deploy"], {
    cwd: process.cwd(),
    env: envForMigration,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (migrateResult.status !== 0) {
    console.error(
      "# ERROR:No se pudieron aplicar las migraciones a la base de datos de test.",
    );
    process.exit(1);
  }

  console.log(
    "# Base de datos de test lista (creada + migraciones aplicadas).",
  );
}

// Reusable para CLI (test:setup) y vitest globalSetup.
export async function setupTestDatabase(): Promise<void> {
  await main();
}

// Solo se ejecuta cuando se invoca directamente (tsx scripts/setupTestDb.ts)
if (import.meta.url === `file://${process.argv[1]}`) {
  setupTestDatabase();
}
