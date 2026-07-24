import assert from "node:assert/strict";
import fs from "node:fs";

import {
  InvalidSessionTokenError,
  SESSION_TOKEN_SETTINGS,
  createSessionToken,
  hashSessionToken,
} from "../src/server/auth/session-token.ts";

const generated = Array.from(
  { length: 64 },
  () => createSessionToken(),
);
const rawTokens = generated.map(({ token }) => token);
const storedHashes = generated.map(({ tokenHash }) => tokenHash);

assert.deepEqual(SESSION_TOKEN_SETTINGS, {
  randomBytes: 32,
  entropyBits: 256,
  encoding: "base64url",
  tokenCharacters: 43,
  hashAlgorithm: "sha256",
  hashCharacters: 64,
});

assert.equal(new Set(rawTokens).size, generated.length);
assert.equal(new Set(storedHashes).size, generated.length);

for (const { token, tokenHash } of generated) {
  assert.equal(token.length, SESSION_TOKEN_SETTINGS.tokenCharacters);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.equal(token.includes("="), false);

  assert.equal(
    tokenHash.length,
    SESSION_TOKEN_SETTINGS.hashCharacters,
  );
  assert.match(tokenHash, /^[a-f0-9]+$/);
  assert.equal(hashSessionToken(token), tokenHash);
  assert.equal(tokenHash.includes(token), false);
}

const firstToken = generated[0]?.token;

assert.ok(firstToken);
assert.equal(hashSessionToken(firstToken), hashSessionToken(firstToken));

for (const invalidToken of [
  "",
  "short",
  `${firstToken}=`,
  firstToken.slice(0, -1),
  `${firstToken.slice(0, -1)}!`,
  "管理员会话令牌不是base64url格式",
  null,
  undefined,
  123,
]) {
  assert.throws(
    () => hashSessionToken(invalidToken),
    (error: unknown) => error instanceof InvalidSessionTokenError,
  );
}

const source = fs.readFileSync(
  "src/server/auth/session-token.ts",
  "utf8",
);

assert.doesNotMatch(source, /console\./);
assert.doesNotMatch(source, /process\.env/);
assert.doesNotMatch(source, /node:fs/);
assert.doesNotMatch(source, /prisma/i);
assert.doesNotMatch(source, /database/i);

console.log("session token service: passed");
console.log(`random entropy: ${SESSION_TOKEN_SETTINGS.entropyBits} bits`);
console.log(
  `raw token format: base64url/${SESSION_TOKEN_SETTINGS.tokenCharacters} characters`,
);
console.log(
  `stored digest: SHA-256/${SESSION_TOKEN_SETTINGS.hashCharacters} hex characters`,
);
console.log(`unique samples: ${generated.length}/${generated.length}`);
console.log("raw tokens/hashes printed: 0");
console.log("filesystem writes: 0");
console.log("database connections/writes: 0");
