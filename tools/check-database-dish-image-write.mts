import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import dotenv from "dotenv";

import type { Menu } from "../src/types/menu.ts";
import {
  restoreMenuDatabaseSnapshot,
  takeMenuDatabaseSnapshot,
  type MenuDatabaseSnapshot,
} from "./database-menu-test-state.mts";

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
  {
    DatabaseMenuDishNotFoundError,
    DishImageWriteValidationError,
    writeDishImageToDatabase,
  },
  { MenuVersionConflictError },
  { readMenuFromDatabase },
  { prisma },
] = await Promise.all([
  import("../src/server/db/dish-image-write.ts"),
  import("../src/server/db/menu-write-plan.ts"),
  import("../src/server/db/menu-read.ts"),
  import("../src/server/db/prisma.ts"),
]);

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "menu-dish-image-write-"),
);
const uploadsDirectory = path.join(temporaryRoot, "uploads");
const validImageBuffer = fs.readFileSync("public/images/dishes/1.webp");
const forcedRollbackError = new Error("FORCED_DISH_IMAGE_WRITE_ROLLBACK");

let originalMenu: Menu | null = null;
let originalSnapshot: MenuDatabaseSnapshot | null = null;
let firstCommittedSnapshot: MenuDatabaseSnapshot | null = null;
let secondCommittedSnapshot: MenuDatabaseSnapshot | null = null;
let firstStorageKey = "";
let secondStorageKey = "";
let verificationError: unknown = null;

function pngHeader(width: number, height: number) {
  const buffer = Buffer.alloc(24);
  buffer.set([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ]);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function uploadedFiles(root: string) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files: string[] = [];

  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, {
      withFileTypes: true,
    })) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(entryPath);
      } else {
        files.push(path.relative(root, entryPath).split(path.sep).join("/"));
      }
    }
  }

  visit(root);
  return files.sort();
}

function filePathForStorageKey(storageKey: string) {
  assert.ok(storageKey.startsWith("uploads/"));
  return path.join(
    uploadsDirectory,
    ...storageKey.slice("uploads/".length).split("/"),
  );
}

function uploadInput(
  dishId: number,
  menuVersion: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    dishId,
    menuVersion,
    contentType: "image/webp",
    buffer: validImageBuffer,
    ...overrides,
  };
}

async function assertValidationRejected(
  input: unknown,
  expectedIssue: string,
) {
  await assert.rejects(
    writeDishImageToDatabase(input, {
      uploadsDirectory,
    }),
    (error) =>
      error instanceof DishImageWriteValidationError &&
      error.code === "DISH_IMAGE_VALIDATION_FAILED" &&
      error.issues.some((issue) => issue.includes(expectedIssue)),
  );
}

async function assertStateAndFilesUnchanged(
  expectedSnapshot: MenuDatabaseSnapshot,
  expectedFiles: string[],
) {
  assert.deepEqual(
    await takeMenuDatabaseSnapshot(prisma),
    expectedSnapshot,
  );
  assert.deepEqual(
    uploadedFiles(uploadsDirectory),
    expectedFiles,
  );
}

try {
  originalMenu = await readMenuFromDatabase();
  if (!originalMenu) {
    throw new Error("The default database menu was not found");
  }

  originalSnapshot = await takeMenuDatabaseSnapshot(prisma);
  assert.equal(originalSnapshot.totalBusinessRows, 237);
  assert.equal(originalSnapshot.menuVersion, 1);
  assert.equal(originalSnapshot.dishSequenceValue, 55);
  assert.deepEqual(uploadedFiles(uploadsDirectory), []);

  const testDish = originalMenu.dishes[0];
  assert.ok(testDish);
  const originalDishRecord = await prisma.dish.findUnique({
    where: {
      id: testDish.id,
    },
  });
  assert.ok(originalDishRecord);

  await assertValidationRejected(
    uploadInput(testDish.id, originalMenu.version, {
      contentType: "image/png",
    }),
    "真实格式不一致",
  );
  await assertValidationRejected(
    uploadInput(testDish.id, originalMenu.version, {
      buffer: Buffer.from("not-an-image"),
    }),
    "损坏或不是真实图片",
  );
  await assertValidationRejected(
    uploadInput(testDish.id, originalMenu.version, {
      contentType: "image/png",
      buffer: pngHeader(10_001, 100),
    }),
    "不能超过 10000",
  );
  await assertValidationRejected(
    uploadInput(testDish.id, originalMenu.version, {
      contentType: "image/png",
      buffer: pngHeader(8_000, 6_000),
    }),
    "不能超过 4000 万",
  );
  await assertValidationRejected(
    uploadInput(testDish.id, originalMenu.version, {
      buffer: Buffer.alloc(12_000_001),
    }),
    "不能超过 12MB",
  );
  await assertStateAndFilesUnchanged(originalSnapshot, []);

  await assert.rejects(
    writeDishImageToDatabase(
      uploadInput(testDish.id, originalMenu.version),
      {
        uploadsDirectory,
        beforeCommit() {
          throw forcedRollbackError;
        },
      },
    ),
    (error) => error === forcedRollbackError,
  );
  await assertStateAndFilesUnchanged(originalSnapshot, []);

  const firstWrite = await writeDishImageToDatabase(
    uploadInput(testDish.id, originalMenu.version),
    {
      uploadsDirectory,
    },
  );
  firstStorageKey = firstWrite.image.storageKey;
  const firstFilePath = filePathForStorageKey(firstStorageKey);

  assert.equal(firstWrite.menu.version, originalMenu.version + 1);
  assert.match(
    firstStorageKey,
    new RegExp(
      `^uploads/dishes/${testDish.id}/[0-9a-f-]{36}\\.webp$`,
    ),
  );
  assert.equal(firstWrite.image.url, `/${firstStorageKey}`);
  assert.equal(firstWrite.image.mimeType, "image/webp");
  assert.equal(firstWrite.image.byteSize, validImageBuffer.length);
  assert.ok(firstWrite.image.width > 0);
  assert.ok(firstWrite.image.height > 0);
  assert.equal(firstWrite.oldFileCleanupPending, false);
  assert.deepEqual(fs.readFileSync(firstFilePath), validImageBuffer);
  assert.equal(fs.existsSync("public/images/dishes/1.webp"), true);

  const [firstMenuRecord, firstDishRecord, firstImageRecord] =
    await Promise.all([
      prisma.menu.findUnique({
        where: {
          slug: "family-dinner",
        },
      }),
      prisma.dish.findUnique({
        where: {
          id: testDish.id,
        },
      }),
      prisma.dishImage.findUnique({
        where: {
          dishId_sortOrder: {
            dishId: testDish.id,
            sortOrder: 1,
          },
        },
      }),
    ]);

  assert.equal(firstMenuRecord?.version, originalMenu.version + 1);
  assert.equal(firstDishRecord?.version, originalDishRecord.version + 1);
  assert.equal(firstImageRecord?.storageKey, firstStorageKey);
  assert.equal(firstImageRecord?.mimeType, firstWrite.image.mimeType);
  assert.equal(firstImageRecord?.width, firstWrite.image.width);
  assert.equal(firstImageRecord?.height, firstWrite.image.height);
  assert.equal(firstImageRecord?.byteSize, firstWrite.image.byteSize);
  assert.equal(firstImageRecord?.altText, testDish.name);

  firstCommittedSnapshot = await takeMenuDatabaseSnapshot(prisma);
  assert.equal(firstCommittedSnapshot.totalBusinessRows, 237);
  assert.equal(firstCommittedSnapshot.menuVersion, originalMenu.version + 1);
  assert.equal(firstCommittedSnapshot.dishSequenceValue, 55);
  assert.notEqual(
    firstCommittedSnapshot.fingerprint,
    originalSnapshot.fingerprint,
  );
  const firstFiles = uploadedFiles(uploadsDirectory);
  assert.deepEqual(firstFiles, [
    path.relative(uploadsDirectory, firstFilePath)
      .split(path.sep)
      .join("/"),
  ]);

  await assert.rejects(
    writeDishImageToDatabase(
      uploadInput(testDish.id, originalMenu.version),
      {
        uploadsDirectory,
      },
    ),
    (error) =>
      error instanceof MenuVersionConflictError &&
      error.code === "MENU_VERSION_CONFLICT",
  );
  await assertStateAndFilesUnchanged(
    firstCommittedSnapshot,
    firstFiles,
  );

  const orphanDishId = originalSnapshot.dishSequenceValue + 1;
  await prisma.dish.create({
    data: {
      id: orphanDishId,
      slug: `image-test-orphan-${Date.now()}`,
      name: "图片测试孤立菜品",
      description: "",
      prepMinutes: 1,
      category: "测试",
      servingsMin: 1,
      servingsMax: 1,
    },
  });
  const orphanSnapshot = await takeMenuDatabaseSnapshot(prisma);

  await assert.rejects(
    writeDishImageToDatabase(
      uploadInput(orphanDishId, firstWrite.menu.version),
      {
        uploadsDirectory,
      },
    ),
    (error) =>
      error instanceof DatabaseMenuDishNotFoundError &&
      error.code === "DISH_NOT_IN_MENU",
  );
  await assertStateAndFilesUnchanged(orphanSnapshot, firstFiles);
  await prisma.dish.delete({
    where: {
      id: orphanDishId,
    },
  });
  await assertStateAndFilesUnchanged(
    firstCommittedSnapshot,
    firstFiles,
  );

  const secondWrite = await writeDishImageToDatabase(
    uploadInput(testDish.id, firstWrite.menu.version),
    {
      uploadsDirectory,
    },
  );
  secondStorageKey = secondWrite.image.storageKey;
  const secondFilePath = filePathForStorageKey(secondStorageKey);

  assert.notEqual(secondStorageKey, firstStorageKey);
  assert.equal(secondWrite.menu.version, firstWrite.menu.version + 1);
  assert.equal(fs.existsSync(firstFilePath), false);
  assert.equal(fs.existsSync(secondFilePath), true);
  assert.deepEqual(uploadedFiles(uploadsDirectory), [
    path.relative(uploadsDirectory, secondFilePath)
      .split(path.sep)
      .join("/"),
  ]);

  const [secondDishRecord, secondImageRecord] = await Promise.all([
    prisma.dish.findUnique({
      where: {
        id: testDish.id,
      },
    }),
    prisma.dishImage.findUnique({
      where: {
        dishId_sortOrder: {
          dishId: testDish.id,
          sortOrder: 1,
        },
      },
    }),
  ]);
  assert.equal(secondDishRecord?.version, originalDishRecord.version + 2);
  assert.equal(secondImageRecord?.storageKey, secondStorageKey);

  secondCommittedSnapshot = await takeMenuDatabaseSnapshot(prisma);
  assert.equal(secondCommittedSnapshot.totalBusinessRows, 237);
  assert.equal(secondCommittedSnapshot.menuVersion, originalMenu.version + 2);
  assert.equal(secondCommittedSnapshot.dishSequenceValue, 55);
  assert.notEqual(
    secondCommittedSnapshot.fingerprint,
    firstCommittedSnapshot.fingerprint,
  );
} catch (error) {
  verificationError = error;
} finally {
  if (originalSnapshot) {
    try {
      await restoreMenuDatabaseSnapshot(prisma, originalSnapshot);
    } catch (restoreError) {
      verificationError = new AggregateError(
        [verificationError, restoreError].filter(Boolean),
        "Dish image test failed and database restoration also failed",
      );
    }
  }

  try {
    if (originalSnapshot && originalMenu) {
      assert.deepEqual(
        await takeMenuDatabaseSnapshot(prisma),
        originalSnapshot,
      );
      assert.deepEqual(
        await readMenuFromDatabase(),
        originalMenu,
      );
    }
  } catch (restoreVerificationError) {
    verificationError = new AggregateError(
      [verificationError, restoreVerificationError].filter(Boolean),
      "Database did not exactly match the original snapshot after image tests",
    );
  }

  fs.rmSync(temporaryRoot, {
    recursive: true,
    force: true,
  });
  await prisma.$disconnect();
}

if (verificationError) {
  throw verificationError;
}
if (!originalSnapshot || !firstCommittedSnapshot || !secondCommittedSnapshot) {
  throw new Error("Dish image write test did not produce all expected snapshots");
}

console.log(`original fingerprint: ${originalSnapshot.fingerprint}`);
console.log(`first image fingerprint: ${firstCommittedSnapshot.fingerprint}`);
console.log(`second image fingerprint: ${secondCommittedSnapshot.fingerprint}`);
console.log(`first storage key: ${firstStorageKey}`);
console.log(`second storage key differs: ${secondStorageKey !== firstStorageKey}`);
console.log("image format/size/dimension validation: passed");
console.log("forced transaction rollback removed new file: yes");
console.log("successful image metadata/version write: passed");
console.log("stale version rejected and new file removed: yes");
console.log("non-menu dish rejected and new file removed: yes");
console.log("second upload replaced metadata and removed old upload: yes");
console.log("original static image preserved: yes");
console.log("temporary uploads directory removed: yes");
console.log("original database snapshot restored exactly: yes");
console.log(`final business rows: ${originalSnapshot.totalBusinessRows}`);
console.log(`final menu version: ${originalSnapshot.menuVersion}`);
console.log(`final dish sequence: ${originalSnapshot.dishSequenceValue}`);
