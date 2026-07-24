import assert from "node:assert/strict";

import {
  PASSWORD_HASH_SETTINGS,
  hashPassword,
  verifyPassword,
} from "../src/server/auth/password.ts";
import { PasswordPolicyValidationError } from "../src/server/auth/password-policy.ts";

const TEST_PASSWORD = "Menu-Password-Service-Test-Only!2026";
const WRONG_TEST_PASSWORD = "Menu-Password-Service-Wrong-Test-Only!2026";
const COMPOSED_UNICODE_PASSWORD = "Menu-Caf\u00e9-Test-Only!2026";
const DECOMPOSED_UNICODE_PASSWORD = "Menu-Cafe\u0301-Test-Only!2026";

function readEncodedSettings(passwordHash: string) {
  const match = passwordHash.match(
    /^\$(argon2id)\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/,
  );

  assert.ok(match, "The password hash must use the expected Argon2 encoding");

  return {
    algorithm: match[1],
    version: Number(match[2]),
    memoryCostKiB: Number(match[3]),
    timeCost: Number(match[4]),
    parallelism: Number(match[5]),
  };
}

const firstHash = await hashPassword(TEST_PASSWORD);
const secondHash = await hashPassword(TEST_PASSWORD);
const unicodeHash = await hashPassword(COMPOSED_UNICODE_PASSWORD);
const encodedSettings = readEncodedSettings(firstHash);

assert.notEqual(
  firstHash,
  secondHash,
  "A random salt must produce different hashes for the same password",
);
assert.equal(encodedSettings.algorithm, PASSWORD_HASH_SETTINGS.algorithm);
assert.equal(encodedSettings.version, PASSWORD_HASH_SETTINGS.version);
assert.equal(
  encodedSettings.memoryCostKiB,
  PASSWORD_HASH_SETTINGS.memoryCostKiB,
);
assert.equal(encodedSettings.timeCost, PASSWORD_HASH_SETTINGS.timeCost);
assert.equal(encodedSettings.parallelism, PASSWORD_HASH_SETTINGS.parallelism);
assert.equal(await verifyPassword(TEST_PASSWORD, firstHash), true);
assert.equal(await verifyPassword(WRONG_TEST_PASSWORD, firstHash), false);
assert.equal(
  await verifyPassword(DECOMPOSED_UNICODE_PASSWORD, unicodeHash),
  true,
);
assert.equal(await verifyPassword(TEST_PASSWORD, "not-an-argon2-hash"), false);
assert.equal(await verifyPassword("", firstHash), false);
await assert.rejects(
  hashPassword(""),
  (error: unknown) =>
    error instanceof PasswordPolicyValidationError &&
    error.issues.some((issue) => issue.code === "PASSWORD_REQUIRED"),
);

console.log("password hash service: passed");
console.log(`algorithm: ${encodedSettings.algorithm}`);
console.log(`version: ${encodedSettings.version}`);
console.log(`memory cost: ${encodedSettings.memoryCostKiB} KiB`);
console.log(`time cost: ${encodedSettings.timeCost}`);
console.log(`parallelism: ${encodedSettings.parallelism}`);
console.log("random salt: passed");
console.log("correct password: accepted");
console.log("wrong password: rejected");
console.log("equivalent Unicode password: accepted");
console.log("malformed hash: rejected");
console.log("database writes: 0");
