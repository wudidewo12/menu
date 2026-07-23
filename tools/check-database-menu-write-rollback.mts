import assert from "node:assert/strict";
import fs from "node:fs";

import dotenv from "dotenv";

import type { Menu } from "../src/types/menu.ts";
import { takeMenuDatabaseSnapshot } from "./database-menu-test-state.mts";
import { createMenuWriteScenario } from "./database-menu-write-scenario.mts";

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

const [
  { readMenuFromDatabase },
  { DatabaseDishIdConflictError, writeMenuToDatabase },
  { prisma },
] = await Promise.all([
  import("../src/server/db/menu-read.ts"),
  import("../src/server/db/menu-write.ts"),
  import("../src/server/db/prisma.ts"),
]);

function createSkippedDishIdScenario(currentMenu: Menu) {
  const desiredMenu = structuredClone(currentMenu);
  const maximumDishId = Math.max(
    ...desiredMenu.dishes.map((dish) => dish.id),
  );
  const maximumSortOrder = Math.max(
    ...desiredMenu.dishes.map((dish) => dish.sortOrder),
  );
  const skippedDishId = maximumDishId + 2;

  desiredMenu.dishes.push({
    id: skippedDishId,
    name: "错误编号测试菜",
    slug: `dish-${skippedDishId}`,
    description: "",
    date: "今晚菜单",
    prepTime: "30分钟",
    category: "肉菜",
    accent: "",
    difficulty: "简单",
    recommended: false,
    servings: "2-3人份",
    image: "/images/dishes/default-dish.png",
    images: ["/images/dishes/default-dish.png"],
    ingredients: [],
    visible: true,
    sortOrder: maximumSortOrder + 1,
  });

  return desiredMenu;
}

const forcedRollbackError = new Error("FORCED_MENU_WRITE_ROLLBACK");

try {
  const currentMenu = await readMenuFromDatabase();
  if (!currentMenu) {
    throw new Error("The default database menu was not found");
  }

  const before = await takeMenuDatabaseSnapshot(prisma);
  assert.equal(before.totalBusinessRows, 237);

  const noOpResult = await writeMenuToDatabase(structuredClone(currentMenu));
  assert.equal(noOpResult.plan.hasChanges, false);
  assert.deepEqual(await takeMenuDatabaseSnapshot(prisma), before);

  await assert.rejects(
    writeMenuToDatabase(createSkippedDishIdScenario(currentMenu)),
    (error) => error instanceof DatabaseDishIdConflictError,
  );
  assert.deepEqual(await takeMenuDatabaseSnapshot(prisma), before);

  const { desiredMenu } = createMenuWriteScenario(
    currentMenu,
    "（回滚测试，不应保存）",
  );
  await assert.rejects(
    writeMenuToDatabase(desiredMenu, {
      beforeCommit() {
        throw forcedRollbackError;
      },
    }),
    (error) => error === forcedRollbackError,
  );

  const after = await takeMenuDatabaseSnapshot(prisma);
  const menuAfterRollback = await readMenuFromDatabase();

  assert.deepEqual(after, before);
  assert.deepEqual(menuAfterRollback, currentMenu);
  assert.equal(
    menuAfterRollback.settings.title.includes("回滚测试"),
    false,
  );

  console.log(`business rows before: ${before.totalBusinessRows}`);
  console.log(`business rows after: ${after.totalBusinessRows}`);
  console.log(`menu version before: ${before.menuVersion}`);
  console.log(`menu version after: ${after.menuVersion}`);
  console.log(
    `dish sequence before/after: ${before.dishSequenceValue}/${after.dishSequenceValue}`,
  );
  console.log(`full six-table fingerprint unchanged: ${before.fingerprint}`);
  console.log("no-op transaction writes: 0");
  console.log("invalid new dish id rejected before writes: yes");
  console.log("forced error reached: yes");
  console.log("transaction committed: no");
  console.log("database business data changed: no");
} finally {
  await prisma.$disconnect();
}
