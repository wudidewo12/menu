import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import dotenv from "dotenv";

import {
  apiRequest,
  type RunningServer,
  startServer,
  stopServer,
} from "./menu-api-test-client.mts";

const localEnvironment = dotenv.parse(
  fs.readFileSync(".env.local"),
);
const databaseUrl = localEnvironment.DATABASE_URL;
const applicationRole = localEnvironment.POSTGRES_APP_USER;

if (!databaseUrl || !applicationRole) {
  throw new Error(
    "DATABASE_URL and POSTGRES_APP_USER are required in .env.local",
  );
}

process.env.DATABASE_URL = databaseUrl;
process.env.POSTGRES_APP_USER = applicationRole;

delete process.env.DATABASE_ADMIN_URL;
delete process.env.POSTGRES_OWNER;
delete process.env.POSTGRES_OWNER_PASSWORD;
delete process.env.POSTGRES_APP_PASSWORD;

const [
  { AdminRole, AdminStatus },
  { hashPassword },
  { createSessionToken, hashSessionToken },
  { readAdminSessionToken },
  { prisma },
] = await Promise.all([
  import("../src/generated/prisma/enums.ts"),
  import("../src/server/auth/password.ts"),
  import("../src/server/auth/session-token.ts"),
  import("../src/server/auth/admin-session-cookie.ts"),
  import("../src/server/db/prisma.ts"),
]);

async function databaseCounts() {
  const [
    adminUsers,
    adminSessions,
    menus,
    dishes,
    menuDishes,
    menuSections,
    sectionDishes,
    dishImages,
  ] = await Promise.all([
    prisma.adminUser.count(),
    prisma.adminSession.count(),
    prisma.menu.count(),
    prisma.dish.count(),
    prisma.menuDish.count(),
    prisma.menuSection.count(),
    prisma.sectionDish.count(),
    prisma.dishImage.count(),
  ]);

  return {
    adminUsers,
    adminSessions,
    businessRows:
      menus +
      dishes +
      menuDishes +
      menuSections +
      sectionDishes +
      dishImages,
  };
}

const testId = randomBytes(12).toString("hex");
const testEmail = `login-api-${testId}@example.invalid`;
const testPassword =
  `Login API Test Only ${randomBytes(24).toString("base64url")}`;
const wrongPassword =
  `Wrong Login API Test ${randomBytes(24).toString("base64url")}`;
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "menu-admin-login-api-"),
);
let server: RunningServer | null = null;
let testUserId: string | null = null;
let topLevelError: unknown = null;
let before = {
  adminUsers: -1,
  adminSessions: -1,
  businessRows: -1,
};
let after = before;

try {
  before = await databaseCounts();
  assert.equal(before.businessRows, 237);
  assert.ok(before.adminUsers >= 1);
  assert.ok(before.adminSessions >= 0);

  const passwordHash = await hashPassword(testPassword);
  const testUser = await prisma.adminUser.create({
    data: {
      email: testEmail,
      displayName: "登录接口临时测试管理员",
      passwordHash,
      role: AdminRole.OWNER,
      status: AdminStatus.ACTIVE,
    },
    select: {
      id: true,
    },
  });
  testUserId = testUser.id;

  server = await startServer(
    "database",
    path.join(temporaryRoot, "data"),
    databaseUrl,
  );

  const preflight = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      method: "OPTIONS",
      origin: "https://evil.example",
    },
  );
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.allow,
    "DELETE, GET, POST",
  );
  assert.equal(
    preflight.headers["access-control-allow-origin"],
    undefined,
  );
  assert.equal(preflight.setCookies.length, 0);

  const missingSession = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
  );
  assert.equal(missingSession.status, 401);
  assert.equal(
    missingSession.payload.error,
    "ADMIN_SESSION_REQUIRED",
  );

  const malformedSession = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      cookie: "menu_admin_session=short",
    },
  );
  assert.equal(malformedSession.status, 401);
  assert.deepEqual(
    malformedSession.payload,
    missingSession.payload,
  );

  const unknownSessionToken = createSessionToken().token;
  const unknownSession = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      cookie: `menu_admin_session=${unknownSessionToken}`,
    },
  );
  assert.equal(unknownSession.status, 401);
  assert.deepEqual(
    unknownSession.payload,
    missingSession.payload,
  );

  const missingOrigin = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      method: "POST",
      body: {
        email: testEmail,
        password: testPassword,
      },
    },
  );
  assert.equal(missingOrigin.status, 403);
  assert.equal(
    missingOrigin.payload.error,
    "ADMIN_ORIGIN_FORBIDDEN",
  );

  const wrongOrigin = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      method: "POST",
      origin: "https://evil.example",
      rawBody: "{not-json",
    },
  );
  assert.equal(wrongOrigin.status, 403);
  assert.equal(
    wrongOrigin.payload.error,
    "ADMIN_ORIGIN_FORBIDDEN",
  );

  const missingContentType = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      method: "POST",
      origin: server.baseUrl,
      contentType: null,
      body: {
        email: testEmail,
        password: testPassword,
      },
    },
  );
  assert.equal(missingContentType.status, 415);
  assert.equal(
    missingContentType.payload.error,
    "JSON_CONTENT_TYPE_REQUIRED",
  );

  const invalidJson = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      method: "POST",
      origin: server.baseUrl,
      rawBody: "{not-json",
    },
  );
  assert.equal(invalidJson.status, 400);
  assert.equal(
    invalidJson.payload.error,
    "ADMIN_LOGIN_INPUT_INVALID",
  );

  const invalidInput = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      method: "POST",
      origin: server.baseUrl,
      body: {
        email: "invalid",
        password: "",
      },
    },
  );
  assert.equal(invalidInput.status, 400);
  assert.equal(
    invalidInput.payload.error,
    "ADMIN_LOGIN_INPUT_INVALID",
  );

  const unknownAccount = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      method: "POST",
      origin: server.baseUrl,
      body: {
        email: `unknown-${testId}@example.invalid`,
        password: wrongPassword,
      },
    },
  );
  assert.equal(unknownAccount.status, 401);
  assert.equal(
    unknownAccount.payload.error,
    "ADMIN_LOGIN_REJECTED",
  );

  const wrongCredentials = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      method: "POST",
      origin: server.baseUrl,
      body: {
        email: testEmail,
        password: wrongPassword,
      },
    },
  );
  assert.equal(wrongCredentials.status, 401);
  assert.equal(
    wrongCredentials.payload.error,
    "ADMIN_LOGIN_REJECTED",
  );
  assert.deepEqual(
    wrongCredentials.payload,
    unknownAccount.payload,
  );
  assert.equal(
    await prisma.adminSession.count(),
    before.adminSessions,
  );

  const successfulLogin = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      method: "POST",
      origin: server.baseUrl,
      body: {
        email: testEmail,
        password: testPassword,
      },
    },
  );
  assert.equal(successfulLogin.status, 200);
  assert.equal(successfulLogin.payload.authenticated, true);
  assert.equal(
    (successfulLogin.payload.user as { email: string }).email,
    testEmail,
  );
  assert.equal(
    (successfulLogin.payload.user as { role: string }).role,
    "OWNER",
  );
  assert.equal(
    "token" in successfulLogin.payload,
    false,
  );
  assert.equal(
    "password" in successfulLogin.payload,
    false,
  );
  assert.equal(
    "userId" in (
      successfulLogin.payload.session as Record<string, unknown>
    ),
    false,
  );
  assert.equal(
    "tokenHash" in (
      successfulLogin.payload.session as Record<string, unknown>
    ),
    false,
  );
  assert.equal(successfulLogin.setCookies.length, 1);

  const setCookie = successfulLogin.setCookies[0];
  assert.ok(setCookie);
  assert.match(setCookie, /^menu_admin_session=/);
  assert.match(setCookie, /; Path=\//);
  assert.match(setCookie, /; HttpOnly/);
  assert.match(setCookie, /; SameSite=Strict/);
  assert.match(setCookie, /; Max-Age=28800/);
  assert.equal(setCookie.includes("; Secure"), false);

  const token = readAdminSessionToken(setCookie);
  assert.ok(token);
  const session = await prisma.adminSession.findUnique({
    where: {
      tokenHash: hashSessionToken(token),
    },
  });
  assert.ok(session);
  assert.notEqual(session.tokenHash, token);
  assert.equal(session.userId, testUserId);

  const cookieHeader = setCookie.split(";", 1)[0];
  assert.ok(cookieHeader);
  const duplicateSession = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      cookie: `${cookieHeader}; ${cookieHeader}`,
    },
  );
  assert.equal(duplicateSession.status, 401);
  assert.deepEqual(
    duplicateSession.payload,
    missingSession.payload,
  );

  const activeSession = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      cookie: cookieHeader,
    },
  );
  assert.equal(activeSession.status, 200);
  assert.deepEqual(
    activeSession.payload,
    successfulLogin.payload,
  );
  assert.equal(activeSession.setCookies.length, 0);

  const unchangedSession =
    await prisma.adminSession.findUniqueOrThrow({
      where: {
        id: session.id,
      },
    });
  assert.equal(
    unchangedSession.lastSeenAt.getTime(),
    session.lastSeenAt.getTime(),
  );

  const forbiddenLogout = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      method: "DELETE",
      origin: "https://evil.example",
      cookie: cookieHeader,
    },
  );
  assert.equal(forbiddenLogout.status, 403);
  assert.deepEqual(forbiddenLogout.payload, {
    error: "ADMIN_ORIGIN_FORBIDDEN",
  });
  assert.equal(forbiddenLogout.setCookies.length, 0);
  assert.equal(
    (
      await prisma.adminSession.findUniqueOrThrow({
        where: {
          id: session.id,
        },
      })
    ).revokedAt,
    null,
  );

  const activeAfterForbiddenLogout = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      cookie: cookieHeader,
    },
  );
  assert.equal(activeAfterForbiddenLogout.status, 200);

  const successfulLogout = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      method: "DELETE",
      origin: server.baseUrl,
      cookie: cookieHeader,
    },
  );
  assert.equal(successfulLogout.status, 200);
  assert.deepEqual(successfulLogout.payload, {
    authenticated: false,
  });
  assert.deepEqual(successfulLogout.setCookies, [
    "menu_admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ]);
  assert.equal(
    readAdminSessionToken(successfulLogout.setCookies[0]),
    null,
  );

  const revokedDatabaseSession =
    await prisma.adminSession.findUniqueOrThrow({
      where: {
        id: session.id,
      },
    });
  assert.ok(revokedDatabaseSession.revokedAt);

  const revokedSessionLookup = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      cookie: cookieHeader,
    },
  );
  assert.equal(revokedSessionLookup.status, 401);
  assert.deepEqual(
    revokedSessionLookup.payload,
    missingSession.payload,
  );

  const repeatedLogout = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      method: "DELETE",
      origin: server.baseUrl,
      cookie: cookieHeader,
    },
  );
  assert.equal(repeatedLogout.status, 200);
  assert.deepEqual(
    repeatedLogout.payload,
    successfulLogout.payload,
  );
  assert.deepEqual(
    repeatedLogout.setCookies,
    successfulLogout.setCookies,
  );
  assert.equal(
    (
      await prisma.adminSession.findUniqueOrThrow({
        where: {
          id: session.id,
        },
      })
    ).revokedAt?.getTime(),
    revokedDatabaseSession.revokedAt.getTime(),
  );

  for (const cookie of [
    undefined,
    "menu_admin_session=short",
    `menu_admin_session=${unknownSessionToken}`,
  ]) {
    const idempotentLogout = await apiRequest(
      server.baseUrl,
      "/api/admin/session",
      {
        method: "DELETE",
        origin: server.baseUrl,
        cookie,
      },
    );
    assert.equal(idempotentLogout.status, 200);
    assert.deepEqual(
      idempotentLogout.payload,
      successfulLogout.payload,
    );
    assert.deepEqual(
      idempotentLogout.setCookies,
      successfulLogout.setCookies,
    );
  }

  const updatedUser =
    await prisma.adminUser.findUniqueOrThrow({
      where: {
        id: testUserId,
      },
    });
  assert.equal(updatedUser.failedLoginAttempts, 0);
  assert.equal(updatedUser.lockedUntil, null);
  assert.ok(updatedUser.lastLoginAt);

  const responseText = JSON.stringify(successfulLogin.payload);
  assert.equal(responseText.includes(testPassword), false);
  assert.equal(responseText.includes(wrongPassword), false);
  assert.equal(responseText.includes(token), false);
  assert.equal(responseText.includes(session.tokenHash), false);

  await stopServer(server);
  server = null;
  const brokenDatabaseUrl = new URL(databaseUrl);
  brokenDatabaseUrl.hostname = "127.0.0.1";
  brokenDatabaseUrl.port = "1";
  server = await startServer(
    "database",
    path.join(temporaryRoot, "broken-data"),
    brokenDatabaseUrl.toString(),
  );
  const unavailableSession = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      cookie: `menu_admin_session=${unknownSessionToken}`,
    },
  );
  assert.equal(unavailableSession.status, 503);
  assert.deepEqual(unavailableSession.payload, {
    error: "ADMIN_SESSION_UNAVAILABLE",
  });
  const unavailableLogout = await apiRequest(
    server.baseUrl,
    "/api/admin/session",
    {
      method: "DELETE",
      origin: server.baseUrl,
      cookie: `menu_admin_session=${unknownSessionToken}`,
    },
  );
  assert.equal(unavailableLogout.status, 503);
  assert.deepEqual(unavailableLogout.payload, {
    error: "ADMIN_SESSION_UNAVAILABLE",
  });
  assert.equal(unavailableLogout.setCookies.length, 0);
} catch (error) {
  topLevelError = error;
} finally {
  await stopServer(server);

  if (testUserId) {
    await prisma.adminUser.deleteMany({
      where: {
        id: testUserId,
      },
    });
  }

  after = await databaseCounts();
  await prisma.$disconnect();
  fs.rmSync(temporaryRoot, {
    recursive: true,
    force: true,
  });
}

if (topLevelError) {
  throw topLevelError;
}

assert.deepEqual(after, before);

console.log("admin login POST API: passed");
console.log("missing/wrong Origin: 403 before login");
console.log("content type/input validation: 415/400");
console.log("unknown/wrong credentials: identical 401");
console.log("successful login and Set-Cookie: 200");
console.log("current active session lookup: 200");
console.log("missing/malformed/unknown/revoked session: identical 401");
console.log("unavailable session database: safe 503");
console.log("current session database writes: 0");
console.log("wrong-Origin logout: 403 without revoke/clear");
console.log("successful logout: revoked and cookie cleared");
console.log("missing/malformed/unknown/repeated logout: idempotent 200");
console.log("unavailable logout database: safe 503 without clear");
console.log("raw password/token/hash printed: 0");
console.log(
  `AdminUser rows before/after: ${before.adminUsers}/${after.adminUsers}`,
);
console.log(
  `AdminSession rows before/after: ${before.adminSessions}/${after.adminSessions}`,
);
console.log(
  `business rows before/after: ${before.businessRows}/${after.businessRows}`,
);
