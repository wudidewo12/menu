import assert from "node:assert/strict";
import fs from "node:fs";

import dotenv from "dotenv";
import { Client } from "pg";

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
    INITIAL_OWNER_ADVISORY_LOCK,
    InitialOwnerAlreadyExistsError,
    assertInitialOwnerBootstrapAvailable,
    createInitialOwner,
  },
  { verifyPassword },
  { OwnerBootstrapPlanError },
  { prisma },
] = await Promise.all([
  import("../src/server/auth/owner-bootstrap.ts"),
  import("../src/server/auth/password.ts"),
  import("../src/server/auth/owner-bootstrap-plan.ts"),
  import("../src/server/db/prisma.ts"),
]);

const TEST_PASSWORD = "Fixed Database OWNER Rollback Test Only 2026!";
const TEST_INPUT = Object.freeze({
  email: "  database.owner.rollback@example.invalid  ",
  displayName: "  数据库   回滚管理员  ",
  password: TEST_PASSWORD,
});
const forcedRollbackError = new Error("FORCED_OWNER_BOOTSTRAP_ROLLBACK");

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

async function checkConcurrentLock() {
  const firstClient = new Client({ connectionString: databaseUrl });
  const contenderClient = new Client({ connectionString: databaseUrl });

  await Promise.all([firstClient.connect(), contenderClient.connect()]);

  try {
    await Promise.all([
      firstClient.query("BEGIN"),
      contenderClient.query("BEGIN"),
    ]);
    await firstClient.query(
      "SELECT pg_advisory_xact_lock($1, $2)",
      [
        INITIAL_OWNER_ADVISORY_LOCK.namespace,
        INITIAL_OWNER_ADVISORY_LOCK.key,
      ],
    );
    const contenderResult = await contenderClient.query<{
      acquired: boolean;
    }>(
      "SELECT pg_try_advisory_xact_lock($1, $2) AS acquired",
      [
        INITIAL_OWNER_ADVISORY_LOCK.namespace,
        INITIAL_OWNER_ADVISORY_LOCK.key,
      ],
    );

    assert.equal(contenderResult.rows[0]?.acquired, false);
  } finally {
    await Promise.allSettled([
      firstClient.query("ROLLBACK"),
      contenderClient.query("ROLLBACK"),
    ]);
    await Promise.allSettled([
      firstClient.end(),
      contenderClient.end(),
    ]);
  }
}

try {
  const before = await databaseCounts();

  assert.deepEqual(before, {
    adminUsers: 0,
    adminSessions: 0,
    businessRows: 237,
  });

  await assert.rejects(
    createInitialOwner({}),
    (error: unknown) => error instanceof OwnerBootstrapPlanError,
  );
  assert.deepEqual(await databaseCounts(), before);

  await checkConcurrentLock();
  assert.deepEqual(await databaseCounts(), before);

  await assert.rejects(
    createInitialOwner(TEST_INPUT, {
      async beforeCommit(result, transaction) {
        assert.equal(result.created, true);
        assert.equal(result.user.email, "database.owner.rollback@example.invalid");
        assert.equal(result.user.displayName, "数据库 回滚管理员");
        assert.equal(result.user.role, "OWNER");
        assert.equal(result.user.status, "ACTIVE");
        assert.equal("passwordHash" in result.user, false);
        assert.equal(JSON.stringify(result).includes(TEST_PASSWORD), false);

        const savedUser = await transaction.adminUser.findUnique({
          where: {
            id: result.user.id,
          },
        });

        assert.ok(savedUser);
        assert.equal(savedUser.role, "OWNER");
        assert.equal(savedUser.status, "ACTIVE");
        assert.equal(savedUser.failedLoginAttempts, 0);
        assert.equal(savedUser.lockedUntil, null);
        assert.equal(savedUser.lastLoginAt, null);
        assert.equal(
          await verifyPassword(TEST_PASSWORD, savedUser.passwordHash),
          true,
        );
        await assert.rejects(
          assertInitialOwnerBootstrapAvailable(transaction),
          (error: unknown) =>
            error instanceof InitialOwnerAlreadyExistsError,
        );

        throw forcedRollbackError;
      },
    }),
    (error: unknown) => error === forcedRollbackError,
  );

  const after = await databaseCounts();

  assert.deepEqual(after, before);

  console.log(`AdminUser rows before/after: ${before.adminUsers}/${after.adminUsers}`);
  console.log(
    `AdminSession rows before/after: ${before.adminSessions}/${after.adminSessions}`,
  );
  console.log(
    `business rows before/after: ${before.businessRows}/${after.businessRows}`,
  );
  console.log("invalid input rejected before writes: yes");
  console.log("concurrent lock contender entered: no");
  console.log("temporary OWNER role/status: OWNER/ACTIVE");
  console.log("temporary password hash verified: yes");
  console.log("safe result contains password/hash: no");
  console.log("already-initialized guard: passed");
  console.log("transaction committed: no");
  console.log("database state restored: yes");
} finally {
  await prisma.$disconnect();
}
