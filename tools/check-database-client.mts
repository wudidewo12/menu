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

const { prisma } = await import("../src/server/db/prisma.ts");

try {
  const identityRows = await prisma.$queryRaw<
    Array<{
      databaseName: string;
      roleName: string;
      canCreateInSchema: boolean;
    }>
  >`
    SELECT
      current_database() AS "databaseName",
      current_user AS "roleName",
      has_schema_privilege(current_user, 'public', 'CREATE') AS "canCreateInSchema"
  `;
  const identity = identityRows[0];

  if (!identity || identity.roleName !== applicationRole || identity.canCreateInSchema) {
    throw new Error("The Prisma runtime connection does not use the expected low-privilege role");
  }

  const [menus, dishes, menuDishes, menuSections, sectionDishes, dishImages] =
    await Promise.all([
      prisma.menu.count(),
      prisma.dish.count(),
      prisma.menuDish.count(),
      prisma.menuSection.count(),
      prisma.sectionDish.count(),
      prisma.dishImage.count(),
    ]);

  const counts = {
    Menu: menus,
    Dish: dishes,
    MenuDish: menuDishes,
    MenuSection: menuSections,
    SectionDish: sectionDishes,
    DishImage: dishImages,
  };

  console.log(`database: ${identity.databaseName}`);
  console.log(`runtime role: ${identity.roleName}`);
  console.log("schema creation: denied");
  console.log(`models queried: ${Object.keys(counts).length}/6`);
  console.log(`total business rows: ${Object.values(counts).reduce((sum, count) => sum + count, 0)}`);
} finally {
  await prisma.$disconnect();
}
