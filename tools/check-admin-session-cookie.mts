import assert from "node:assert/strict";
import fs from "node:fs";

import {
  ADMIN_SESSION_COOKIE_SETTINGS,
  InvalidAdminSessionCookieModeError,
  readAdminSessionToken,
  serializeAdminSessionCookie,
  serializeClearedAdminSessionCookie,
} from "../src/server/auth/admin-session-cookie.ts";
import {
  ADMIN_SESSION_SETTINGS,
} from "../src/server/auth/admin-session-settings.ts";
import {
  InvalidSessionTokenError,
  createSessionToken,
} from "../src/server/auth/session-token.ts";

const { token } = createSessionToken();
const developmentCookie = serializeAdminSessionCookie(
  token,
  "development",
);
const productionCookie = serializeAdminSessionCookie(
  token,
  "production",
);

assert.deepEqual(ADMIN_SESSION_COOKIE_SETTINGS, {
  name: "menu_admin_session",
  path: "/",
  httpOnly: true,
  sameSite: "Strict",
  maxAgeSeconds: 28_800,
  clearedExpires: "Thu, 01 Jan 1970 00:00:00 GMT",
});
assert.equal(
  ADMIN_SESSION_COOKIE_SETTINGS.maxAgeSeconds,
  ADMIN_SESSION_SETTINGS.absoluteLifetimeMs / 1_000,
);

assert.equal(
  developmentCookie,
  `menu_admin_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`,
);
assert.equal(developmentCookie.includes("Secure"), false);
assert.equal(developmentCookie.includes("Domain="), false);

assert.equal(
  productionCookie,
  `menu_admin_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure`,
);
assert.match(productionCookie, /; Secure$/);
assert.equal(productionCookie.includes("Domain="), false);

assert.equal(
  readAdminSessionToken(
    `theme=dark; menu_admin_session=${token}; locale=zh-CN`,
  ),
  token,
);
assert.equal(
  readAdminSessionToken(
    ` menu_admin_session = ${token} `,
  ),
  token,
);

for (const invalidHeader of [
  undefined,
  null,
  "",
  "theme=dark",
  "menu_admin_session=",
  "menu_admin_session=short",
  `menu_admin_session=${token}=`,
  `menu_admin_session=%2D${token.slice(1)}`,
  `menu_admin_session=${token}; menu_admin_session=${token}`,
  `menu_admin_session=${token}\r\nX-Injected: true`,
]) {
  assert.equal(readAdminSessionToken(invalidHeader), null);
}

assert.throws(
  () => serializeAdminSessionCookie("short", "development"),
  (error: unknown) => error instanceof InvalidSessionTokenError,
);
assert.throws(
  () => serializeAdminSessionCookie(token, "staging"),
  (error: unknown) =>
    error instanceof InvalidAdminSessionCookieModeError,
);
assert.throws(
  () => serializeClearedAdminSessionCookie("staging"),
  (error: unknown) =>
    error instanceof InvalidAdminSessionCookieModeError,
);

const clearedDevelopment =
  serializeClearedAdminSessionCookie("development");
const clearedProduction =
  serializeClearedAdminSessionCookie("production");

assert.equal(
  clearedDevelopment,
  "menu_admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
);
assert.equal(clearedDevelopment.includes(token), false);
assert.equal(clearedDevelopment.includes("Secure"), false);
assert.equal(
  clearedProduction,
  `${clearedDevelopment}; Secure`,
);
assert.equal(clearedProduction.includes(token), false);

for (const path of [
  "src/server/auth/admin-session-settings.ts",
  "src/server/auth/admin-session-cookie.ts",
]) {
  const source = fs.readFileSync(path, "utf8");

  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /prisma/i);
  assert.doesNotMatch(source, /node:fs/);
  assert.doesNotMatch(source, /console\./);
}

console.log("admin session cookie boundary: passed");
console.log("HttpOnly/SameSite Strict/Path root: enforced");
console.log("cookie/database lifetime alignment: 8 hours");
console.log("production Secure attribute: enforced");
console.log("development Secure attribute: omitted");
console.log("duplicate/malformed session cookies: rejected");
console.log("clear-cookie attributes: passed");
console.log("raw token printed: 0");
console.log("database imports/connections/writes: 0");
