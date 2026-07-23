import assert from "node:assert/strict";
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
  { createMenuWritePlan, MenuWriteValidationError },
  { prisma },
] = await Promise.all([
  import("../src/server/db/menu-read.ts"),
  import("../src/server/db/menu-write-plan.ts"),
  import("../src/server/db/prisma.ts"),
]);

function copyMenu(menu: Menu) {
  return structuredClone(menu);
}

function expectValidationFailure(
  current: Menu,
  desired: Menu,
  expectedText: string,
) {
  assert.throws(
    () => createMenuWritePlan(current, desired),
    (error) =>
      error instanceof MenuWriteValidationError &&
      error.issues.some((issue) => issue.includes(expectedText)),
  );
}

try {
  const currentMenu = await readMenuFromDatabase();
  if (!currentMenu) {
    throw new Error("The default database menu was not found");
  }

  const noOpPlan = createMenuWritePlan(currentMenu, copyMenu(currentMenu));
  assert.equal(noOpPlan.hasChanges, false);
  assert.equal(noOpPlan.nextVersion, currentMenu.version);
  assert.ok(Object.values(noOpPlan.summary).every((count) => count === 0));

  const automaticSectionMenu = copyMenu(currentMenu);
  automaticSectionMenu.settings.sections[0].dishIds = null;
  const automaticSectionPlan = createMenuWritePlan(
    currentMenu,
    automaticSectionMenu,
  );
  assert.equal(automaticSectionPlan.hasChanges, false);
  assert.deepEqual(
    automaticSectionPlan.normalizedMenu.settings.sections[0].dishIds,
    currentMenu.settings.sections[0].dishIds,
  );

  const titleMenu = copyMenu(currentMenu);
  titleMenu.settings.title = `${titleMenu.settings.title}（演练）`;
  const titlePlan = createMenuWritePlan(currentMenu, titleMenu);
  assert.deepEqual(titlePlan.changes.menuFields, ["title"]);
  assert.equal(titlePlan.nextVersion, currentMenu.version + 1);

  const dishEditMenu = copyMenu(currentMenu);
  dishEditMenu.dishes[0].description += "（演练）";
  const dishEditPlan = createMenuWritePlan(currentMenu, dishEditMenu);
  assert.deepEqual(dishEditPlan.changes.dishes.updated, [
    {
      id: currentMenu.dishes[0].id,
      fields: ["description"],
    },
  ]);

  const downMenu = copyMenu(currentMenu);
  const downDish = downMenu.dishes.find((dish) => dish.visible);
  assert.ok(downDish);
  const downDishSectionIds = currentMenu.settings.sections
    .filter((section) => section.dishIds?.includes(downDish.id))
    .map((section) => section.id);
  downDish.visible = false;
  const downPlan = createMenuWritePlan(currentMenu, downMenu);
  assert.deepEqual(downPlan.changes.menuDishes.updated, [
    {
      id: downDish.id,
      fields: ["visible"],
    },
  ]);
  assert.deepEqual(
    downPlan.changes.sectionDishes.map((change) => change.sectionId),
    downDishSectionIds,
  );
  assert.ok(
    downPlan.changes.sectionDishes.every(
      (change) =>
        change.removedDishIds.includes(downDish.id) &&
        !change.addedDishIds.includes(downDish.id),
    ),
  );

  const reorderMenu = copyMenu(currentMenu);
  const firstDishOrder = reorderMenu.dishes[0].sortOrder;
  reorderMenu.dishes[0].sortOrder = reorderMenu.dishes[1].sortOrder;
  reorderMenu.dishes[1].sortOrder = firstDishOrder;
  const reorderPlan = createMenuWritePlan(currentMenu, reorderMenu);
  assert.equal(reorderPlan.changes.menuDishes.updated.length, 2);
  assert.ok(
    reorderPlan.changes.menuDishes.updated.every((change) =>
      change.fields.includes("sortOrder"),
    ),
  );

  const addMenu = copyMenu(currentMenu);
  const nextDishId = Math.max(...addMenu.dishes.map((dish) => dish.id)) + 1;
  const nextDishOrder =
    Math.max(...addMenu.dishes.map((dish) => dish.sortOrder)) + 1;
  addMenu.dishes.push({
    id: nextDishId,
    name: "演练新菜",
    slug: `dish-${nextDishId}`,
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
    sortOrder: nextDishOrder,
  });
  const addPlan = createMenuWritePlan(currentMenu, addMenu);
  assert.deepEqual(addPlan.changes.dishes.addedIds, [nextDishId]);

  const removeMenu = copyMenu(currentMenu);
  const removedDish = removeMenu.dishes.at(-1);
  assert.ok(removedDish);
  removeMenu.dishes = removeMenu.dishes.filter(
    (dish) => dish.id !== removedDish.id,
  );
  removeMenu.settings.sections = removeMenu.settings.sections.map((section) => ({
    ...section,
    dishIds: section.dishIds?.filter((dishId) => dishId !== removedDish.id) ?? null,
  }));
  const removePlan = createMenuWritePlan(currentMenu, removeMenu);
  assert.deepEqual(removePlan.changes.dishes.removedIds, [removedDish.id]);

  const addSectionMenu = copyMenu(currentMenu);
  addSectionMenu.settings.sections.push({
    id: "preview-section",
    label: "演练分区",
    title: "演练分区",
    note: "",
    category: null,
    recommendedOnly: false,
    dishIds: [],
    sortOrder:
      Math.max(
        ...addSectionMenu.settings.sections.map(
          (section) => section.sortOrder,
        ),
      ) + 1,
  });
  const addSectionPlan = createMenuWritePlan(currentMenu, addSectionMenu);
  assert.deepEqual(addSectionPlan.changes.sections.addedIds, [
    "preview-section",
  ]);

  const removeSectionMenu = copyMenu(currentMenu);
  const removedSection = removeSectionMenu.settings.sections.at(-1);
  assert.ok(removedSection);
  removeSectionMenu.settings.sections =
    removeSectionMenu.settings.sections.filter(
      (section) => section.id !== removedSection.id,
    );
  const removeSectionPlan = createMenuWritePlan(
    currentMenu,
    removeSectionMenu,
  );
  assert.deepEqual(removeSectionPlan.changes.sections.removedIds, [
    removedSection.id,
  ]);

  const membershipMenu = copyMenu(currentMenu);
  const membershipSection = membershipMenu.settings.sections.find(
    (section) => (section.dishIds?.length ?? 0) >= 2,
  );
  assert.ok(membershipSection?.dishIds);
  [membershipSection.dishIds[0], membershipSection.dishIds[1]] = [
    membershipSection.dishIds[1],
    membershipSection.dishIds[0],
  ];
  const membershipPlan = createMenuWritePlan(currentMenu, membershipMenu);
  assert.deepEqual(membershipPlan.changes.sectionDishes, [
    {
      sectionId: membershipSection.id,
      addedDishIds: [],
      removedDishIds: [],
      reordered: true,
    },
  ]);

  const staleMenu = copyMenu(currentMenu);
  staleMenu.version -= 1;
  expectValidationFailure(currentMenu, staleMenu, "version 已过期");

  const imageMenu = copyMenu(currentMenu);
  imageMenu.dishes[0].image = "/uploads/not-allowed.jpg";
  imageMenu.dishes[0].images = ["/uploads/not-allowed.jpg"];
  expectValidationFailure(currentMenu, imageMenu, "图片不能通过菜单保存接口修改");

  const duplicateSlugMenu = copyMenu(currentMenu);
  duplicateSlugMenu.dishes[1].slug = duplicateSlugMenu.dishes[0].slug;
  expectValidationFailure(currentMenu, duplicateSlugMenu, "菜品 slug 不能重复");

  const invalidPrepTimeMenu = copyMenu(currentMenu);
  invalidPrepTimeMenu.dishes[0].prepTime = "半小时";
  expectValidationFailure(
    currentMenu,
    invalidPrepTimeMenu,
    "必须使用“30分钟”这样的格式",
  );

  const invalidSectionReferenceMenu = copyMenu(currentMenu);
  invalidSectionReferenceMenu.settings.sections[0].dishIds = [999999];
  expectValidationFailure(
    currentMenu,
    invalidSectionReferenceMenu,
    "引用了不存在的菜品 ID",
  );

  console.log(`menu version: ${currentMenu.version}`);
  console.log(`no-op changes: ${noOpPlan.hasChanges ? "unexpected" : "0"}`);
  console.log("null dishIds materialization: passed");
  console.log("title edit classification: passed");
  console.log("dish edit/down/reorder/add/remove classification: passed");
  console.log("section add/remove/membership reorder classification: passed");
  console.log("stale version rejection: passed");
  console.log("image change rejection: passed");
  console.log("duplicate/format/reference validation: passed");
  console.log("database writes: 0");
} finally {
  await prisma.$disconnect();
}
