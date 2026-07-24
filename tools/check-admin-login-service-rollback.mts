import assert from "node:assert/strict";
import fs from "node:fs";

import dotenv from "dotenv";

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
    ADMIN_LOGIN_SETTINGS,
    AdminLoginRejectedError,
    loginAdmin,
    loginAdminInTransaction,
  },
  {
    prepareAdminLoginInput,
  },
  { hashPassword },
  { hashSessionToken },
  {
    AdminRole,
    AdminStatus,
  },
  { Prisma },
  { prisma },
] = await Promise.all([
  import("../src/server/auth/admin-login.ts"),
  import("../src/server/auth/login-input.ts"),
  import("../src/server/auth/password.ts"),
  import("../src/server/auth/session-token.ts"),
  import("../src/generated/prisma/enums.ts"),
  import("../src/generated/prisma/client.ts"),
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

const TEST_EMAIL = "login.rollback@example.invalid";
const TEST_PASSWORD =
  "Fixed Admin Login Rollback Test Only 2026!";
const WRONG_PASSWORD =
  "Fixed Wrong Admin Login Test Only 2026!";
const BASE_TIME = new Date("2026-07-24T10:00:00.000Z");
const forcedRollbackError =
  new Error("FORCED_ADMIN_LOGIN_SERVICE_ROLLBACK");

function minutesAfterBase(minutes: number): Date {
  return new Date(BASE_TIME.getTime() + minutes * 60 * 1_000);
}

try {
  const before = await databaseCounts();

  assert.deepEqual(before, {
    adminUsers: 0,
    adminSessions: 0,
    businessRows: 237,
  });

  await assert.rejects(
    loginAdmin({
      email: "unknown.admin@example.invalid",
      password: WRONG_PASSWORD,
    }),
    (error: unknown) =>
      error instanceof AdminLoginRejectedError &&
      error.code === "ADMIN_LOGIN_REJECTED" &&
      error.message === "邮箱或密码不正确，或账号当前不可用",
  );
  assert.deepEqual(await databaseCounts(), before);

  const passwordHash = await hashPassword(TEST_PASSWORD);
  const correctCredentials = prepareAdminLoginInput({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  const wrongCredentials = prepareAdminLoginInput({
    email: TEST_EMAIL,
    password: WRONG_PASSWORD,
  });

  await assert.rejects(
    prisma.$transaction(
      async (transaction) => {
        const user = await transaction.adminUser.create({
          data: {
            email: TEST_EMAIL,
            displayName: "登录回滚测试管理员",
            passwordHash,
            role: AdminRole.OWNER,
            status: AdminStatus.ACTIVE,
          },
        });

        const unknownAttempt = await loginAdminInTransaction(
          transaction,
          prepareAdminLoginInput({
            email: "unknown.admin@example.invalid",
            password: WRONG_PASSWORD,
          }),
          BASE_TIME,
        );

        assert.deepEqual(unknownAttempt, {
          authenticated: false,
        });

        for (
          let attemptNumber = 1;
          attemptNumber <
          ADMIN_LOGIN_SETTINGS.maximumFailedAttempts;
          attemptNumber += 1
        ) {
          const attempt = await loginAdminInTransaction(
            transaction,
            wrongCredentials,
            minutesAfterBase(attemptNumber - 1),
          );
          const updatedUser =
            await transaction.adminUser.findUniqueOrThrow({
              where: {
                id: user.id,
              },
            });

          assert.deepEqual(attempt, {
            authenticated: false,
          });
          assert.equal(
            updatedUser.failedLoginAttempts,
            attemptNumber,
          );
          assert.equal(updatedUser.lockedUntil, null);
          assert.equal(
            await transaction.adminSession.count(),
            0,
          );
        }

        const fifthAttemptTime = minutesAfterBase(4);
        const fifthAttempt = await loginAdminInTransaction(
          transaction,
          wrongCredentials,
          fifthAttemptTime,
        );
        const lockedUser =
          await transaction.adminUser.findUniqueOrThrow({
            where: {
              id: user.id,
            },
          });
        const expectedLockedUntil = new Date(
          fifthAttemptTime.getTime() +
            ADMIN_LOGIN_SETTINGS.lockDurationMs,
        );

        assert.deepEqual(fifthAttempt, {
          authenticated: false,
        });
        assert.equal(
          lockedUser.failedLoginAttempts,
          ADMIN_LOGIN_SETTINGS.maximumFailedAttempts,
        );
        assert.equal(
          lockedUser.lockedUntil?.getTime(),
          expectedLockedUntil.getTime(),
        );

        const correctDuringLock = await loginAdminInTransaction(
          transaction,
          correctCredentials,
          minutesAfterBase(5),
        );
        const wrongDuringLock = await loginAdminInTransaction(
          transaction,
          wrongCredentials,
          minutesAfterBase(6),
        );
        const stillLocked =
          await transaction.adminUser.findUniqueOrThrow({
            where: {
              id: user.id,
            },
          });

        assert.deepEqual(correctDuringLock, {
          authenticated: false,
        });
        assert.deepEqual(wrongDuringLock, {
          authenticated: false,
        });
        assert.equal(
          stillLocked.failedLoginAttempts,
          ADMIN_LOGIN_SETTINGS.maximumFailedAttempts,
        );
        assert.equal(
          stillLocked.lockedUntil?.getTime(),
          expectedLockedUntil.getTime(),
        );
        assert.equal(await transaction.adminSession.count(), 0);

        const wrongAfterLock = await loginAdminInTransaction(
          transaction,
          wrongCredentials,
          expectedLockedUntil,
        );
        const resetAttemptUser =
          await transaction.adminUser.findUniqueOrThrow({
            where: {
              id: user.id,
            },
          });

        assert.deepEqual(wrongAfterLock, {
          authenticated: false,
        });
        assert.equal(resetAttemptUser.failedLoginAttempts, 1);
        assert.equal(resetAttemptUser.lockedUntil, null);

        const successfulLoginTime = new Date(
          expectedLockedUntil.getTime() + 60 * 1_000,
        );
        const successful = await loginAdminInTransaction(
          transaction,
          correctCredentials,
          successfulLoginTime,
        );

        assert.equal(successful.authenticated, true);

        if (!successful.authenticated) {
          throw new Error("Expected successful login");
        }

        assert.equal(successful.user.id, user.id);
        assert.equal(successful.user.email, TEST_EMAIL);
        assert.equal(successful.user.role, AdminRole.OWNER);
        assert.equal(successful.user.status, "ACTIVE");
        assert.equal("passwordHash" in successful.user, false);
        assert.equal("tokenHash" in successful.session, false);
        assert.equal(
          JSON.stringify(successful.user).includes(TEST_PASSWORD),
          false,
        );
        assert.equal(
          JSON.stringify(successful.session).includes(successful.token),
          false,
        );

        const successfulUser =
          await transaction.adminUser.findUniqueOrThrow({
            where: {
              id: user.id,
            },
          });
        const storedSession =
          await transaction.adminSession.findUniqueOrThrow({
            where: {
              id: successful.session.id,
            },
          });

        assert.equal(successfulUser.failedLoginAttempts, 0);
        assert.equal(successfulUser.lockedUntil, null);
        assert.equal(
          successfulUser.lastLoginAt?.getTime(),
          successfulLoginTime.getTime(),
        );
        assert.equal(
          storedSession.tokenHash,
          hashSessionToken(successful.token),
        );
        assert.equal(
          JSON.stringify(storedSession).includes(successful.token),
          false,
        );

        await transaction.adminUser.update({
          where: {
            id: user.id,
          },
          data: {
            status: AdminStatus.DISABLED,
          },
        });

        const disabledAttempt = await loginAdminInTransaction(
          transaction,
          correctCredentials,
          new Date(successfulLoginTime.getTime() + 60 * 1_000),
        );

        assert.deepEqual(disabledAttempt, {
          authenticated: false,
        });
        assert.equal(await transaction.adminSession.count(), 1);

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

  console.log("transactional admin login service: passed");
  console.log(
    `lock threshold: ${ADMIN_LOGIN_SETTINGS.maximumFailedAttempts} failures`,
  );
  console.log(
    `lock duration: ${ADMIN_LOGIN_SETTINGS.lockDurationMinutes} minutes`,
  );
  console.log("unknown/wrong/disabled/locked public result: identical");
  console.log("failed-attempt persistence: passed");
  console.log("expired lock counter reset: passed");
  console.log("successful login counter reset: passed");
  console.log("successful session creation: passed");
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
  console.log("transaction committed: no");
} finally {
  await prisma.$disconnect();
}
