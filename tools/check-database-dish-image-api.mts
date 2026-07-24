import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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
import {
  apiRequest,
  type RunningServer,
  startServer,
  stopServer,
  uploadedFiles,
} from "./menu-api-test-client.mts";

const localEnvironment = dotenv.parse(fs.readFileSync(".env.local"));
const databaseUrl = localEnvironment.DATABASE_URL;
const applicationRole = localEnvironment.POSTGRES_APP_USER;
const validImageBuffer = fs.readFileSync("public/images/dishes/1.webp");
const validImageData =
  `data:image/webp;base64,${validImageBuffer.toString("base64")}`;

if (!databaseUrl || !applicationRole) {
  throw new Error("DATABASE_URL and POSTGRES_APP_USER are required in .env.local");
}

process.env.DATABASE_URL = databaseUrl;
process.env.POSTGRES_APP_USER = applicationRole;

delete process.env.DATABASE_ADMIN_URL;
delete process.env.POSTGRES_OWNER;
delete process.env.POSTGRES_OWNER_PASSWORD;
delete process.env.POSTGRES_APP_PASSWORD;

const [{ readMenuFromDatabase }, { prisma }] = await Promise.all([
  import("../src/server/db/menu-read.ts"),
  import("../src/server/db/prisma.ts"),
]);

function imageUploadBody(
  dishId: number,
  menuVersion: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    filename: `${dishId}.webp`,
    contentType: "image/webp",
    dishId,
    menuVersion,
    data: validImageData,
    ...overrides,
  };
}

async function checkJsonImageApi(
  adminPassword: string,
  originalMenu: Menu,
) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "menu-json-image-api-"),
  );
  const dataDirectory = path.join(temporaryRoot, "data");
  let server: RunningServer | null = null;

  try {
    server = await startServer(
      "json",
      adminPassword,
      dataDirectory,
    );
    const testDish = originalMenu.dishes[0];
    assert.ok(testDish);

    const response = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        password: adminPassword,
        body: imageUploadBody(testDish.id, originalMenu.version),
      },
    );
    assert.equal(response.status, 200);
    assert.equal(response.payload.url, `/uploads/${testDish.id}.webp`);
    assert.equal(response.payload.filename, `${testDish.id}.webp`);
    assert.equal(response.payload.linked, true);
    assert.equal(response.payload.size, validImageBuffer.length);
    assert.equal(response.payload.menu, undefined);
    assert.deepEqual(
      uploadedFiles(path.join(dataDirectory, "uploads")),
      [`${testDish.id}.webp`],
    );

    const menuResponse = await apiRequest(server.baseUrl, "/api/menu");
    const uploadedDish = (
      menuResponse.payload as unknown as Menu
    ).dishes.find((dish) => dish.id === testDish.id);
    assert.equal(menuResponse.status, 200);
    assert.equal(uploadedDish?.image, response.payload.url);
  } finally {
    await stopServer(server);
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
    });
  }
}

async function checkDatabaseImageApi(
  adminPassword: string,
  originalMenu: Menu,
  originalSnapshot: MenuDatabaseSnapshot,
) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "menu-database-image-api-"),
  );
  const dataDirectory = path.join(temporaryRoot, "data");
  const uploadsDirectory = path.join(dataDirectory, "uploads");
  let server: RunningServer | null = null;
  let verificationError: unknown = null;

  try {
    server = await startServer(
      "database",
      adminPassword,
      dataDirectory,
    );
    const testDish = originalMenu.dishes[0];
    assert.ok(testDish);

    const unauthorized = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        body: imageUploadBody(testDish.id, originalMenu.version),
      },
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.payload.error, "ADMIN_AUTH_REQUIRED");

    const invalidBody = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        password: adminPassword,
        rawBody: "{",
      },
    );
    assert.equal(invalidBody.status, 400);
    assert.equal(invalidBody.payload.error, "INVALID_REQUEST_BODY");

    const invalidBase64 = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        password: adminPassword,
        body: imageUploadBody(testDish.id, originalMenu.version, {
          data: "not-base64!",
        }),
      },
    );
    assert.equal(invalidBase64.status, 400);
    assert.equal(
      invalidBase64.payload.error,
      "DISH_IMAGE_VALIDATION_FAILED",
    );

    const formatMismatch = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        password: adminPassword,
        body: imageUploadBody(testDish.id, originalMenu.version, {
          filename: `${testDish.id}.png`,
          contentType: "image/png",
        }),
      },
    );
    assert.equal(formatMismatch.status, 400);
    assert.equal(
      formatMismatch.payload.error,
      "DISH_IMAGE_VALIDATION_FAILED",
    );
    assert.deepEqual(uploadedFiles(uploadsDirectory), []);
    assert.deepEqual(
      await takeMenuDatabaseSnapshot(prisma),
      originalSnapshot,
    );

    const successfulUpload = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        password: adminPassword,
        body: imageUploadBody(testDish.id, originalMenu.version),
      },
    );
    assert.equal(successfulUpload.status, 200);
    assert.equal(successfulUpload.payload.linked, true);
    assert.equal(successfulUpload.payload.size, validImageBuffer.length);
    assert.equal(successfulUpload.payload.mimeType, "image/webp");
    assert.equal(
      successfulUpload.payload.oldFileCleanupPending,
      false,
    );

    const savedMenu = successfulUpload.payload.menu as unknown as Menu;
    const storageKey = String(successfulUpload.payload.storageKey);
    const expectedRelativeFile = storageKey.slice("uploads/".length);
    assert.equal(savedMenu.version, originalMenu.version + 1);
    assert.match(
      storageKey,
      new RegExp(
        `^uploads/dishes/${testDish.id}/[0-9a-f-]{36}\\.webp$`,
      ),
    );
    assert.equal(successfulUpload.payload.url, `/${storageKey}`);
    assert.deepEqual(uploadedFiles(uploadsDirectory), [
      expectedRelativeFile,
    ]);

    const servedImage = await fetch(
      `${server.baseUrl}/${storageKey}`,
    );
    assert.equal(servedImage.status, 200);
    assert.deepEqual(
      Buffer.from(await servedImage.arrayBuffer()),
      validImageBuffer,
    );

    const reread = await apiRequest(server.baseUrl, "/api/menu");
    assert.equal(reread.status, 200);
    assert.deepEqual(reread.payload, savedMenu);

    const committedSnapshot = await takeMenuDatabaseSnapshot(prisma);
    assert.equal(committedSnapshot.totalBusinessRows, 237);
    assert.equal(committedSnapshot.menuVersion, originalMenu.version + 1);
    assert.equal(committedSnapshot.dishSequenceValue, 55);

    const staleVersion = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        password: adminPassword,
        body: imageUploadBody(testDish.id, originalMenu.version),
      },
    );
    assert.equal(staleVersion.status, 409);
    assert.equal(staleVersion.payload.error, "MENU_VERSION_CONFLICT");
    assert.deepEqual(uploadedFiles(uploadsDirectory), [
      expectedRelativeFile,
    ]);
    assert.deepEqual(
      await takeMenuDatabaseSnapshot(prisma),
      committedSnapshot,
    );

    const nonMenuDish = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        password: adminPassword,
        body: imageUploadBody(999_999, savedMenu.version),
      },
    );
    assert.equal(nonMenuDish.status, 404);
    assert.equal(nonMenuDish.payload.error, "DISH_NOT_IN_MENU");
    assert.deepEqual(uploadedFiles(uploadsDirectory), [
      expectedRelativeFile,
    ]);
    assert.deepEqual(
      await takeMenuDatabaseSnapshot(prisma),
      committedSnapshot,
    );
  } catch (error) {
    verificationError = error;
  } finally {
    await stopServer(server);

    try {
      await restoreMenuDatabaseSnapshot(prisma, originalSnapshot);
    } catch (restoreError) {
      verificationError = new AggregateError(
        [verificationError, restoreError].filter(Boolean),
        "Database image API test failed and snapshot restoration also failed",
      );
    }

    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
    });
  }

  if (verificationError) {
    throw verificationError;
  }
}

async function checkUnavailableDatabaseImageApi(
  adminPassword: string,
  originalMenu: Menu,
) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "menu-unavailable-image-api-"),
  );
  const dataDirectory = path.join(temporaryRoot, "data");
  const brokenDatabaseUrl = new URL(databaseUrl);
  brokenDatabaseUrl.hostname = "127.0.0.1";
  brokenDatabaseUrl.port = "1";
  let server: RunningServer | null = null;

  try {
    server = await startServer(
      "database",
      adminPassword,
      dataDirectory,
      brokenDatabaseUrl.toString(),
    );
    const response = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        password: adminPassword,
        body: imageUploadBody(
          originalMenu.dishes[0].id,
          originalMenu.version,
        ),
      },
    );

    assert.equal(response.status, 503);
    assert.equal(
      response.payload.error,
      "DATABASE_IMAGE_UPLOAD_UNAVAILABLE",
    );
    assert.deepEqual(
      uploadedFiles(path.join(dataDirectory, "uploads")),
      [],
    );
  } finally {
    await stopServer(server);
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
    });
  }
}

const adminPassword = randomBytes(24).toString("hex");
let topLevelError: unknown = null;

try {
  const originalMenu = await readMenuFromDatabase();
  if (!originalMenu) {
    throw new Error("The default database menu was not found");
  }
  const originalSnapshot = await takeMenuDatabaseSnapshot(prisma);

  assert.equal(originalSnapshot.totalBusinessRows, 237);
  assert.equal(originalSnapshot.menuVersion, 1);
  assert.equal(originalSnapshot.dishSequenceValue, 55);

  await checkJsonImageApi(adminPassword, originalMenu);
  assert.deepEqual(
    await takeMenuDatabaseSnapshot(prisma),
    originalSnapshot,
  );

  await checkDatabaseImageApi(
    adminPassword,
    originalMenu,
    originalSnapshot,
  );
  assert.deepEqual(
    await takeMenuDatabaseSnapshot(prisma),
    originalSnapshot,
  );
  assert.deepEqual(await readMenuFromDatabase(), originalMenu);

  await checkUnavailableDatabaseImageApi(
    adminPassword,
    originalMenu,
  );
  assert.deepEqual(
    await takeMenuDatabaseSnapshot(prisma),
    originalSnapshot,
  );
} catch (error) {
  topLevelError = error;
} finally {
  await prisma.$disconnect();
}

if (topLevelError) {
  throw topLevelError;
}

console.log("json image API behavior unchanged: passed");
console.log("database image unauthenticated: 401");
console.log("database image invalid body/base64/format: 400");
console.log("database image successful upload/readback/serve: 200");
console.log("database image stale version: 409");
console.log("database image non-menu dish: 404");
console.log("database image unavailable: 503");
console.log("failed database image files compensated: yes");
console.log("database snapshot restored exactly: yes");
console.log("final business rows: 237");
console.log("final menu version: 1");
console.log("final dish sequence: 55");
