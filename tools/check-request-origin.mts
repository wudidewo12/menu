import assert from "node:assert/strict";
import fs from "node:fs";

import {
  InvalidAllowedOriginError,
  REQUEST_ORIGIN_SETTINGS,
  hasAllowedRequestOrigin,
  normalizeAllowedOrigin,
} from "../src/server/http/request-origin.ts";

assert.deepEqual(REQUEST_ORIGIN_SETTINGS, {
  allowedProtocols: ["http:", "https:"],
  localHttpHostnames: [
    "localhost",
    "127.0.0.1",
    "[::1]",
  ],
});
assert.equal(Object.isFrozen(REQUEST_ORIGIN_SETTINGS), true);
assert.equal(
  Object.isFrozen(REQUEST_ORIGIN_SETTINGS.allowedProtocols),
  true,
);
assert.equal(
  Object.isFrozen(REQUEST_ORIGIN_SETTINGS.localHttpHostnames),
  true,
);

assert.equal(
  normalizeAllowedOrigin(
    " https://MENU.example.com:443/ ",
  ),
  "https://menu.example.com",
);
assert.equal(
  normalizeAllowedOrigin("http://127.0.0.1:3001"),
  "http://127.0.0.1:3001",
);
assert.equal(
  normalizeAllowedOrigin("http://[::1]:3001/"),
  "http://[::1]:3001",
);

for (const invalidAllowedOrigin of [
  undefined,
  null,
  [],
  "",
  "null",
  "*",
  "https://*.example.com",
  "ftp://menu.example.com",
  "http://menu.example.com",
  "http://192.168.1.10:3001",
  "http://0.0.0.0:3001",
  "https://user@menu.example.com",
  "https://user:password@menu.example.com",
  "https://menu.example.com/admin",
  "https://menu.example.com?next=admin",
  "https://menu.example.com#admin",
  "https://menu.example.com,https://evil.example",
  "https://menu.example.com\u0000",
]) {
  assert.throws(
    () => normalizeAllowedOrigin(invalidAllowedOrigin),
    (error: unknown) =>
      error instanceof InvalidAllowedOriginError,
  );
}

const allowedOrigin = "https://menu.example.com";

for (const validRequestOrigin of [
  "https://menu.example.com",
  "https://MENU.EXAMPLE.COM",
  "https://menu.example.com:443",
]) {
  assert.equal(
    hasAllowedRequestOrigin(
      validRequestOrigin,
      allowedOrigin,
    ),
    true,
  );
}

for (const invalidRequestOrigin of [
  undefined,
  null,
  [],
  ["https://menu.example.com"],
  "",
  "null",
  "*",
  " https://menu.example.com",
  "https://menu.example.com ",
  "http://menu.example.com",
  "https://menu.example.com:444",
  "https://admin.menu.example.com",
  "https://menu.example.com.evil.example",
  "https://menu.example.com/",
  "https://menu.example.com/admin",
  "https://menu.example.com?next=admin",
  "https://menu.example.com#admin",
  "https://user@menu.example.com",
  "https://menu.example.com,https://evil.example",
  "https://menu.example.com\u0000",
]) {
  assert.equal(
    hasAllowedRequestOrigin(
      invalidRequestOrigin,
      allowedOrigin,
    ),
    false,
  );
}

assert.equal(
  hasAllowedRequestOrigin(
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3001/",
  ),
  true,
);
assert.equal(
  hasAllowedRequestOrigin(
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ),
  false,
);

const source = fs.readFileSync(
  "src/server/http/request-origin.ts",
  "utf8",
);

assert.doesNotMatch(source, /process\.env/);
assert.doesNotMatch(source, /prisma/i);
assert.doesNotMatch(source, /node:/);
assert.doesNotMatch(source, /console\./);

console.log("request origin boundary: passed");
console.log("allowed protocols: http/https only");
console.log("plain HTTP: loopback hosts only");
console.log("scheme/host/port comparison: enforced");
console.log("missing/null/multiple origins: rejected");
console.log("path/query/hash/credentials: rejected");
console.log("wildcard origin: rejected");
console.log("database imports/connections/writes: 0");
