import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

import dotenv from "dotenv";

import {
  AdminPasswordConfirmationMismatchError,
  runAdminPasswordResetCommit,
  type AdminPasswordResetCommitInput,
  type AdminPasswordResetPreviewIO,
  type AdminPasswordResetPublicResult,
} from "../src/server/auth/admin-password-reset-preview.ts";

const TEST_EMAIL = "password.reset.command@example.invalid";
const OLD_PASSWORD = "Old Reset Command Rollback Test 2026!";
const NEW_PASSWORD = "New Reset Command Rollback Test 2026!";
const TEST_NOW = new Date("2026-07-31T04:00:00.000Z");
const forcedRollbackError =
  new Error("FORCED_ADMIN_PASSWORD_RESET_COMMAND_ROLLBACK");

class SimulatedCommandIO implements AdminPasswordResetPreviewIO {
  readonly output: string[] = [];

  constructor(
    private readonly visibleAnswers: string[],
    private readonly hiddenAnswers: string[],
  ) {}

  async readVisible(): Promise<string> {
    return this.visibleAnswers.shift() ?? "";
  }

  async readHidden(): Promise<string> {
    return this.hiddenAnswers.shift() ?? "";
  }

  writeLine(line: string): void {
    this.output.push(line);
  }
}

function simulatedInput(
  confirmation: string,
  password = NEW_PASSWORD,
) {
  return new SimulatedCommandIO(
    [
      `  ${TEST_EMAIL.toUpperCase()}  `,
      confirmation,
    ],
    [password, password],
  );
}

function fakeReset(
  input: AdminPasswordResetCommitInput,
): AdminPasswordResetPublicResult {
  return {
    reset: true,
    user: {
      email: input.email,
      displayName: "密码重置正式命令测试管理员",
      role: "OWNER",
      status: "ACTIVE",
      passwordChangedAt: TEST_NOW,
      updatedAt: TEST_NOW,
    },
    password: {
      storedAs: "ARGON2ID_HASH_ONLY",
    },
    sessionsRevoked: 0,
  };
}

let cancellationCalls = 0;
const cancellationIO = simulatedInput("CANCEL");
const cancellation = await runAdminPasswordResetCommit(
  cancellationIO,
  async (input) => {
    cancellationCalls += 1;
    return fakeReset(input);
  },
);

assert.equal(cancellation.committed, false);
assert.equal(cancellationCalls, 0);
assert.equal(
  cancellationIO.output.join("\n").includes(NEW_PASSWORD),
  false,
);

let mismatchCalls = 0;
const mismatchIO = new SimulatedCommandIO(
  [TEST_EMAIL],
  [NEW_PASSWORD, "Different Reset Command Password 2026!"],
);

await assert.rejects(
  runAdminPasswordResetCommit(mismatchIO, async (input) => {
    mismatchCalls += 1;
    return fakeReset(input);
  }),
  (error: unknown) =>
    error instanceof AdminPasswordConfirmationMismatchError,
);
assert.equal(mismatchCalls, 0);
assert.equal(mismatchIO.output.length, 0);

const ARGUMENT_TEST_SECRET =
  "Fixed-Reset-Argument-Secret-Must-Not-Echo";
const argumentResult = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--conditions=react-server",
    "tools/reset-admin-password.mts",
    "--commit",
    ARGUMENT_TEST_SECRET,
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8",
  },
);
const argumentOutput =
  `${argumentResult.stdout}${argumentResult.stderr}`;

assert.equal(argumentResult.status, 1);
assert.match(
  argumentOutput,
  /需要且只接受固定的 --commit 标记/,
);
assert.equal(argumentOutput.includes(ARGUMENT_TEST_SECRET), false);

const nonInteractiveResult = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--conditions=react-server",
    "tools/reset-admin-password.mts",
    "--commit",
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8",
  },
);
const nonInteractiveOutput =
  `${nonInteractiveResult.stdout}${nonInteractiveResult.stderr}`;

assert.equal(nonInteractiveResult.status, 1);
assert.match(
  nonInteractiveOutput,
  /必须在交互式终端中运行/,
);

const packageFile = JSON.parse(
  fs.readFileSync("package.json", "utf8"),
) as {
  scripts: Record<string, string>;
};

assert.equal(
  packageFile.scripts["auth:reset-password"],
  "tsx --conditions=react-server tools/reset-admin-password.mts --commit",
);

const commandSource = fs.readFileSync(
  "tools/reset-admin-password.mts",
  "utf8",
);

assert.doesNotMatch(
  commandSource,
  /from\s+["'][^"']*admin-password-reset\.ts["']/,
);
assert.match(
  commandSource,
  /import\(["']\.\.\/src\/server\/auth\/admin-password-reset\.ts["']\)/,
);
assert.doesNotMatch(
  commandSource,
  /process\.env\.(?:OWNER_PASSWORD|ADMIN_PASSWORD)\s*=/,
);

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
delete process.env.ADMIN_PASSWORD;

const [
  {
    resetAdminPasswordInTransaction,
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
  import("../src/server/auth/password.ts"),
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

try {
  const before = await databaseCounts();

  assert.equal(before.businessRows, 237);
  assert.ok(before.adminUsers >= 1);
  assert.ok(before.adminSessions >= 0);

  const exactConfirmation =
    `RESET PASSWORD ${TEST_EMAIL}`;
  const rollbackIO = simulatedInput(exactConfirmation);

  await assert.rejects(
    runAdminPasswordResetCommit(
      rollbackIO,
      async (input) =>
        prisma.$transaction(
          async (transaction) => {
            const oldPasswordHash =
              await hashPassword(OLD_PASSWORD);
            const user = await transaction.adminUser.create({
              data: {
                email: TEST_EMAIL,
                displayName: "Password Reset Command Test Administrator",
                passwordHash: oldPasswordHash,
                role: AdminRole.EDITOR,
                status: AdminStatus.ACTIVE,
                failedLoginAttempts: 3,
                lockedUntil:
                  new Date("2026-08-01T04:00:00.000Z"),
              },
              select: {
                id: true,
              },
            });

            await transaction.adminSession.create({
              data: {
                userId: user.id,
                tokenHash: "4".repeat(64),
                expiresAt:
                  new Date("2026-08-01T04:00:00.000Z"),
              },
            });

            const result =
              await resetAdminPasswordInTransaction(
                transaction,
                input,
                {
                  now: TEST_NOW,
                },
              );
            const savedUser =
              await transaction.adminUser.findUniqueOrThrow({
                where: {
                  id: user.id,
                },
              });

            assert.equal(result.user.role, "EDITOR");
            assert.equal(result.user.status, "ACTIVE");
            assert.equal(result.sessionsRevoked, 1);
            assert.equal(savedUser.failedLoginAttempts, 0);
            assert.equal(savedUser.lockedUntil, null);
            assert.equal(
              await verifyPassword(
                OLD_PASSWORD,
                savedUser.passwordHash,
              ),
              false,
            );
            assert.equal(
              await verifyPassword(
                NEW_PASSWORD,
                savedUser.passwordHash,
              ),
              true,
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
    ),
    (error: unknown) => error === forcedRollbackError,
  );

  const rollbackOutput = rollbackIO.output.join("\n");

  assert.match(
    rollbackOutput,
    /管理员密码重置安全预览/,
  );
  assert.doesNotMatch(
    rollbackOutput,
    /管理员密码重置成功/,
  );
  assert.equal(rollbackOutput.includes(NEW_PASSWORD), false);
  assert.equal(rollbackOutput.includes(OLD_PASSWORD), false);

  const after = await databaseCounts();

  assert.deepEqual(after, before);

  console.log(
    "formal reset command confirmation: exact phrase required",
  );
  console.log("cancellation database callback calls: 0");
  console.log("mismatched password database callback calls: 0");
  console.log("argument secret echoed: no");
  console.log("non-interactive input: rejected");
  console.log("database import before exact confirmation: no");
  console.log("temporary password reset verified: yes");
  console.log("temporary session revoked: yes");
  console.log(
    `AdminUser rows before/after rollback: ${before.adminUsers}/${after.adminUsers}`,
  );
  console.log(
    `AdminSession rows before/after rollback: ${before.adminSessions}/${after.adminSessions}`,
  );
  console.log(
    `business rows before/after rollback: ${before.businessRows}/${after.businessRows}`,
  );
  console.log("real database transaction committed: no");
} finally {
  await prisma.$disconnect();
}
