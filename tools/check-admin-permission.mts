import assert from "node:assert/strict";
import fs from "node:fs";

import {
  ADMIN_PERMISSIONS,
  ADMIN_PERMISSION_SETTINGS,
  ADMIN_ROLES,
  AdminPermissionDeniedError,
  hasAdminPermission,
  requireAdminPermission,
  type AdminPermission,
  type AdminRoleName,
} from "../src/server/auth/admin-permission.ts";
import {
  AdminRole as DatabaseAdminRole,
} from "../src/generated/prisma/enums.ts";

const expectedPermissions: Record<
  AdminRoleName,
  readonly AdminPermission[]
> = {
  OWNER: [
    "MENU_READ",
    "MENU_WRITE",
    "DISH_IMAGE_WRITE",
    "ADMIN_USER_MANAGE",
  ],
  EDITOR: [
    "MENU_READ",
    "MENU_WRITE",
    "DISH_IMAGE_WRITE",
  ],
  VIEWER: [
    "MENU_READ",
  ],
};

assert.deepEqual(
  ADMIN_ROLES,
  Object.values(DatabaseAdminRole),
);
assert.deepEqual(
  ADMIN_PERMISSIONS,
  [
    "MENU_READ",
    "MENU_WRITE",
    "DISH_IMAGE_WRITE",
    "ADMIN_USER_MANAGE",
  ],
);
assert.deepEqual(
  ADMIN_PERMISSION_SETTINGS.rolePermissions,
  expectedPermissions,
);

assert.equal(Object.isFrozen(ADMIN_ROLES), true);
assert.equal(Object.isFrozen(ADMIN_PERMISSIONS), true);
assert.equal(
  Object.isFrozen(ADMIN_PERMISSION_SETTINGS),
  true,
);
assert.equal(
  Object.isFrozen(
    ADMIN_PERMISSION_SETTINGS.rolePermissions,
  ),
  true,
);

for (const role of ADMIN_ROLES) {
  assert.equal(
    Object.isFrozen(
      ADMIN_PERMISSION_SETTINGS.rolePermissions[role],
    ),
    true,
  );

  for (const permission of ADMIN_PERMISSIONS) {
    assert.equal(
      hasAdminPermission(role, permission),
      expectedPermissions[role].includes(permission),
      `${role}/${permission}`,
    );
  }
}

assert.equal(
  requireAdminPermission("OWNER", "ADMIN_USER_MANAGE"),
  "OWNER",
);
assert.equal(
  requireAdminPermission("EDITOR", "MENU_WRITE"),
  "EDITOR",
);
assert.equal(
  requireAdminPermission("VIEWER", "MENU_READ"),
  "VIEWER",
);

for (const [role, permission] of [
  ["EDITOR", "ADMIN_USER_MANAGE"],
  ["VIEWER", "MENU_WRITE"],
  ["VIEWER", "DISH_IMAGE_WRITE"],
  ["OWNER", "UNKNOWN"],
  ["UNKNOWN", "MENU_READ"],
  ["owner", "MENU_READ"],
  ["constructor", "MENU_READ"],
  [undefined, "MENU_READ"],
  ["OWNER", undefined],
  [null, null],
  [[], []],
] as const) {
  assert.equal(
    hasAdminPermission(role, permission),
    false,
  );
  assert.throws(
    () => requireAdminPermission(role, permission),
    (error: unknown) =>
      error instanceof AdminPermissionDeniedError &&
      error.code === "ADMIN_PERMISSION_DENIED" &&
      error.message === "管理员没有执行此操作的权限",
  );
}

const source = fs.readFileSync(
  "src/server/auth/admin-permission.ts",
  "utf8",
);

assert.doesNotMatch(source, /process\.env/);
assert.doesNotMatch(source, /prisma/i);
assert.doesNotMatch(source, /node:/);
assert.doesNotMatch(source, /console\./);

console.log("administrator RBAC permission policy: passed");
console.log("database role enum alignment: passed");
console.log("OWNER permissions: 4/4");
console.log("EDITOR permissions: 3/4");
console.log("VIEWER permissions: 1/4");
console.log("unknown role/permission: denied");
console.log("database imports/connections/writes: 0");
