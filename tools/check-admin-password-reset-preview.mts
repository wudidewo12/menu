import assert from "node:assert/strict";
import fs from "node:fs";
import { PassThrough, Writable } from "node:stream";

import {
  AdminPasswordResetPlanError,
} from "../src/server/auth/admin-password-reset-plan.ts";
import {
  AdminPasswordConfirmationMismatchError,
  adminPasswordResetConfirmation,
  runAdminPasswordResetCommit,
  runAdminPasswordResetPreview,
  type AdminPasswordResetCommitInput,
  type AdminPasswordResetPreviewIO,
  type AdminPasswordResetPublicResult,
} from "../src/server/auth/admin-password-reset-preview.ts";
import {
  InteractiveTerminalRequiredError,
  TerminalHiddenInput,
} from "./terminal-hidden-input.mts";

const TEST_EMAIL = "reset.preview@example.invalid";
const TEST_PASSWORD = "Hidden Reset Preview Test Only 2026!";
const WRONG_PASSWORD = "Different Hidden Reset Test Only 2026!";

class SimulatedResetIO implements AdminPasswordResetPreviewIO {
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

class SimulatedTerminalInput extends PassThrough {
  readonly isTTY = true;
  isRaw = false;

  setRawMode(mode: boolean) {
    this.isRaw = mode;
    return this;
  }
}

class CapturedTerminalOutput extends Writable {
  readonly isTTY = true;
  private readonly chunks: Buffer[] = [];

  _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding),
    );
    callback();
  }

  text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function simulatedInput(confirmation?: string) {
  return new SimulatedResetIO(
    [
      `  ${TEST_EMAIL.toUpperCase()}  `,
      ...(confirmation === undefined ? [] : [confirmation]),
    ],
    [TEST_PASSWORD, TEST_PASSWORD],
  );
}

function fakeReset(
  input: AdminPasswordResetCommitInput,
): AdminPasswordResetPublicResult {
  return {
    reset: true,
    user: {
      email: input.email,
      displayName: "密码重置预览管理员",
      role: "OWNER",
      status: "ACTIVE",
      passwordChangedAt:
        new Date("2026-07-31T03:00:00.000Z"),
      updatedAt: new Date("2026-07-31T03:00:00.000Z"),
    },
    password: {
      storedAs: "ARGON2ID_HASH_ONLY",
    },
    sessionsRevoked: 2,
  };
}

const previewIO = simulatedInput();
const preview = await runAdminPasswordResetPreview(previewIO);
const previewOutput = previewIO.output.join("\n");

assert.equal(preview.plan.email, TEST_EMAIL);
assert.deepEqual(preview.plan.database, {
  connected: false,
  writes: 0,
});
assert.equal(previewIO.visiblePrompts.length, 1);
assert.equal(previewIO.hiddenPrompts.length, 2);
assert.match(previewOutput, /管理员密码重置安全预览/);
assert.match(previewOutput, /数据库写入：0/);
assert.match(previewOutput, /仅预览，尚未重置密码/);
assert.equal(previewOutput.includes(TEST_PASSWORD), false);
assert.equal(previewOutput.includes("passwordHash"), false);

let cancellationCalls = 0;
const cancellationIO = simulatedInput("CANCEL");
const cancellation = await runAdminPasswordResetCommit(
  cancellationIO,
  async (input) => {
    cancellationCalls += 1;
    return fakeReset(input);
  },
);
const cancellationOutput = cancellationIO.output.join("\n");

assert.equal(cancellation.committed, false);
assert.equal(cancellationCalls, 0);
assert.match(cancellationOutput, /已取消/);
assert.match(cancellationOutput, /数据库写入 0/);
assert.equal(cancellationOutput.includes(TEST_PASSWORD), false);

const exactConfirmation = `RESET PASSWORD ${TEST_EMAIL}`;
let resetCalls = 0;
let receivedPassword = "";
const successIO = simulatedInput(exactConfirmation);
const success = await runAdminPasswordResetCommit(
  successIO,
  async (input) => {
    resetCalls += 1;
    receivedPassword = input.password;
    return fakeReset(input);
  },
);
const successOutput = successIO.output.join("\n");

assert.equal(success.committed, true);
assert.equal(resetCalls, 1);
assert.equal(receivedPassword, TEST_PASSWORD);
receivedPassword = "";
assert.equal(
  adminPasswordResetConfirmation(success.plan),
  exactConfirmation,
);
assert.match(successOutput, /管理员密码重置安全预览/);
assert.match(successOutput, /管理员密码重置成功/);
assert.match(successOutput, /已撤销会话：2/);
assert.match(successOutput, /数据库事务：已提交/);
assert.equal(successOutput.includes(TEST_PASSWORD), false);
assert.equal(successOutput.includes("passwordHash"), false);
assert.equal(JSON.stringify(success).includes(TEST_PASSWORD), false);

let mismatchCalls = 0;
const mismatchIO = new SimulatedResetIO(
  [TEST_EMAIL],
  [TEST_PASSWORD, WRONG_PASSWORD],
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

let invalidCalls = 0;
const invalidIO = new SimulatedResetIO(
  ["invalid-email"],
  [TEST_PASSWORD, TEST_PASSWORD],
);

await assert.rejects(
  runAdminPasswordResetCommit(invalidIO, async (input) => {
    invalidCalls += 1;
    return fakeReset(input);
  }),
  (error: unknown) =>
    error instanceof AdminPasswordResetPlanError,
);
assert.equal(invalidCalls, 0);
assert.equal(invalidIO.output.length, 0);

const simulatedTerminalInput = new SimulatedTerminalInput();
const simulatedTerminalOutput = new CapturedTerminalOutput();
const hiddenTerminal = new TerminalHiddenInput(
  simulatedTerminalInput,
  simulatedTerminalOutput,
);
const hiddenRead = hiddenTerminal.readHidden("隐藏重置密码测试：");

setImmediate(() => {
  simulatedTerminalInput.write(TEST_PASSWORD);
  simulatedTerminalInput.write("\r");
});

assert.equal(await hiddenRead, TEST_PASSWORD);
hiddenTerminal.close();
assert.match(
  simulatedTerminalOutput.text(),
  /隐藏重置密码测试：/,
);
assert.equal(
  simulatedTerminalOutput.text().includes(TEST_PASSWORD),
  false,
);
assert.equal(simulatedTerminalInput.isRaw, false);

assert.throws(
  () =>
    new TerminalHiddenInput(
      new PassThrough(),
      new CapturedTerminalOutput(),
    ),
  (error: unknown) =>
    error instanceof InteractiveTerminalRequiredError,
);

for (const path of [
  "src/server/auth/admin-password-reset-preview.ts",
  "tools/terminal-hidden-input.mts",
]) {
  const source = fs.readFileSync(path, "utf8");

  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /node:fs/);
  assert.doesNotMatch(source, /admin-password-reset\.ts/);
  assert.doesNotMatch(source, /hashPassword/);
  assert.doesNotMatch(source, /prisma/i);
}

console.log("administrator password reset preview: passed");
console.log("visible fields read: email");
console.log("hidden fields read: password/confirmation");
console.log("simulated terminal password echo: 0");
console.log("password mismatch: rejected");
console.log("invalid input: rejected");
console.log("cancellation database callback calls: 0");
console.log("exact confirmation database callback calls: 1");
console.log("non-interactive input: rejected");
console.log("filesystem writes: 0");
console.log("database imports/connections/writes: 0");
