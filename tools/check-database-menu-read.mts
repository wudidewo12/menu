import fs from "node:fs";

import dotenv from "dotenv";

import type { Menu } from "../src/types/menu.ts";

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

const [{ DEFAULT_MENU_READ_SLUG, readMenuFromDatabase }, { prisma }] = await Promise.all([
  import("../src/server/db/menu-read.ts"),
  import("../src/server/db/prisma.ts"),
]);

try {
  const sourceMenu = JSON.parse(fs.readFileSync("data/menu-seed.json", "utf8")) as Menu;
  const [databaseMenu, missingMenu] = await Promise.all([
    readMenuFromDatabase(),
    readMenuFromDatabase("missing-menu-for-read-check"),
  ]);

  if (!databaseMenu) {
    throw new Error(`Database menu "${DEFAULT_MENU_READ_SLUG}" was not found`);
  }

  if (missingMenu !== null) {
    throw new Error("Missing database menu must return null");
  }

  if (Number.isNaN(Date.parse(databaseMenu.updatedAt))) {
    throw new Error("Database menu updatedAt must be a valid ISO date");
  }

  const { updatedAt: sourceUpdatedAt, ...sourceComparable } = sourceMenu;
  const { updatedAt: databaseUpdatedAt, ...databaseComparable } = databaseMenu;

  if (JSON.stringify(databaseComparable) !== JSON.stringify(sourceComparable)) {
    throw new Error("Database menu response does not match the current seed menu");
  }

  const sectionSummary = databaseMenu.settings.sections
    .map((section) => `${section.id}=${section.dishIds?.length ?? 0}`)
    .join(", ");

  console.log(`menu slug: ${DEFAULT_MENU_READ_SLUG}`);
  console.log(`menu version: ${databaseMenu.version}`);
  console.log(`database updatedAt: ${databaseUpdatedAt}`);
  console.log(`source updatedAt: ${sourceUpdatedAt}`);
  console.log(`dishes: ${databaseMenu.dishes.length}`);
  console.log(`sections: ${databaseMenu.settings.sections.length}`);
  console.log(`section sizes: ${sectionSummary}`);
  console.log("all fields except updatedAt equal seed: yes");
  console.log("missing menu result: null");
  console.log("database writes: 0");
} finally {
  await prisma.$disconnect();
}
