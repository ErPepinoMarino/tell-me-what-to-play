import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

const permissionName = "user_games:manage";
const roles = ["USER", "ADMIN"] as const;

async function main() {
  const permission = await prisma.permissions.upsert({
    where: { name: permissionName },
    update: {},
    create: { name: permissionName },
  });

  for (const role of roles) {
    await prisma.role_permissions.upsert({
      where: {
        role_permission_id: {
          role,
          permission_id: permission.id,
        },
      },
      update: {},
      create: {
        role,
        permission_id: permission.id,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("RBAC seed failed:", error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
