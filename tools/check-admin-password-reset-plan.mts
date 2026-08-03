import assert from "node:assert/strict";

import {
  AdminPasswordResetPlanError,
  buildAdminPasswordResetPlan,
  validateAdminPasswordResetInput,
  type AdminPasswordResetIssueCode,
} from "../src/server/auth/admin-password-reset-plan.ts";

const TEST_PASSWORD = "Reset Plan Test Password 2026!";
const validInput = Object.freeze({
  email: "  RESET.Owner@Example.Invalid  ",
  password: TEST_PASSWORD,
  role: "VIEWER",
  status: "DISABLED",
  passwordHash: "MUST_NOT_BE_ACCEPTED",
  revokeExisting: false,
});

function issueCodes(input: unknown): AdminPasswordResetIssueCode[] {
  return validateAdminPasswordResetInput(input).issues.map(
    (issue) => issue.code,
  );
}

const plan = buildAdminPasswordResetPlan(validInput);
const serializedPlan = JSON.stringify(plan);

assert.equal(plan.operation, "RESET_ADMIN_PASSWORD");
assert.equal(plan.email, "reset.owner@example.invalid");
assert.equal(plan.password.accepted, true);
assert.equal(
  plan.password.characterCount,
  Array.from(TEST_PASSWORD).length,
);
assert.equal(plan.password.storedAs, "ARGON2ID_HASH_ONLY");
assert.equal(plan.password.hashCreated, false);
assert.deepEqual(plan.sessions, {
  revokeExisting: true,
});
assert.deepEqual(plan.database, {
  connected: false,
  writes: 0,
});
assert.equal(serializedPlan.includes(TEST_PASSWORD), false);
assert.equal(serializedPlan.includes("MUST_NOT_BE_ACCEPTED"), false);
assert.equal("passwordHash" in plan, false);
assert.equal("role" in plan, false);
assert.equal("status" in plan, false);
assert.equal(validInput.email, "  RESET.Owner@Example.Invalid  ");

assert.deepEqual(issueCodes(null), [
  "EMAIL_REQUIRED",
  "PASSWORD_REQUIRED",
]);
assert.deepEqual(
  issueCodes({
    email: "reset..owner@example.invalid",
    password: TEST_PASSWORD,
  }),
  ["EMAIL_INVALID"],
);
assert.deepEqual(
  issueCodes({
    email: "reset.owner@example.invalid",
    password: "too short",
  }),
  ["PASSWORD_TOO_SHORT"],
);
assert.deepEqual(
  issueCodes({
    email: "reset.owner@example.invalid",
    password: "reset.owner@example.invalid",
  }),
  ["PASSWORD_BLOCKED"],
);
assert.deepEqual(
  issueCodes({
    email: "reset.owner@example.invalid",
    password: "reset.owner",
  }),
  ["PASSWORD_TOO_SHORT", "PASSWORD_BLOCKED"],
);
assert.deepEqual(
  issueCodes({
    email: "reset.owner@example.invalid",
    password: "Valid length but\nnewline",
  }),
  ["PASSWORD_HAS_CONTROL_CHARACTERS"],
);
assert.throws(
  () => buildAdminPasswordResetPlan({}),
  (error: unknown) =>
    error instanceof AdminPasswordResetPlanError &&
    error.code === "ADMIN_PASSWORD_RESET_INPUT_INVALID" &&
    error.issues.length === 2,
);

console.log("administrator password reset plan: passed");
console.log("email normalization and validation: passed");
console.log("password policy and account context: passed");
console.log("caller role/status/hash input ignored: passed");
console.log("existing sessions marked for revocation: yes");
console.log("password hash created: no");
console.log("password values printed: 0");
console.log("database connections: 0");
console.log("database writes: 0");
