import assert from "node:assert/strict";
import fs from "node:fs";

import dotenv from "dotenv";

const localEnvironment = dotenv.parse(fs.readFileSync(".env.local"));
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
  {
    AdminPasswordResetUserNotFoundError,
    resetAdminPassword,
    resetAdminPasswordInTransaction,
  },
  {
    AdminPasswordResetPlanError,
  },
  {
    hashPassword,
    verifyPassword,
  },
  {
    AdminRole,
    AdminStatus,
  },
  { Prisma },
  { prisma },
] = await Promise.all([
  import("../src/server/auth/admin-password-reset.ts"),
  import("../src/server/auth/admin-password-reset-plan.ts"),
  import("../src/server/auth/password.ts"),
  import("../src/generated/prisma/enums.ts"),
  import("../src/generated/prisma/client.ts"),
  import("../src/server/db/prisma.ts"),
]);

const TEST_EMAIL = "password.reset.rollback@example.invalid";
const TEST_DISPLAY_NAME = "Password Reset Rollback Administrator 2026";
const OLD_PASSWORD = "Old Rollback Password Test Only 2026!";
const NEW_PASSWORD = "New Rollback Password Test Only 2026!";
const TEST_NOW = new Date("2026-07-31T02:00:00.000Z");
const OLD_PASSWORD_CHANGED_AT =
  new Date("2026-07-01T02:00:00.000Z");
const EXISTING_REVOKED_AT =
  new Date("2026-07-20T02:00:00.000Z");
const forcedRollbackError =
  new Error("FORCED_ADMIN_PASSWORD_RESET_ROLLBACK");

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

try {
  const before = await databaseCounts();

  assert.equal(before.businessRows, 237);
  assert.ok(before.adminUsers >= 1);
  assert.ok(before.adminSessions >= 0);

  await assert.rejects(
    resetAdminPassword({}),
    (error: unknown) =>
      error instanceof AdminPasswordResetPlanError,
  );
  assert.deepEqual(await databaseCounts(), before);

  await assert.rejects(
    resetAdminPassword({
      email: "missing.reset.user@example.invalid",
      password: NEW_PASSWORD,
    }),
    (error: unknown) =>
      error instanceof AdminPasswordResetUserNotFoundError,
  );
  assert.deepEqual(await databaseCounts(), before);

  await assert.rejects(
    prisma.$transaction(
      async (transaction) => {
        const oldPasswordHash = await hashPassword(OLD_PASSWORD);
        const user = await transaction.adminUser.create({
          data: {
            email: TEST_EMAIL,
            displayName: TEST_DISPLAY_NAME,
            passwordHash: oldPasswordHash,
            role: AdminRole.OWNER,
            status: AdminStatus.ACTIVE,
            failedLoginAttempts: 4,
            lockedUntil: new Date("2026-08-01T02:00:00.000Z"),
            passwordChangedAt: OLD_PASSWORD_CHANGED_AT,
          },
          select: {
            id: true,
          },
        });
        const sessions = await Promise.all([
          transaction.adminSession.create({
            data: {
              userId: user.id,
              tokenHash: "1".repeat(64),
              expiresAt: new Date("2026-08-01T02:00:00.000Z"),
            },
            select: {
              id: true,
            },
          }),
          transaction.adminSession.create({
            data: {
              userId: user.id,
              tokenHash: "2".repeat(64),
              expiresAt: new Date("2026-07-30T02:00:00.000Z"),
            },
            select: {
              id: true,
            },
          }),
          transaction.adminSession.create({
            data: {
              userId: user.id,
              tokenHash: "3".repeat(64),
              expiresAt: new Date("2026-08-01T02:00:00.000Z"),
              revokedAt: EXISTING_REVOKED_AT,
            },
            select: {
              id: true,
            },
          }),
        ]);

        await assert.rejects(
          resetAdminPasswordInTransaction(
            transaction,
            {
              email: TEST_EMAIL,
              password: TEST_DISPLAY_NAME,
            },
            {
              now: TEST_NOW,
            },
          ),
          (error: unknown) =>
            error instanceof AdminPasswordResetPlanError &&
            error.issues.some(
              (issue) => issue.code === "PASSWORD_BLOCKED",
            ),
        );

        const result = await resetAdminPasswordInTransaction(
          transaction,
          {
            email: `  ${TEST_EMAIL.toUpperCase()}  `,
            password: NEW_PASSWORD,
            role: "VIEWER",
            status: "DISABLED",
            passwordHash: "MUST_NOT_BE_ACCEPTED",
          },
          {
            now: TEST_NOW,
          },
        );
        const serializedResult = JSON.stringify(result);

        assert.equal(result.reset, true);
        assert.equal(result.user.email, TEST_EMAIL);
        assert.equal(result.user.displayName, TEST_DISPLAY_NAME);
        assert.equal(result.user.role, "OWNER");
        assert.equal(result.user.status, "ACTIVE");
        assert.equal(
          result.user.passwordChangedAt.getTime(),
          TEST_NOW.getTime(),
        );
        assert.equal(result.password.storedAs, "ARGON2ID_HASH_ONLY");
        assert.equal(result.sessionsRevoked, 2);
        assert.equal("id" in result.user, false);
        assert.equal("passwordHash" in result.user, false);
        assert.equal(serializedResult.includes(OLD_PASSWORD), false);
        assert.equal(serializedResult.includes(NEW_PASSWORD), false);
        assert.equal(serializedResult.includes("MUST_NOT_BE_ACCEPTED"), false);
        assert.equal(serializedResult.includes("tokenHash"), false);

        const savedUser =
          await transaction.adminUser.findUniqueOrThrow({
            where: {
              id: user.id,
            },
          });

        assert.equal(savedUser.role, AdminRole.OWNER);
        assert.equal(savedUser.status, AdminStatus.ACTIVE);
        assert.equal(savedUser.failedLoginAttempts, 0);
        assert.equal(savedUser.lockedUntil, null);
        assert.equal(
          savedUser.passwordChangedAt.getTime(),
          TEST_NOW.getTime(),
        );
        assert.equal(
          await verifyPassword(OLD_PASSWORD, savedUser.passwordHash),
          false,
        );
        assert.equal(
          await verifyPassword(NEW_PASSWORD, savedUser.passwordHash),
          true,
        );

        const storedSessions =
          await transaction.adminSession.findMany({
            where: {
              id: {
                in: sessions.map((session) => session.id),
              },
            },
            orderBy: {
              tokenHash: "asc",
            },
          });

        assert.equal(storedSessions.length, 3);
        assert.equal(
          storedSessions[0]?.revokedAt?.getTime(),
          TEST_NOW.getTime(),
        );
        assert.equal(
          storedSessions[1]?.revokedAt?.getTime(),
          TEST_NOW.getTime(),
        );
        assert.equal(
          storedSessions[2]?.revokedAt?.getTime(),
          EXISTING_REVOKED_AT.getTime(),
        );

        throw forcedRollbackError;
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 30_000,
      },
    ),
    (error: unknown) => error === forcedRollbackError,
  );

  const after = await databaseCounts();

  assert.deepEqual(after, before);

  console.log(
    `AdminUser rows before/after rollback: ${before.adminUsers}/${after.adminUsers}`,
  );
  console.log(
    `AdminSession rows before/after rollback: ${before.adminSessions}/${after.adminSessions}`,
  );
  console.log(
    `business rows before/after rollback: ${before.businessRows}/${after.businessRows}`,
  );
  console.log("invalid input rejected before writes: yes");
  console.log("missing administrator rejected: yes");
  console.log("display-name password blocked after account lookup: yes");
  console.log("temporary password changed and Argon2id verified: yes");
  console.log("failed attempts and lock cleared: yes");
  console.log("unrevoked temporary sessions revoked: 2");
  console.log("already-revoked session timestamp preserved: yes");
  console.log("safe result contains password/hash/token/id: no");
  console.log("transaction committed: no");
  console.log("database state restored: yes");
} finally {
  await prisma.$disconnect();
}
