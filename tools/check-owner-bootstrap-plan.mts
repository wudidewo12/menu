import assert from "node:assert/strict";

import {
  INITIAL_OWNER_SETTINGS,
  OwnerBootstrapPlanError,
  buildInitialOwnerPlan,
  validateInitialOwnerInput,
  type OwnerBootstrapIssueCode,
} from "../src/server/auth/owner-bootstrap-plan.ts";

const TEST_PASSWORD = "Fixed Owner Bootstrap Test Only 2026!";
const validInput = Object.freeze({
  email: "  FIRST.Owner+Setup@Example.Invalid  ",
  displayName: "  初始   管理员  ",
  password: TEST_PASSWORD,
  role: "VIEWER",
  status: "DISABLED",
});

function issueCodes(input: unknown): OwnerBootstrapIssueCode[] {
  return validateInitialOwnerInput(input).issues.map((issue) => issue.code);
}

const plan = buildInitialOwnerPlan(validInput);
const serializedPlan = JSON.stringify(plan);

assert.equal(plan.operation, "CREATE_INITIAL_OWNER");
assert.equal(plan.email, "first.owner+setup@example.invalid");
assert.equal(plan.displayName, "初始 管理员");
assert.equal(plan.role, "OWNER");
assert.equal(plan.status, "ACTIVE");
assert.equal(plan.password.accepted, true);
assert.equal(plan.password.characterCount, Array.from(TEST_PASSWORD).length);
assert.equal(plan.password.storedAs, "ARGON2ID_HASH_ONLY");
assert.equal(plan.password.hashCreated, false);
assert.deepEqual(plan.database, { connected: false, writes: 0 });
assert.equal(serializedPlan.includes(TEST_PASSWORD), false);
assert.equal("passwordHash" in plan, false);
assert.equal(validInput.email, "  FIRST.Owner+Setup@Example.Invalid  ");
assert.equal(validInput.displayName, "  初始   管理员  ");

assert.deepEqual(issueCodes(null), [
  "EMAIL_REQUIRED",
  "DISPLAY_NAME_REQUIRED",
  "PASSWORD_REQUIRED",
]);
assert.deepEqual(
  issueCodes({
    email: "first..owner@example.invalid",
    displayName: "管理员",
    password: TEST_PASSWORD,
  }),
  ["EMAIL_INVALID"],
);
assert.deepEqual(
  issueCodes({
    email: "first.owner@example.invalid",
    displayName: "",
    password: TEST_PASSWORD,
  }),
  ["DISPLAY_NAME_REQUIRED"],
);
assert.deepEqual(
  issueCodes({
    email: "first.owner@example.invalid",
    displayName: "管理员\n换行",
    password: TEST_PASSWORD,
  }),
  ["DISPLAY_NAME_HAS_CONTROL_CHARACTERS"],
);
assert.deepEqual(
  issueCodes({
    email: "first.owner@example.invalid",
    displayName: "管".repeat(
      INITIAL_OWNER_SETTINGS.maximumDisplayNameCharacters + 1,
    ),
    password: TEST_PASSWORD,
  }),
  ["DISPLAY_NAME_TOO_LONG"],
);
assert.deepEqual(
  issueCodes({
    email: "first.owner@example.invalid",
    displayName: "管理员",
    password: "too short",
  }),
  ["PASSWORD_TOO_SHORT"],
);
assert.deepEqual(
  issueCodes({
    email: "first.owner@example.invalid",
    displayName: "管理员",
    password: "first.owner@example.invalid",
  }),
  ["PASSWORD_BLOCKED"],
);
assert.throws(
  () => buildInitialOwnerPlan({}),
  (error: unknown) =>
    error instanceof OwnerBootstrapPlanError &&
    error.code === "OWNER_BOOTSTRAP_INPUT_INVALID" &&
    error.issues.length === 3,
);

console.log("initial OWNER input plan: passed");
console.log("email normalization and validation: passed");
console.log("display-name normalization and validation: passed");
console.log("password policy and account context: passed");
console.log("forced role/status: OWNER/ACTIVE");
console.log("password hash created: no");
console.log("password values printed: 0");
console.log("database connections: 0");
console.log("database writes: 0");
