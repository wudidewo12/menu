import assert from "node:assert/strict";

import {
  PASSWORD_POLICY_SETTINGS,
  PasswordPolicyValidationError,
  normalizePasswordForAuthentication,
  preparePasswordForHashing,
  validatePasswordPolicy,
  type PasswordPolicyIssueCode,
} from "../src/server/auth/password-policy.ts";

function issueCodes(password: unknown): PasswordPolicyIssueCode[] {
  return validatePasswordPolicy(password).issues.map((issue) => issue.code);
}

const exactMinimum = "longtestphrasex";
const belowMinimum = "longtestphrase";
const exactMaximum = Array.from(
  { length: PASSWORD_POLICY_SETTINGS.maximumCharacters },
  (_, index) => String.fromCodePoint(0x4e00 + index),
).join("");
const aboveMaximum = `${exactMaximum}界`;
const unicodePassphrase = "今晚 菜单 管理 测试 口令 🔐 安全";
const composedUnicode = "Caf\u00e9";
const decomposedUnicode = "Cafe\u0301";

assert.deepEqual(issueCodes(""), ["PASSWORD_REQUIRED"]);
assert.deepEqual(issueCodes(belowMinimum), ["PASSWORD_TOO_SHORT"]);
assert.equal(validatePasswordPolicy(exactMinimum).isValid, true);
assert.equal(
  validatePasswordPolicy(exactMinimum).characterCount,
  PASSWORD_POLICY_SETTINGS.minimumCharacters,
);
assert.equal(validatePasswordPolicy(exactMaximum).isValid, true);
assert.equal(
  validatePasswordPolicy(exactMaximum).characterCount,
  PASSWORD_POLICY_SETTINGS.maximumCharacters,
);
assert.deepEqual(issueCodes(aboveMaximum), ["PASSWORD_TOO_LONG"]);
assert.equal(validatePasswordPolicy("onlylowercasewords").isValid, true);
assert.equal(validatePasswordPolicy(unicodePassphrase).isValid, true);
assert.deepEqual(
  issueCodes("valid length but\nnewline"),
  ["PASSWORD_HAS_CONTROL_CHARACTERS"],
);
assert.deepEqual(issueCodes("PasswordPassword"), ["PASSWORD_BLOCKED"]);
assert.deepEqual(
  validatePasswordPolicy("Owner Account Menu 2026", {
    blockedValues: ["owner account menu 2026"],
  }).issues.map((issue) => issue.code),
  ["PASSWORD_BLOCKED"],
);
assert.equal(
  normalizePasswordForAuthentication(decomposedUnicode),
  normalizePasswordForAuthentication(composedUnicode),
);
assert.throws(
  () => preparePasswordForHashing("PasswordPassword"),
  (error: unknown) =>
    error instanceof PasswordPolicyValidationError &&
    error.code === "PASSWORD_POLICY_FAILED",
);

console.log("password policy: passed");
console.log(`minimum characters: ${PASSWORD_POLICY_SETTINGS.minimumCharacters}`);
console.log(`maximum characters: ${PASSWORD_POLICY_SETTINGS.maximumCharacters}`);
console.log("Unicode character counting: passed");
console.log("Unicode NFC normalization: passed");
console.log("spaces and Unicode: accepted");
console.log("character-mix requirement: disabled");
console.log("control characters: rejected");
console.log("baseline/context blocklist: passed");
console.log("password values printed: 0");
console.log("database writes: 0");
