import { prisma } from "../../src/lib/prisma.js";

const testDatabaseName = "tellmewhattoplay_test";

export async function resetTestDatabase(): Promise<void> {
  const databases = await prisma.$queryRaw<{ current_database: string }[]>`
    SELECT current_database()
  `;

  if (databases[0]?.current_database !== testDatabaseName) {
    throw new Error(
      `Refusing to reset database ${databases[0]?.current_database ?? "unknown"}`,
    );
  }

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "refresh_tokens",
      "user_identities",
      "sessions",
      "user_games",
      "role_permissions",
      "users",
      "games",
      "permissions"
    RESTART IDENTITY CASCADE
  `);
}
