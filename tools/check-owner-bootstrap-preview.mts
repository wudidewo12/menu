import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { PassThrough, Writable } from "node:stream";

import {
  OwnerBootstrapPlanError,
} from "../src/server/auth/owner-bootstrap-plan.ts";
import {
  OwnerPasswordConfirmationMismatchError,
  runInitialOwnerPreview,
  type OwnerBootstrapPreviewIO,
} from "../src/server/auth/owner-bootstrap-preview.ts";
import {
  InteractiveTerminalRequiredError,
  TerminalHiddenInput,
} from "./terminal-hidden-input.mts";

const TEST_PASSWORD = "Fixed Hidden OWNER Preview Test Only 2026!";
const WRONG_CONFIRMATION = "Fixed Wrong Confirmation Test Only 2026!";

class SimulatedPreviewIO implements OwnerBootstrapPreviewIO {
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

const validIO = new SimulatedPreviewIO(
  [
    "  PREVIEW.Owner@Example.Invalid  ",
    "  预览   管理员  ",
  ],
  [TEST_PASSWORD, TEST_PASSWORD],
);
const preview = await runInitialOwnerPreview(validIO);
const previewOutput = validIO.output.join("\n");

assert.equal(preview.plan.email, "preview.owner@example.invalid");
assert.equal(preview.plan.displayName, "预览 管理员");
assert.equal(preview.plan.role, "OWNER");
assert.equal(preview.plan.status, "ACTIVE");
assert.deepEqual(preview.plan.database, {
  connected: false,
  writes: 0,
});
assert.equal(validIO.visiblePrompts.length, 2);
assert.equal(validIO.hiddenPrompts.length, 2);
assert.equal(previewOutput.includes(TEST_PASSWORD), false);
assert.equal(previewOutput.includes("passwordHash"), false);
assert.match(previewOutput, /数据库写入：0/);
assert.match(previewOutput, /仅预览，尚未创建管理员/);

const mismatchIO = new SimulatedPreviewIO(
  ["preview.owner@example.invalid", "预览管理员"],
  [TEST_PASSWORD, WRONG_CONFIRMATION],
);

await assert.rejects(
  runInitialOwnerPreview(mismatchIO),
  (error: unknown) =>
    error instanceof OwnerPasswordConfirmationMismatchError,
);
assert.equal(mismatchIO.output.join("\n").includes(TEST_PASSWORD), false);
assert.equal(mismatchIO.output.length, 0);

const invalidIO = new SimulatedPreviewIO(
  ["invalid-email", "预览管理员"],
  [TEST_PASSWORD, TEST_PASSWORD],
);

await assert.rejects(
  runInitialOwnerPreview(invalidIO),
  (error: unknown) => error instanceof OwnerBootstrapPlanError,
);
assert.equal(invalidIO.output.length, 0);

const simulatedInput = new SimulatedTerminalInput();
const simulatedOutput = new CapturedTerminalOutput();
const hiddenTerminal = new TerminalHiddenInput(
  simulatedInput,
  simulatedOutput,
);
const hiddenRead = hiddenTerminal.readHidden("隐藏输入测试：");

setImmediate(() => {
  simulatedInput.write(TEST_PASSWORD);
  simulatedInput.write("\r");
});

assert.equal(await hiddenRead, TEST_PASSWORD);
hiddenTerminal.close();
assert.match(simulatedOutput.text(), /隐藏输入测试：/);
assert.equal(simulatedOutput.text().includes(TEST_PASSWORD), false);
assert.equal(simulatedInput.isRaw, false);

assert.throws(
  () =>
    new TerminalHiddenInput(
      new PassThrough(),
      new CapturedTerminalOutput(),
    ),
  (error: unknown) =>
    error instanceof InteractiveTerminalRequiredError,
);

const ARGUMENT_TEST_SECRET = "Fixed-Argument-Secret-Must-Not-Echo";
const argumentResult = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--conditions=react-server",
    "tools/preview-owner-bootstrap.mts",
    ARGUMENT_TEST_SECRET,
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8",
  },
);
const argumentOutput = `${argumentResult.stdout}${argumentResult.stderr}`;

assert.equal(argumentResult.status, 1);
assert.match(argumentOutput, /不接受任何参数/);
assert.equal(argumentOutput.includes(ARGUMENT_TEST_SECRET), false);

const nonInteractiveResult = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--conditions=react-server",
    "tools/preview-owner-bootstrap.mts",
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

for (const path of [
  "src/server/auth/owner-bootstrap-preview.ts",
  "tools/terminal-hidden-input.mts",
  "tools/preview-owner-bootstrap.mts",
]) {
  const source = fs.readFileSync(path, "utf8");

  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /node:fs/);
  assert.doesNotMatch(source, /createInitialOwner/);
  assert.doesNotMatch(source, /owner-bootstrap\.ts/);
}

console.log("OWNER preview command: passed");
console.log("visible fields read: email/display name");
console.log("hidden fields read: password/confirmation");
console.log("simulated terminal password echo: 0");
console.log("argument secret echo: 0");
console.log("non-interactive input: rejected");
console.log("password mismatch: rejected");
console.log("invalid input: rejected");
console.log("environment password input: disabled");
console.log("filesystem writes: 0");
console.log("database imports/connections/writes: 0");
