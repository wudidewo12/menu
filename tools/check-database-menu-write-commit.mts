import assert from "node:assert/strict";
import fs from "node:fs";

import dotenv from "dotenv";

import type { Menu } from "../src/types/menu.ts";
import {
  restoreMenuDatabaseSnapshot,
  takeMenuDatabaseSnapshot,
  type MenuDatabaseSnapshot,
} from "./database-menu-test-state.mts";
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
  { DishStatus },
  { readMenuFromDatabase },
  { writeMenuToDatabase },
  { MenuVersionConflictError },
  { prisma },
] = await Promise.all([
  import("../src/generated/prisma/enums.ts"),
  import("../src/server/db/menu-read.ts"),
  import("../src/server/db/menu-write.ts"),
  import("../src/server/db/menu-write-plan.ts"),
  import("../src/server/db/prisma.ts"),
]);

let originalMenu: Menu | null = null;
let originalSnapshot: MenuDatabaseSnapshot | null = null;
let committedSnapshot: MenuDatabaseSnapshot | null = null;
let successfulWriteCommitted = false;
let verificationError: unknown = null;

try {
  originalMenu = await readMenuFromDatabase();
  if (!originalMenu) {
    throw new Error("The default database menu was not found");
  }

  originalSnapshot = await takeMenuDatabaseSnapshot(prisma);
  assert.equal(originalSnapshot.totalBusinessRows, 237);
  assert.equal(originalSnapshot.menuVersion, 1);
  assert.equal(originalSnapshot.dishSequenceValue, 55);

  const scenario = createMenuWriteScenario(
    originalMenu,
    "（成功提交测试）",
  );
  const writeResult = await writeMenuToDatabase(scenario.desiredMenu);
  successfulWriteCommitted = true;

  assert.equal(writeResult.plan.hasChanges, true);
  assert.equal(writeResult.plan.expectedVersion, 1);
  assert.equal(writeResult.plan.nextVersion, 2);
  assert.equal(writeResult.menu.version, 2);
  assert.equal(writeResult.menu.dishes.length, 55);
  assert.equal(writeResult.menu.settings.sections.length, 7);

  const [
    menuRecord,
    editedDish,
    removedDish,
    addedDish,
    removedMenuDish,
    addedMenuDish,
    removedDishSectionLinks,
    addedDishImages,
    removedSection,
    addedSection,
  ] = await Promise.all([
    prisma.menu.findUnique({
      where: {
        slug: "family-dinner",
      },
    }),
    prisma.dish.findUnique({
      where: {
        id: scenario.editedDishId,
      },
    }),
    prisma.dish.findUnique({
      where: {
        id: scenario.removedDishId,
      },
    }),
    prisma.dish.findUnique({
      where: {
        id: scenario.addedDishId,
      },
    }),
    prisma.menuDish.findFirst({
      where: {
        dishId: scenario.removedDishId,
      },
    }),
    prisma.menuDish.findFirst({
      where: {
        dishId: scenario.addedDishId,
      },
    }),
    prisma.sectionDish.count({
      where: {
        dishId: scenario.removedDishId,
      },
    }),
    prisma.dishImage.count({
      where: {
        dishId: scenario.addedDishId,
      },
    }),
    prisma.menuSection.findFirst({
      where: {
        slug: scenario.removedSectionId,
      },
    }),
    prisma.menuSection.findFirst({
      where: {
        slug: scenario.addedSectionId,
      },
      include: {
        sectionDishes: {
          orderBy: {
            sortOrder: "asc",
          },
        },
      },
    }),
  ]);

  assert.equal(menuRecord?.version, 2);
  assert.ok(menuRecord?.title.includes("成功提交测试"));
  assert.equal(editedDish?.version, 2);
  assert.ok(editedDish?.description.includes("成功提交测试"));
  assert.equal(removedDish?.status, DishStatus.ARCHIVED);
  assert.equal(removedDish?.version, 2);
  assert.equal(addedDish?.status, DishStatus.DRAFT);
  assert.equal(addedDish?.version, 1);
  assert.equal(removedMenuDish, null);
  assert.equal(addedMenuDish?.visible, true);
  assert.equal(removedDishSectionLinks, 0);
  assert.equal(addedDishImages, 0);
  assert.equal(removedSection, null);
  assert.deepEqual(
    addedSection?.sectionDishes.map((relation) => relation.dishId),
    [scenario.editedDishId, scenario.addedDishId],
  );

  committedSnapshot = await takeMenuDatabaseSnapshot(prisma);
  const removedSectionBeforeWrite = originalMenu.settings.sections.find(
    (section) => section.id === scenario.removedSectionId,
  );
  const removedDishLinksOutsideRemovedSection =
    originalMenu.settings.sections.filter(
      (section) =>
        section.id !== scenario.removedSectionId &&
        section.dishIds?.includes(scenario.removedDishId),
    ).length;
  const addedSectionAfterWrite = writeResult.menu.settings.sections.find(
    (section) => section.id === scenario.addedSectionId,
  );
  assert.ok(removedSectionBeforeWrite?.dishIds);
  assert.ok(addedSectionAfterWrite?.dishIds);
  const expectedCommittedRows =
    originalSnapshot.totalBusinessRows +
    1 -
    removedSectionBeforeWrite.dishIds.length -
    removedDishLinksOutsideRemovedSection +
    addedSectionAfterWrite.dishIds.length;

  assert.equal(
    committedSnapshot.totalBusinessRows,
    expectedCommittedRows,
  );
  assert.equal(committedSnapshot.menuVersion, 2);
  assert.equal(committedSnapshot.dishSequenceValue, scenario.addedDishId);
  assert.notEqual(
    committedSnapshot.fingerprint,
    originalSnapshot.fingerprint,
  );

  const stalePayload = structuredClone(writeResult.menu);
  stalePayload.version = originalMenu.version;
  await assert.rejects(
    writeMenuToDatabase(stalePayload),
    (error) =>
      error instanceof MenuVersionConflictError &&
      error.code === "MENU_VERSION_CONFLICT",
  );
  assert.deepEqual(
    await takeMenuDatabaseSnapshot(prisma),
    committedSnapshot,
  );
} catch (error) {
  verificationError = error;
} finally {
  if (successfulWriteCommitted && originalSnapshot) {
    try {
      await restoreMenuDatabaseSnapshot(prisma, originalSnapshot);
    } catch (restoreError) {
      verificationError = new AggregateError(
        [verificationError, restoreError].filter(Boolean),
        "Successful write test failed and database snapshot restoration also failed",
      );
    }
  }

  try {
    if (originalSnapshot && originalMenu) {
      const restoredSnapshot = await takeMenuDatabaseSnapshot(prisma);
      const restoredMenu = await readMenuFromDatabase();

      assert.deepEqual(restoredSnapshot, originalSnapshot);
      assert.deepEqual(restoredMenu, originalMenu);
    }
  } catch (restoreVerificationError) {
    verificationError = new AggregateError(
      [verificationError, restoreVerificationError].filter(Boolean),
      "Database did not exactly match the original snapshot after restoration",
    );
  }

  await prisma.$disconnect();
}

if (verificationError) {
  throw verificationError;
}
if (!originalSnapshot || !committedSnapshot) {
  throw new Error("Successful write test did not produce both snapshots");
}

console.log(`original fingerprint: ${originalSnapshot.fingerprint}`);
console.log(`committed fingerprint: ${committedSnapshot.fingerprint}`);
console.log(`business rows during commit: ${committedSnapshot.totalBusinessRows}`);
console.log(`menu version during commit: ${committedSnapshot.menuVersion}`);
console.log(`dish sequence during commit: ${committedSnapshot.dishSequenceValue}`);
console.log("successful transaction committed: yes");
console.log("dish create/update/archive checks: passed");
console.log("menu/section/relation checks: passed");
console.log("stale version rejected without extra writes: yes");
console.log("original snapshot restored exactly: yes");
console.log(`final business rows: ${originalSnapshot.totalBusinessRows}`);
console.log(`final menu version: ${originalSnapshot.menuVersion}`);
console.log(`final dish sequence: ${originalSnapshot.dishSequenceValue}`);
