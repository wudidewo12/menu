import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

import dotenv from "dotenv";

import {
  OwnerBootstrapPlanError,
} from "../src/server/auth/owner-bootstrap-plan.ts";
import {
  OwnerPasswordConfirmationMismatchError,
  initialOwnerCommitConfirmation,
  runInitialOwnerCommit,
  type InitialOwnerCommitInput,
  type InitialOwnerPublicResult,
  type OwnerBootstrapPreviewIO,
} from "../src/server/auth/owner-bootstrap-preview.ts";

const TEST_PASSWORD = "Fixed Confirmed OWNER Commit Test Only 2026!";
const TEST_EMAIL = "confirmed.owner@example.invalid";
const TEST_DISPLAY_NAME = "确认创建测试管理员";

class SimulatedCommitIO implements OwnerBootstrapPreviewIO {
  readonly output: string[] = [];
  readonly visiblePrompts: string[] = [];
  readonly hiddenPrompts: string[] = [];

  constructor(
    private readonly visibleAnswers: string[],
    private readonly hiddenAnswers: string[],
  ) {}

  async readVisible(prompt: string): Promise<string> {
    this.visiblePrompts.push(prompt);
    return this.visibleAnswers.shift() ?? "";
  }

  async readHidden(prompt: string): Promise<string> {
    this.hiddenPrompts.push(prompt);
    return this.hiddenAnswers.shift() ?? "";
  }

  writeLine(line: string): void {
    this.output.push(line);
  }
}

function simulatedInput(confirmation: string) {
  return new SimulatedCommitIO(
    [
      `  ${TEST_EMAIL.toUpperCase()}  `,
      `  ${TEST_DISPLAY_NAME}  `,
      confirmation,
    ],
    [TEST_PASSWORD, TEST_PASSWORD],
  );
}

function fakeOwner(
  input: InitialOwnerCommitInput,
): InitialOwnerPublicResult {
  return {
    created: true,
    user: {
      id: "owner-test-id",
      email: input.email,
      displayName: input.displayName,
      role: "OWNER",
      status: "ACTIVE",
      passwordChangedAt: new Date("2026-07-24T00:00:00.000Z"),
      createdAt: new Date("2026-07-24T00:00:00.000Z"),
    },
  };
}

let cancellationCalls = 0;
const cancellationIO = simulatedInput("CANCEL");
const cancellation = await runInitialOwnerCommit(
  cancellationIO,
  async (input) => {
    cancellationCalls += 1;
    return fakeOwner(input);
  },
);
const cancellationOutput = cancellationIO.output.join("\n");

assert.equal(cancellation.committed, false);
assert.equal(cancellationCalls, 0);
assert.match(cancellationOutput, /数据库写入：0/);
assert.match(cancellationOutput, /已取消/);
assert.equal(cancellationOutput.includes(TEST_PASSWORD), false);
assert.equal(cancellationOutput.includes("passwordHash"), false);

let creationCalls = 0;
let receivedPassword = "";
const exactConfirmation =
  `CREATE OWNER ${TEST_EMAIL}`;
const successIO = simulatedInput(exactConfirmation);
const success = await runInitialOwnerCommit(
  successIO,
  async (input) => {
    creationCalls += 1;
    receivedPassword = input.password;
    return fakeOwner(input);
  },
);
const successOutput = successIO.output.join("\n");

assert.equal(success.committed, true);
assert.equal(creationCalls, 1);
assert.equal(receivedPassword, TEST_PASSWORD);
receivedPassword = "";
assert.equal(success.plan.email, TEST_EMAIL);
assert.equal(
  initialOwnerCommitConfirmation(success.plan),
  exactConfirmation,
);
assert.match(successOutput, /首次 OWNER 初始化安全预览/);
assert.match(successOutput, /首次 OWNER 创建成功/);
assert.match(successOutput, /数据库写入：1/);
assert.equal(successOutput.includes(TEST_PASSWORD), false);
assert.equal(successOutput.includes("passwordHash"), false);
assert.equal(JSON.stringify(success).includes(TEST_PASSWORD), false);

let mismatchCalls = 0;
const mismatchIO = new SimulatedCommitIO(
  [TEST_EMAIL, TEST_DISPLAY_NAME],
  [TEST_PASSWORD, "Different Confirmation Password 2026!"],
);

await assert.rejects(
  runInitialOwnerCommit(mismatchIO, async (input) => {
    mismatchCalls += 1;
    return fakeOwner(input);
  }),
  (error: unknown) =>
    error instanceof OwnerPasswordConfirmationMismatchError,
);
assert.equal(mismatchCalls, 0);
assert.equal(mismatchIO.output.length, 0);

let invalidCalls = 0;
const invalidIO = new SimulatedCommitIO(
  ["invalid-email", TEST_DISPLAY_NAME],
  [TEST_PASSWORD, TEST_PASSWORD],
);

await assert.rejects(
  runInitialOwnerCommit(invalidIO, async (input) => {
    invalidCalls += 1;
    return fakeOwner(input);
  }),
  (error: unknown) => error instanceof OwnerBootstrapPlanError,
);
assert.equal(invalidCalls, 0);
assert.equal(invalidIO.output.length, 0);

const ARGUMENT_TEST_SECRET = "Fixed-Argument-Secret-Must-Not-Echo";
const argumentResult = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--conditions=react-server",
    "tools/commit-owner-bootstrap.mts",
    "--commit",
    ARGUMENT_TEST_SECRET,
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8",
  },
);
const argumentOutput = `${argumentResult.stdout}${argumentResult.stderr}`;

assert.equal(argumentResult.status, 1);
assert.match(argumentOutput, /只接受固定的 --commit 标记/);
assert.equal(argumentOutput.includes(ARGUMENT_TEST_SECRET), false);

const nonInteractiveResult = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--conditions=react-server",
    "tools/commit-owner-bootstrap.mts",
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
assert.match(nonInteractiveOutput, /必须在交互式终端中运行/);

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

const [{ createInitialOwner }, { prisma }] = await Promise.all([
  import("../src/server/auth/owner-bootstrap.ts"),
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

const forcedRollbackError =
  new Error("FORCED_CONFIRMED_OWNER_COMMIT_ROLLBACK");

try {
  const before = await databaseCounts();

  assert.deepEqual(before, {
    adminUsers: 0,
    adminSessions: 0,
    businessRows: 237,
  });

  const rollbackIO = simulatedInput(exactConfirmation);

  await assert.rejects(
    runInitialOwnerCommit(rollbackIO, async (input) =>
      createInitialOwner(input, {
        beforeCommit() {
          throw forcedRollbackError;
        },
      }),
    ),
    (error: unknown) => error === forcedRollbackError,
  );

  const rollbackOutput = rollbackIO.output.join("\n");

  assert.match(rollbackOutput, /首次 OWNER 初始化安全预览/);
  assert.doesNotMatch(rollbackOutput, /首次 OWNER 创建成功/);
  assert.equal(rollbackOutput.includes(TEST_PASSWORD), false);
  const after = await databaseCounts();

  assert.deepEqual(after, before);

  console.log("commit command confirmation: exact phrase required");
  console.log("cancellation database callback calls: 0");
  console.log("invalid/mismatched input database callback calls: 0");
  console.log("exact confirmation callback calls: 1");
  console.log("password/argument secret echoed: no");
  console.log("non-interactive input: rejected");
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
