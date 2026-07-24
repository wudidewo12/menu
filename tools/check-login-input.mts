import assert from "node:assert/strict";
import fs from "node:fs";

import {
  validateInitialOwnerInput,
} from "../src/server/auth/owner-bootstrap-plan.ts";
import {
  AdminLoginInputError,
  prepareAdminLoginInput,
  validateAdminLoginInput,
} from "../src/server/auth/login-input.ts";

const TEST_PASSWORD =
  "Cafe\u0301 Login Input Test Only 2026!";
const normalizedPassword =
  "Café Login Input Test Only 2026!";
const validInput = {
  email: "  LOGIN.Owner@Example.Invalid  ",
  password: TEST_PASSWORD,
  role: "OWNER",
};
const originalInput = structuredClone(validInput);
const validation = validateAdminLoginInput(validInput);
const credentials = prepareAdminLoginInput(validInput);

assert.equal(validation.isValid, true);
assert.equal(validation.email, "login.owner@example.invalid");
assert.equal(
  validation.passwordCharacterCount,
  Array.from(normalizedPassword).length,
);
assert.equal("password" in validation, false);
assert.equal(JSON.stringify(validation).includes(TEST_PASSWORD), false);
assert.equal(JSON.stringify(validation).includes(normalizedPassword), false);
assert.deepEqual(validInput, originalInput);

assert.deepEqual(credentials, {
  email: "login.owner@example.invalid",
  password: normalizedPassword,
});
assert.equal("role" in credentials, false);

const oneCharacterPassword = validateAdminLoginInput({
  email: "login.owner@example.invalid",
  password: "x",
});

assert.equal(oneCharacterPassword.isValid, true);
assert.equal(oneCharacterPassword.passwordCharacterCount, 1);

const invalidInputs = [
  {
    input: {},
    expectedCodes: ["EMAIL_REQUIRED", "PASSWORD_REQUIRED"],
  },
  {
    input: [],
    expectedCodes: ["EMAIL_REQUIRED", "PASSWORD_REQUIRED"],
  },
  {
    input: {
      email: "not-an-email",
      password: "x",
    },
    expectedCodes: ["EMAIL_INVALID"],
  },
  {
    input: {
      email: "login.owner@example.invalid",
      password: "",
    },
    expectedCodes: ["PASSWORD_REQUIRED"],
  },
  {
    input: {
      email: "login.owner@example.invalid",
      password: 123,
    },
    expectedCodes: ["PASSWORD_REQUIRED"],
  },
  {
    input: {
      email: "login.owner@example.invalid",
      password: "x".repeat(129),
    },
    expectedCodes: ["PASSWORD_TOO_LONG"],
  },
  {
    input: {
      email: "login.owner@example.invalid",
      password: "password-with-tab\t",
    },
    expectedCodes: ["PASSWORD_HAS_CONTROL_CHARACTERS"],
  },
] as const;

for (const { input, expectedCodes } of invalidInputs) {
  const result = validateAdminLoginInput(input);

  assert.equal(result.isValid, false);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    expectedCodes,
  );
  assert.equal("password" in result, false);
  await assert.rejects(
    async () => prepareAdminLoginInput(input),
    (error: unknown) =>
      error instanceof AdminLoginInputError &&
      JSON.stringify(error.issues).includes("password-with-tab") ===
        false,
  );
}

const emailCases = [
  "person@example.com",
  " PERSON@EXAMPLE.COM ",
  "a.b+tag@example.co.uk",
  "missing-at.example.com",
  "@example.com",
  "person@localhost",
  ".person@example.com",
  "person..name@example.com",
  "person@example-.com",
  "person@-example.com",
  "用户@example.com",
];
const ownerTestPassword =
  "Fixed Shared Email Rule Test Only 2026!";

for (const email of emailCases) {
  const loginResult = validateAdminLoginInput({
    email,
    password: "x",
  });
  const ownerResult = validateInitialOwnerInput({
    email,
    displayName: "共享邮箱规则测试",
    password: ownerTestPassword,
  });
  const loginEmailCodes = loginResult.issues
    .filter((issue) => issue.field === "email")
    .map((issue) => issue.code);
  const ownerEmailCodes = ownerResult.issues
    .filter((issue) => issue.field === "email")
    .map((issue) => issue.code);

  assert.deepEqual(loginEmailCodes, ownerEmailCodes);
}

for (const path of [
  "src/server/auth/admin-email.ts",
  "src/server/auth/login-input.ts",
]) {
  const source = fs.readFileSync(path, "utf8");

  assert.doesNotMatch(source, /console\./);
  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /prisma/i);
  assert.doesNotMatch(source, /verifyPassword/);
  assert.doesNotMatch(source, /createAdminSession/);
}

console.log("admin login input boundary: passed");
console.log("shared owner/login email rules: passed");
console.log("email normalization: NFC/trim/lowercase");
console.log("password normalization: NFC/no trimming");
console.log("short login password: accepted for verification");
console.log("password values printed: 0");
console.log("database connections/writes: 0");
console.log("session creations: 0");
