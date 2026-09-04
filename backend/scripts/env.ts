import path from "node:path";
import dotenv from "dotenv";

// Carga el .env de la raíz del proyecto (misma ubicación que prisma.config.ts).
// IMPORTANTE: este módulo debe importarse ANTES que cualquier módulo que lea
// process.env en tiempo de carga (p.ej. src/lib/prisma.ts), porque ESM evalúa
// los imports antes que el cuerpo del script.
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

// El .env de raíz apunta a host "postgres" (nombre del contenedor Docker).
// Al ejecutar scripts desde el host, el puerto 5432 está publicado en localhost,
// así que re-mapeamos la conexión a localhost para que funcione fuera del contenedor.
if (
  process.env.DATABASE_URL &&
  process.env.DATABASE_URL.includes("@postgres:")
) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    "@postgres:",
    "@localhost:",
  );
}
