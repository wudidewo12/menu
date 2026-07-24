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
    ADMIN_SESSION_SETTINGS,
    AdminSessionUserUnavailableError,
    InvalidAdminSessionUserIdError,
    createAdminSessionInTransaction,
    findActiveAdminSession,
    revokeAdminSession,
  },
  {
    createSessionToken,
    hashSessionToken,
  },
  {
    AdminRole,
    AdminStatus,
  },
  { Prisma },
  { prisma },
] = await Promise.all([
  import("../src/server/auth/admin-session.ts"),
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

const TEST_NOW = new Date("2026-07-24T10:00:00.000Z");
const REVOKED_AT = new Date("2026-07-24T11:00:00.000Z");
const TEST_ONLY_PASSWORD_HASH =
  "test-only-session-service-row-not-a-real-password-hash";
const forcedRollbackError =
  new Error("FORCED_ADMIN_SESSION_SERVICE_ROLLBACK");

try {
  const before = await databaseCounts();

  assert.deepEqual(before, {
    adminUsers: 0,
    adminSessions: 0,
    businessRows: 237,
  });

  await assert.rejects(
    createAdminSessionInTransaction(
      {} as Prisma.TransactionClient,
      "not-a-uuid",
      TEST_NOW,
    ),
    (error: unknown) =>
      error instanceof InvalidAdminSessionUserIdError,
  );

  await assert.rejects(
    prisma.$transaction(
      async (transaction) => {
        const user = await transaction.adminUser.create({
          data: {
            email: "session.rollback@example.invalid",
            displayName: "会话回滚测试管理员",
            passwordHash: TEST_ONLY_PASSWORD_HASH,
            role: AdminRole.OWNER,
            status: AdminStatus.ACTIVE,
          },
          select: {
            id: true,
          },
        });
        const created = await createAdminSessionInTransaction(
          transaction,
          user.id,
          TEST_NOW,
        );
        const expectedExpiresAt = new Date(
          TEST_NOW.getTime() +
            ADMIN_SESSION_SETTINGS.absoluteLifetimeMs,
        );

        assert.equal(
          ADMIN_SESSION_SETTINGS.absoluteLifetimeHours,
          8,
        );
        assert.equal(
          created.session.expiresAt.getTime(),
          expectedExpiresAt.getTime(),
        );
        assert.equal(
          created.session.lastSeenAt.getTime(),
          TEST_NOW.getTime(),
        );
        assert.equal("tokenHash" in created.session, false);
        assert.equal(
          JSON.stringify(created.session).includes(created.token),
          false,
        );

        const storedSession =
          await transaction.adminSession.findUniqueOrThrow({
            where: {
              id: created.session.id,
            },
          });

        assert.equal(
          storedSession.tokenHash,
          hashSessionToken(created.token),
        );
        assert.equal(
          JSON.stringify(storedSession).includes(created.token),
          false,
        );

        const active = await findActiveAdminSession(created.token, {
          database: transaction,
          now: TEST_NOW,
        });

        assert.ok(active);
        assert.equal(active.id, created.session.id);
        assert.equal(active.user.id, user.id);
        assert.equal(
          active.user.email,
          "session.rollback@example.invalid",
        );
        assert.equal(active.user.role, AdminRole.OWNER);
        assert.equal(active.user.status, "ACTIVE");
        assert.equal("tokenHash" in active, false);
        assert.equal(JSON.stringify(active).includes(created.token), false);

        assert.equal(
          await findActiveAdminSession("invalid-token", {
            database: transaction,
            now: TEST_NOW,
          }),
          null,
        );
        assert.equal(
          await findActiveAdminSession(
            createSessionToken().token,
            {
              database: transaction,
              now: TEST_NOW,
            },
          ),
          null,
        );
        assert.ok(
          await findActiveAdminSession(created.token, {
            database: transaction,
            now: new Date(expectedExpiresAt.getTime() - 1),
          }),
        );
        assert.equal(
          await findActiveAdminSession(created.token, {
            database: transaction,
            now: expectedExpiresAt,
          }),
          null,
        );

        assert.equal(
          await revokeAdminSession(created.token, {
            database: transaction,
            now: REVOKED_AT,
          }),
          true,
        );
        assert.equal(
          await revokeAdminSession(created.token, {
            database: transaction,
            now: REVOKED_AT,
          }),
          false,
        );
        assert.equal(
          await revokeAdminSession("invalid-token", {
            database: transaction,
            now: REVOKED_AT,
          }),
          false,
        );
        assert.equal(
          await findActiveAdminSession(created.token, {
            database: transaction,
            now: REVOKED_AT,
          }),
          null,
        );

        const revokedSession =
          await transaction.adminSession.findUniqueOrThrow({
            where: {
              id: created.session.id,
            },
          });

        assert.equal(
          revokedSession.revokedAt?.getTime(),
          REVOKED_AT.getTime(),
        );

        const disabledSession =
          await createAdminSessionInTransaction(
            transaction,
            user.id,
            TEST_NOW,
          );

        await transaction.adminUser.update({
          where: {
            id: user.id,
          },
          data: {
            status: AdminStatus.DISABLED,
          },
        });

        assert.equal(
          await findActiveAdminSession(disabledSession.token, {
            database: transaction,
            now: TEST_NOW,
          }),
          null,
        );
        await assert.rejects(
          createAdminSessionInTransaction(
            transaction,
            user.id,
            TEST_NOW,
          ),
          (error: unknown) =>
            error instanceof AdminSessionUserUnavailableError,
        );

        await transaction.adminUser.update({
          where: {
            id: user.id,
          },
          data: {
            status: AdminStatus.ACTIVE,
            lockedUntil: new Date(
              TEST_NOW.getTime() + 60 * 60 * 1_000,
            ),
          },
        });

        assert.equal(
          await findActiveAdminSession(disabledSession.token, {
            database: transaction,
            now: TEST_NOW,
          }),
          null,
        );
        await assert.rejects(
          createAdminSessionInTransaction(
            transaction,
            user.id,
            TEST_NOW,
          ),
          (error: unknown) =>
            error instanceof AdminSessionUserUnavailableError,
        );

        await transaction.adminUser.update({
          where: {
            id: user.id,
          },
          data: {
            lockedUntil: TEST_NOW,
          },
        });

        assert.ok(
          await findActiveAdminSession(disabledSession.token, {
            database: transaction,
            now: TEST_NOW,
          }),
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

  console.log("AdminSession service: passed");
  console.log(
    `absolute lifetime: ${ADMIN_SESSION_SETTINGS.absoluteLifetimeHours} hours`,
  );
  console.log("active session lookup: passed");
  console.log("expired session lookup: rejected");
  console.log("revoked session lookup: rejected");
  console.log("disabled user session lookup/create: rejected");
  console.log("locked user session lookup/create: rejected");
  console.log("expired account lock: accepted");
  console.log("invalid/unknown token lookup: rejected");
  console.log("raw token stored in database: no");
  console.log("raw token/hash printed: 0");
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
