import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

const [
  { readMenuFromDatabase },
  { DatabaseDishIdConflictError, writeMenuToDatabase },
  { prisma },
] = await Promise.all([
  import("../src/server/db/menu-read.ts"),
  import("../src/server/db/menu-write.ts"),
  import("../src/server/db/prisma.ts"),
]);

interface DatabaseSnapshot {
  fingerprint: string;
  totalBusinessRows: number;
  menuVersion: number;
  dishSequenceValue: number;
  dishSequenceCalled: boolean;
}

async function takeDatabaseSnapshot(): Promise<DatabaseSnapshot> {
  const [
    menus,
    dishes,
    menuDishes,
    menuSections,
    sectionDishes,
    dishImages,
    dishSequenceRows,
  ] = await Promise.all([
      prisma.menu.findMany({
        orderBy: {
          id: "asc",
        },
      }),
      prisma.dish.findMany({
        orderBy: {
          id: "asc",
        },
      }),
      prisma.menuDish.findMany({
        orderBy: [{ menuId: "asc" }, { dishId: "asc" }],
      }),
      prisma.menuSection.findMany({
        orderBy: {
          id: "asc",
        },
      }),
      prisma.sectionDish.findMany({
        orderBy: [{ sectionId: "asc" }, { dishId: "asc" }],
      }),
      prisma.dishImage.findMany({
        orderBy: {
          id: "asc",
        },
      }),
      prisma.$queryRaw<
        Array<{ sequenceValue: bigint; sequenceCalled: boolean }>
      >`
        SELECT
          last_value AS "sequenceValue",
          is_called AS "sequenceCalled"
        FROM "Dish_id_seq"
      `,
    ]);
  const data = {
    menus,
    dishes,
    menuDishes,
    menuSections,
    sectionDishes,
    dishImages,
  };
  const serialized = JSON.stringify(data);

  return {
    fingerprint: createHash("sha256").update(serialized).digest("hex"),
    totalBusinessRows: Object.values(data).reduce(
      (total, records) => total + records.length,
      0,
    ),
    menuVersion: menus[0]?.version ?? 0,
    dishSequenceValue: Number(dishSequenceRows[0]?.sequenceValue),
    dishSequenceCalled: dishSequenceRows[0]?.sequenceCalled ?? false,
  };
}

function createRollbackScenario(currentMenu: Menu) {
  const desiredMenu = structuredClone(currentMenu);

  desiredMenu.settings.title += "（回滚测试，不应保存）";
  desiredMenu.dishes[0].description += "（回滚测试，不应保存）";
  desiredMenu.dishes[0].recommended =
    !desiredMenu.dishes[0].recommended;

  const firstDishOrder = desiredMenu.dishes[0].sortOrder;
  desiredMenu.dishes[0].sortOrder = desiredMenu.dishes[1].sortOrder;
  desiredMenu.dishes[1].sortOrder = firstDishOrder;

  desiredMenu.settings.sections[0].title += "（回滚测试，不应保存）";
  const sectionWithMultipleDishes = desiredMenu.settings.sections.find(
    (section) => (section.dishIds?.length ?? 0) >= 2,
  );
  assert.ok(sectionWithMultipleDishes?.dishIds);
  [
    sectionWithMultipleDishes.dishIds[0],
    sectionWithMultipleDishes.dishIds[1],
  ] = [
    sectionWithMultipleDishes.dishIds[1],
    sectionWithMultipleDishes.dishIds[0],
  ];

  const removedDish = desiredMenu.dishes.at(-1);
  assert.ok(removedDish);
  desiredMenu.dishes = desiredMenu.dishes.filter(
    (dish) => dish.id !== removedDish.id,
  );
  desiredMenu.settings.sections = desiredMenu.settings.sections.map(
    (section) => ({
      ...section,
      dishIds:
        section.dishIds?.filter((dishId) => dishId !== removedDish.id) ??
        null,
    }),
  );

  const newDishId =
    Math.max(...currentMenu.dishes.map((dish) => dish.id)) + 1;
  desiredMenu.dishes.push({
    id: newDishId,
    name: "回滚测试新菜",
    slug: `dish-${newDishId}`,
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
    sortOrder:
      Math.max(...desiredMenu.dishes.map((dish) => dish.sortOrder)) + 1,
  });

  const removedSection = desiredMenu.settings.sections.at(-1);
  assert.ok(removedSection);
  desiredMenu.settings.sections = desiredMenu.settings.sections.filter(
    (section) => section.id !== removedSection.id,
  );
  desiredMenu.settings.sections.push({
    id: "rollback-test-section",
    label: "回滚测试",
    title: "回滚测试，不应保存",
    note: "",
    category: null,
    recommendedOnly: false,
    dishIds: [desiredMenu.dishes[0].id, newDishId],
    sortOrder:
      Math.max(
        ...desiredMenu.settings.sections.map(
          (section) => section.sortOrder,
        ),
      ) + 1,
  });

  return desiredMenu;
}

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

  const before = await takeDatabaseSnapshot();
  assert.equal(before.totalBusinessRows, 237);

  const noOpResult = await writeMenuToDatabase(structuredClone(currentMenu));
  assert.equal(noOpResult.plan.hasChanges, false);
  assert.deepEqual(await takeDatabaseSnapshot(), before);

  await assert.rejects(
    writeMenuToDatabase(createSkippedDishIdScenario(currentMenu)),
    (error) => error instanceof DatabaseDishIdConflictError,
  );
  assert.deepEqual(await takeDatabaseSnapshot(), before);

  const desiredMenu = createRollbackScenario(currentMenu);
  await assert.rejects(
    writeMenuToDatabase(desiredMenu, {
      beforeCommit() {
        throw forcedRollbackError;
      },
    }),
    (error) => error === forcedRollbackError,
  );

  const after = await takeDatabaseSnapshot();
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
