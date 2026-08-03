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

const [
  { readMenuFromDatabase },
  { prisma },
  { createAdminSession },
  { AdminRole, AdminStatus },
] = await Promise.all([
  import("../src/server/db/menu-read.ts"),
  import("../src/server/db/prisma.ts"),
  import("../src/server/auth/admin-session.ts"),
  import("../src/generated/prisma/enums.ts"),
]);

interface TestAdminCookies {
  owner: string;
  editor: string;
  viewer: string;
}

const adminTestPrefix =
  `image-write-${randomBytes(8).toString("hex")}-`;

async function adminDatabaseCounts() {
  const [adminUsers, adminSessions] = await Promise.all([
    prisma.adminUser.count(),
    prisma.adminSession.count(),
  ]);

  return {
    adminUsers,
    adminSessions,
  };
}

async function createTestAdminCookies(): Promise<TestAdminCookies> {
  const definitions = [
    {
      key: "owner",
      role: AdminRole.OWNER,
      displayName: "图片写入测试所有者",
    },
    {
      key: "editor",
      role: AdminRole.EDITOR,
      displayName: "图片写入测试编辑者",
    },
    {
      key: "viewer",
      role: AdminRole.VIEWER,
      displayName: "图片写入测试查看者",
    },
  ] as const;
  const users = await Promise.all(
    definitions.map((definition) =>
      prisma.adminUser.create({
        data: {
          email: `${adminTestPrefix}${definition.key}@example.invalid`,
          displayName: definition.displayName,
          passwordHash: "TEST_HASH_NOT_FOR_LOGIN",
          role: definition.role,
          status: AdminStatus.ACTIVE,
        },
      }),
    ),
  );
  const sessions = await Promise.all(
    users.map((user) => createAdminSession(user.id)),
  );

  return {
    owner: `menu_admin_session=${sessions[0].token}`,
    editor: `menu_admin_session=${sessions[1].token}`,
    viewer: `menu_admin_session=${sessions[2].token}`,
  };
}

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
  originalMenu: Menu,
  ownerCookie: string,
) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "menu-json-image-api-"),
  );
  const dataDirectory = path.join(temporaryRoot, "data");
  let server: RunningServer | null = null;

  try {
    server = await startServer(
      "json",
      dataDirectory,
    );
    const testDish = originalMenu.dishes[0];
    assert.ok(testDish);

    const response = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        origin: server.baseUrl,
        cookie: ownerCookie,
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
  originalMenu: Menu,
  originalSnapshot: MenuDatabaseSnapshot,
  adminCookies: TestAdminCookies,
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

    const legacyPasswordDenied = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        headers: {
          "X-Admin-Password": "legacy-password-must-not-work",
        },
        body: imageUploadBody(testDish.id, originalMenu.version),
      },
    );
    assert.equal(legacyPasswordDenied.status, 401);
    assert.equal(
      legacyPasswordDenied.payload.error,
      "ADMIN_AUTH_REQUIRED",
    );

    const forbiddenOrigin = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        origin: "https://evil.example",
        cookie: adminCookies.owner,
        rawBody: "{",
      },
    );
    assert.equal(forbiddenOrigin.status, 403);
    assert.equal(
      forbiddenOrigin.payload.error,
      "ADMIN_ORIGIN_FORBIDDEN",
    );

    const invalidSession = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        origin: server.baseUrl,
        cookie: "menu_admin_session=short",
        rawBody: "{",
      },
    );
    assert.equal(invalidSession.status, 401);
    assert.equal(
      invalidSession.payload.error,
      "ADMIN_SESSION_REQUIRED",
    );

    const viewerDenied = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        origin: server.baseUrl,
        cookie: adminCookies.viewer,
        rawBody: "{",
      },
    );
    assert.equal(viewerDenied.status, 403);
    assert.equal(
      viewerDenied.payload.error,
      "ADMIN_PERMISSION_DENIED",
    );
    assert.deepEqual(uploadedFiles(uploadsDirectory), []);
    assert.deepEqual(
      await takeMenuDatabaseSnapshot(prisma),
      originalSnapshot,
    );

    const invalidBody = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        origin: server.baseUrl,
        cookie: adminCookies.owner,
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
        origin: server.baseUrl,
        cookie: adminCookies.owner,
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
        origin: server.baseUrl,
        cookie: adminCookies.owner,
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

    const ownerUpload = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        origin: server.baseUrl,
        cookie: adminCookies.owner,
        body: imageUploadBody(testDish.id, originalMenu.version),
      },
    );
    assert.equal(ownerUpload.status, 200);
    assert.equal(ownerUpload.payload.linked, true);
    const ownerSavedMenu = ownerUpload.payload.menu as unknown as Menu;
    const ownerStorageKey = String(ownerUpload.payload.storageKey);
    const ownerRelativeFile = ownerStorageKey.slice("uploads/".length);
    assert.equal(ownerSavedMenu.version, originalMenu.version + 1);
    assert.deepEqual(uploadedFiles(uploadsDirectory), [
      ownerRelativeFile,
    ]);

    const editorUpload = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        origin: server.baseUrl,
        cookie: adminCookies.editor,
        body: imageUploadBody(testDish.id, ownerSavedMenu.version),
      },
    );
    assert.equal(editorUpload.status, 200);
    assert.equal(editorUpload.payload.linked, true);
    const editorSavedMenu = editorUpload.payload.menu as unknown as Menu;
    const editorStorageKey = String(editorUpload.payload.storageKey);
    const editorRelativeFile = editorStorageKey.slice("uploads/".length);
    assert.equal(editorSavedMenu.version, originalMenu.version + 2);
    assert.notEqual(editorStorageKey, ownerStorageKey);
    assert.deepEqual(uploadedFiles(uploadsDirectory), [
      editorRelativeFile,
    ]);

    const successfulUpload = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        origin: server.baseUrl,
        cookie: adminCookies.owner,
        body: imageUploadBody(testDish.id, editorSavedMenu.version),
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
    assert.equal(savedMenu.version, originalMenu.version + 3);
    assert.notEqual(storageKey, editorStorageKey);
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
    assert.equal(committedSnapshot.menuVersion, originalMenu.version + 3);
    assert.equal(committedSnapshot.dishSequenceValue, 55);

    const staleVersion = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        origin: server.baseUrl,
        cookie: adminCookies.owner,
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
        origin: server.baseUrl,
        cookie: adminCookies.owner,
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
  ownerCookie: string,
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
      dataDirectory,
      brokenDatabaseUrl.toString(),
    );
    const forbiddenOrigin = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        origin: "https://evil.example",
        cookie: ownerCookie,
        rawBody: "{",
      },
    );
    assert.equal(forbiddenOrigin.status, 403);
    assert.equal(
      forbiddenOrigin.payload.error,
      "ADMIN_ORIGIN_FORBIDDEN",
    );

    const unavailableSession = await apiRequest(
      server.baseUrl,
      "/api/upload",
      {
        method: "POST",
        origin: server.baseUrl,
        cookie: ownerCookie,
        rawBody: "{",
      },
    );
    assert.equal(unavailableSession.status, 503);
    assert.equal(
      unavailableSession.payload.error,
      "ADMIN_SESSION_UNAVAILABLE",
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

let topLevelError: unknown = null;
const beforeAdminCounts = await adminDatabaseCounts();
let afterAdminCounts = beforeAdminCounts;

try {
  const adminCookies = await createTestAdminCookies();
  const originalMenu = await readMenuFromDatabase();
  if (!originalMenu) {
    throw new Error("The default database menu was not found");
  }
  const originalSnapshot = await takeMenuDatabaseSnapshot(prisma);

  assert.equal(originalSnapshot.totalBusinessRows, 237);
  assert.equal(originalSnapshot.menuVersion, 1);
  assert.equal(originalSnapshot.dishSequenceValue, 55);

  await checkJsonImageApi(originalMenu, adminCookies.owner);
  assert.deepEqual(
    await takeMenuDatabaseSnapshot(prisma),
    originalSnapshot,
  );

  await checkDatabaseImageApi(
    originalMenu,
    originalSnapshot,
    adminCookies,
  );
  assert.deepEqual(
    await takeMenuDatabaseSnapshot(prisma),
    originalSnapshot,
  );
  assert.deepEqual(await readMenuFromDatabase(), originalMenu);

  await checkUnavailableDatabaseImageApi(
    adminCookies.owner,
  );
  assert.deepEqual(
    await takeMenuDatabaseSnapshot(prisma),
    originalSnapshot,
  );
} catch (error) {
  topLevelError = error;
} finally {
  await prisma.adminUser.deleteMany({
    where: {
      email: {
        startsWith: adminTestPrefix,
      },
    },
  });
  afterAdminCounts = await adminDatabaseCounts();
  await prisma.$disconnect();
}

if (topLevelError) {
  throw topLevelError;
}

assert.deepEqual(afterAdminCounts, beforeAdminCounts);

console.log("json image API behavior unchanged: passed");
console.log("database image unauthenticated: 401");
console.log("database image legacy password header rejected: 401");
console.log("database image wrong-Origin session: 403 before database/body");
console.log("database image invalid session: 401 before body");
console.log("database image VIEWER session: 403 before body");
console.log("database image OWNER/EDITOR sessions: 200/200");
console.log("database image writes use OWNER/EDITOR sessions only");
console.log("database image invalid body/base64/format: 400");
console.log("database image successful upload/readback/serve: 200");
console.log("database image stale version: 409");
console.log("database image non-menu dish: 404");
console.log("database image unavailable session: 503");
console.log("failed database image files compensated: yes");
console.log("database snapshot restored exactly: yes");
console.log("final business rows: 237");
console.log("final menu version: 1");
console.log("final dish sequence: 55");
console.log(
  `final admin users/sessions: ${afterAdminCounts.adminUsers}/${afterAdminCounts.adminSessions}`,
);
