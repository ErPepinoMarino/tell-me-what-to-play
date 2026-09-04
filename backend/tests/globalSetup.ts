import { setupTestDatabase } from "../scripts/setupTestDb.js";

// Vitest globalSetup: se ejecuta una vez antes de todos los proyectos de test.
// Crea la BD de test y aplica migraciones automáticamente.
export default async function globalSetup(): Promise<void> {
  await setupTestDatabase();
}
