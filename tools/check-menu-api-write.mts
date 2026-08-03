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
import { createMenuWriteScenario } from "./database-menu-write-scenario.mts";
import {
  apiRequest,
  type RunningServer,
  startServer,
  stopServer,
} from "./menu-api-test-client.mts";

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
  `menu-write-${randomBytes(8).toString("hex")}-`;

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
      displayName: "菜单写入测试所有者",
    },
    {
      key: "editor",
      role: AdminRole.EDITOR,
      displayName: "菜单写入测试编辑者",
    },
    {
      key: "viewer",
      role: AdminRole.VIEWER,
      displayName: "菜单写入测试查看者",
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

function addSkippedDishId(menu: Menu) {
  const desiredMenu = structuredClone(menu);
  const skippedId =
    Math.max(...desiredMenu.dishes.map((dish) => dish.id)) + 2;

  desiredMenu.dishes.push({
    id: skippedId,
    name: "跳号测试菜",
    slug: `dish-${skippedId}`,
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

  return desiredMenu;
}

async function checkJsonMode(ownerCookie: string) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "menu-json-api-check-"),
  );
  const dataDirectory = path.join(temporaryRoot, "data");
  let server: RunningServer | null = null;

  try {
    server = await startServer(
      "json",
      dataDirectory,
    );
    const originalResponse = await apiRequest(server.baseUrl, "/api/menu");
    assert.equal(originalResponse.status, 200);

    const desiredMenu = structuredClone(originalResponse.payload) as unknown as Menu;
    desiredMenu.settings.title += "（JSON API测试）";

    const unauthorized = await apiRequest(server.baseUrl, "/api/menu", {
      method: "PUT",
      body: desiredMenu,
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.payload.error, "ADMIN_AUTH_REQUIRED");

    const saved = await apiRequest(server.baseUrl, "/api/menu", {
      method: "PUT",
      origin: server.baseUrl,
      cookie: ownerCookie,
      body: desiredMenu,
    });
    assert.equal(saved.status, 200);
    assert.equal(
      (saved.payload.settings as { title: string }).title,
      desiredMenu.settings.title,
    );

    const reread = await apiRequest(server.baseUrl, "/api/menu");
    assert.equal(reread.status, 200);
    assert.equal(
      (reread.payload.settings as { title: string }).title,
      desiredMenu.settings.title,
    );
  } finally {
    await stopServer(server);
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
    });
  }
}

async function checkBrokenDatabaseMode(
  ownerCookie: string,
) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "menu-broken-db-api-check-"),
  );
  const brokenDatabaseUrl = new URL(databaseUrl);
  brokenDatabaseUrl.hostname = "127.0.0.1";
  brokenDatabaseUrl.port = "1";
  let server: RunningServer | null = null;

  try {
    server = await startServer(
      "database",
      path.join(temporaryRoot, "data"),
      brokenDatabaseUrl.toString(),
    );
    const forbiddenOrigin = await apiRequest(
      server.baseUrl,
      "/api/menu",
      {
        method: "PUT",
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
      "/api/menu",
      {
        method: "PUT",
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

  } finally {
    await stopServer(server);
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
    });
  }
}

async function checkDatabaseMode(
  originalMenu: Menu,
  originalSnapshot: MenuDatabaseSnapshot,
  adminCookies: TestAdminCookies,
) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "menu-db-api-check-"),
  );
  let server: RunningServer | null = null;
  let successfulWriteCommitted = false;
  let verificationError: unknown = null;

  try {
    server = await startServer(
      "database",
      path.join(temporaryRoot, "data"),
    );

    const initialRead = await apiRequest(server.baseUrl, "/api/menu");
    assert.equal(initialRead.status, 200);
    assert.equal(initialRead.payload.version, originalMenu.version);

    const scenario = createMenuWriteScenario(
      originalMenu,
      "（数据库API测试）",
    );
    const unauthorized = await apiRequest(server.baseUrl, "/api/menu", {
      method: "PUT",
      body: scenario.desiredMenu,
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.payload.error, "ADMIN_AUTH_REQUIRED");

    const forbiddenOrigin = await apiRequest(
      server.baseUrl,
      "/api/menu",
      {
        method: "PUT",
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
      "/api/menu",
      {
        method: "PUT",
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
      "/api/menu",
      {
        method: "PUT",
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

    const invalidBody = await apiRequest(server.baseUrl, "/api/menu", {
      method: "PUT",
      origin: server.baseUrl,
      cookie: adminCookies.owner,
      rawBody: "{",
    });
    assert.equal(invalidBody.status, 400);
    assert.equal(invalidBody.payload.error, "INVALID_REQUEST_BODY");

    const invalidMenu = structuredClone(originalMenu);
    invalidMenu.dishes[0].prepTime = "半小时";
    const validationFailure = await apiRequest(
      server.baseUrl,
      "/api/menu",
      {
        method: "PUT",
        origin: server.baseUrl,
        cookie: adminCookies.owner,
        body: invalidMenu,
      },
    );
    assert.equal(validationFailure.status, 400);
    assert.equal(
      validationFailure.payload.error,
      "MENU_WRITE_VALIDATION_FAILED",
    );

    const ownerWrite = await apiRequest(
      server.baseUrl,
      "/api/menu",
      {
        method: "PUT",
        origin: server.baseUrl,
        cookie: adminCookies.owner,
        body: scenario.desiredMenu,
      },
    );
    assert.equal(ownerWrite.status, 200);
    assert.equal(ownerWrite.payload.version, 2);
    successfulWriteCommitted = true;

    const ownerSavedMenu = ownerWrite.payload as unknown as Menu;
    assert.ok(ownerSavedMenu.settings.title.includes("数据库API测试"));

    const editorDesiredMenu = structuredClone(ownerSavedMenu);
    editorDesiredMenu.settings.title += "（编辑者会话）";
    const editorWrite = await apiRequest(
      server.baseUrl,
      "/api/menu",
      {
        method: "PUT",
        origin: server.baseUrl,
        cookie: adminCookies.editor,
        body: editorDesiredMenu,
      },
    );
    assert.equal(editorWrite.status, 200);
    assert.equal(editorWrite.payload.version, 3);

    const editorSavedMenu = editorWrite.payload as unknown as Menu;
    assert.ok(editorSavedMenu.settings.title.includes("编辑者会话"));

    const legacyWrite = await apiRequest(
      server.baseUrl,
      "/api/menu",
      {
        method: "PUT",
        headers: {
          "X-Admin-Password": "legacy-password-must-not-work",
        },
        body: editorSavedMenu,
      },
    );
    assert.equal(legacyWrite.status, 401);
    assert.equal(legacyWrite.payload.error, "ADMIN_AUTH_REQUIRED");

    const savedMenu = editorSavedMenu;

    const reread = await apiRequest(server.baseUrl, "/api/menu");
    assert.equal(reread.status, 200);
    assert.deepEqual(reread.payload, editorWrite.payload);

    const staleMenu = structuredClone(savedMenu);
    staleMenu.version = originalMenu.version;
    const staleWrite = await apiRequest(server.baseUrl, "/api/menu", {
      method: "PUT",
      origin: server.baseUrl,
      cookie: adminCookies.owner,
      body: staleMenu,
    });
    assert.equal(staleWrite.status, 409);
    assert.equal(staleWrite.payload.error, "MENU_VERSION_CONFLICT");

    const skippedDishId = await apiRequest(server.baseUrl, "/api/menu", {
      method: "PUT",
      origin: server.baseUrl,
      cookie: adminCookies.owner,
      body: addSkippedDishId(savedMenu),
    });
    assert.equal(skippedDishId.status, 409);
    assert.equal(skippedDishId.payload.error, "DISH_ID_CONFLICT");
  } catch (error) {
    verificationError = error;
  } finally {
    await stopServer(server);

    if (successfulWriteCommitted) {
      try {
        await restoreMenuDatabaseSnapshot(prisma, originalSnapshot);
      } catch (restoreError) {
        verificationError = new AggregateError(
          [verificationError, restoreError].filter(Boolean),
          "Database API test failed and snapshot restoration also failed",
        );
      }
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

  await checkJsonMode(adminCookies.owner);
  assert.deepEqual(
    await takeMenuDatabaseSnapshot(prisma),
    originalSnapshot,
  );

  await checkDatabaseMode(
    originalMenu,
    originalSnapshot,
    adminCookies,
  );
  assert.deepEqual(
    await takeMenuDatabaseSnapshot(prisma),
    originalSnapshot,
  );
  assert.deepEqual(await readMenuFromDatabase(), originalMenu);

  await checkBrokenDatabaseMode(
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

console.log("json mode authenticated PUT unchanged: passed");
console.log("database mode unauthenticated PUT: 401");
console.log("database mode wrong-Origin session PUT: 403 before database/body");
console.log("database mode invalid session PUT: 401 before body");
console.log("database mode VIEWER PUT: 403 before body");
console.log("database mode OWNER/EDITOR session PUT: 200/200");
console.log("database mode legacy password header rejected: 401");
console.log("database mode invalid body/validation: 400");
console.log("database mode successful PUT/readback: 200");
console.log("database mode stale version/dish id conflict: 409");
console.log("database mode unavailable session response: 503");
console.log("database snapshot restored exactly: yes");
console.log("final business rows: 237");
console.log("final menu version: 1");
console.log("final dish sequence: 55");
console.log(
  `final admin users/sessions: ${afterAdminCounts.adminUsers}/${afterAdminCounts.adminSessions}`,
);
