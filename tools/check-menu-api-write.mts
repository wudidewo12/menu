import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
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

const [{ readMenuFromDatabase }, { prisma }] = await Promise.all([
  import("../src/server/db/menu-read.ts"),
  import("../src/server/db/prisma.ts"),
]);

interface ApiResponse {
  status: number;
  payload: Record<string, unknown>;
}

interface RunningServer {
  baseUrl: string;
  process: ChildProcess;
}

function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local test port"));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForHealth(baseUrl: string, process: ChildProcess) {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Menu server exited early with code ${process.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.status === 200) {
        return;
      }
    } catch {
      // The server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Timed out waiting for the isolated menu server");
}

async function startServer(
  menuSource: "json" | "database",
  adminPassword: string,
  dataDirectory: string,
  databaseConnection = databaseUrl,
): Promise<RunningServer> {
  const port = await getFreePort();
  const childEnvironment = {
    ...process.env,
    ADMIN_PASSWORD: adminPassword,
    DATA_DIR: dataDirectory,
    MENU_READ_SOURCE: menuSource,
    PORT: String(port),
  };

  if (menuSource === "json") {
    delete childEnvironment.DATABASE_URL;
    delete childEnvironment.POSTGRES_APP_USER;
  } else {
    childEnvironment.DATABASE_URL = databaseConnection;
    childEnvironment.POSTGRES_APP_USER = applicationRole;
  }

  delete childEnvironment.DATABASE_ADMIN_URL;
  delete childEnvironment.POSTGRES_OWNER;
  delete childEnvironment.POSTGRES_OWNER_PASSWORD;
  delete childEnvironment.POSTGRES_APP_PASSWORD;

  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--conditions=react-server",
      "server.js",
    ],
    {
      cwd: process.cwd(),
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const baseUrl = `http://127.0.0.1:${port}`;

  await waitForHealth(baseUrl, child);
  return {
    baseUrl,
    process: child,
  };
}

async function stopServer(server: RunningServer | null) {
  if (!server || server.process.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      server.process.kill("SIGKILL");
    }, 5_000);

    server.process.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    server.process.kill("SIGTERM");
  });
}

async function apiRequest(
  baseUrl: string,
  pathname: string,
  options: {
    method?: string;
    password?: string;
    body?: unknown;
    rawBody?: string;
  } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  if (options.password) {
    headers["X-Admin-Password"] = options.password;
  }
  if (options.body !== undefined || options.rawBody !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? "GET",
    headers,
    body:
      options.rawBody ??
      (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const payload = (await response.json()) as Record<string, unknown>;

  return {
    status: response.status,
    payload,
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

async function checkJsonMode(adminPassword: string) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "menu-json-api-check-"),
  );
  const dataDirectory = path.join(temporaryRoot, "data");
  let server: RunningServer | null = null;

  try {
    server = await startServer(
      "json",
      adminPassword,
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
      password: adminPassword,
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
  adminPassword: string,
  currentMenu: Menu,
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
      adminPassword,
      path.join(temporaryRoot, "data"),
      brokenDatabaseUrl.toString(),
    );
    const response = await apiRequest(server.baseUrl, "/api/menu", {
      method: "PUT",
      password: adminPassword,
      body: currentMenu,
    });

    assert.equal(response.status, 503);
    assert.equal(response.payload.error, "DATABASE_MENU_UNAVAILABLE");
  } finally {
    await stopServer(server);
    fs.rmSync(temporaryRoot, {
      recursive: true,
      force: true,
    });
  }
}

async function checkDatabaseMode(
  adminPassword: string,
  originalMenu: Menu,
  originalSnapshot: MenuDatabaseSnapshot,
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
      adminPassword,
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

    const uploadBlocked = await apiRequest(server.baseUrl, "/api/upload", {
      method: "POST",
      password: adminPassword,
      body: {},
    });
    assert.equal(uploadBlocked.status, 409);
    assert.equal(
      uploadBlocked.payload.error,
      "DATABASE_MENU_WRITE_NOT_READY",
    );

    const invalidBody = await apiRequest(server.baseUrl, "/api/menu", {
      method: "PUT",
      password: adminPassword,
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
        password: adminPassword,
        body: invalidMenu,
      },
    );
    assert.equal(validationFailure.status, 400);
    assert.equal(
      validationFailure.payload.error,
      "MENU_WRITE_VALIDATION_FAILED",
    );

    const successfulWrite = await apiRequest(
      server.baseUrl,
      "/api/menu",
      {
        method: "PUT",
        password: adminPassword,
        body: scenario.desiredMenu,
      },
    );
    assert.equal(successfulWrite.status, 200);
    assert.equal(successfulWrite.payload.version, 2);
    successfulWriteCommitted = true;

    const savedMenu = successfulWrite.payload as unknown as Menu;
    assert.ok(savedMenu.settings.title.includes("数据库API测试"));

    const reread = await apiRequest(server.baseUrl, "/api/menu");
    assert.equal(reread.status, 200);
    assert.deepEqual(reread.payload, successfulWrite.payload);

    const staleMenu = structuredClone(savedMenu);
    staleMenu.version = originalMenu.version;
    const staleWrite = await apiRequest(server.baseUrl, "/api/menu", {
      method: "PUT",
      password: adminPassword,
      body: staleMenu,
    });
    assert.equal(staleWrite.status, 409);
    assert.equal(staleWrite.payload.error, "MENU_VERSION_CONFLICT");

    const skippedDishId = await apiRequest(server.baseUrl, "/api/menu", {
      method: "PUT",
      password: adminPassword,
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

  await checkJsonMode(adminPassword);
  assert.deepEqual(
    await takeMenuDatabaseSnapshot(prisma),
    originalSnapshot,
  );

  await checkDatabaseMode(
    adminPassword,
    originalMenu,
    originalSnapshot,
  );
  assert.deepEqual(
    await takeMenuDatabaseSnapshot(prisma),
    originalSnapshot,
  );
  assert.deepEqual(await readMenuFromDatabase(), originalMenu);

  await checkBrokenDatabaseMode(adminPassword, originalMenu);
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

console.log("json mode authenticated PUT unchanged: passed");
console.log("database mode unauthenticated PUT: 401");
console.log("database mode image upload remains blocked: 409");
console.log("database mode invalid body/validation: 400");
console.log("database mode successful PUT/readback: 200");
console.log("database mode stale version/dish id conflict: 409");
console.log("database mode unavailable response: 503");
console.log("database snapshot restored exactly: yes");
console.log("final business rows: 237");
console.log("final menu version: 1");
console.log("final dish sequence: 55");
