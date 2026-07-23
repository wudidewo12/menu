import fs from "node:fs";

import dotenv from "dotenv";

const localEnvironment = dotenv.parse(fs.readFileSync(".env.local"));
const databaseUrl = localEnvironment.DATABASE_URL;
const applicationRole = localEnvironment.POSTGRES_APP_USER;

if (!databaseUrl || !applicationRole) {
  throw new Error("DATABASE_URL and POSTGRES_APP_USER are required in .env.local");
}

process.env.DATABASE_URL = databaseUrl;
process.env.POSTGRES_APP_USER = applicationRole;

delete process.env.DATABASE_ADMIN_URL;
delete process.env.POSTGRES_OWNER;
delete process.env.POSTGRES_OWNER_PASSWORD;
delete process.env.POSTGRES_APP_PASSWORD;

const [{ importMenuSeed }, { createMenuSeedImportPlan }, { prisma }] = await Promise.all([
  import("../src/server/db/menu-seed-import.ts"),
  import("../src/server/db/menu-seed-transform.ts"),
  import("../src/server/db/prisma.ts"),
]);

try {
  const plan = await createMenuSeedImportPlan();
  const result = await importMenuSeed(plan);

  console.log(`imported menu: ${result.menuSlug}`);
  console.log(`menu id: ${result.menuId}`);
  console.log("record counts:");

  for (const [model, count] of Object.entries(result.counts)) {
    console.log(`  ${model}: ${count}`);
  }

  console.log(`dish id sequence: ${result.dishSequenceValue}`);
  console.log("transaction: committed");
} finally {
  await prisma.$disconnect();
}
