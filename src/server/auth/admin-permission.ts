import "server-only";

export const ADMIN_ROLES = Object.freeze([
  "OWNER",
  "EDITOR",
  "VIEWER",
] as const);

export const ADMIN_PERMISSIONS = Object.freeze([
  "MENU_READ",
  "MENU_WRITE",
  "DISH_IMAGE_WRITE",
  "ADMIN_USER_MANAGE",
] as const);

export type AdminRoleName =
  (typeof ADMIN_ROLES)[number];

export type AdminPermission =
  (typeof ADMIN_PERMISSIONS)[number];

const ROLE_PERMISSIONS = Object.freeze({
  OWNER: ADMIN_PERMISSIONS,
  EDITOR: Object.freeze([
    "MENU_READ",
    "MENU_WRITE",
    "DISH_IMAGE_WRITE",
  ] as const),
  VIEWER: Object.freeze([
    "MENU_READ",
  ] as const),
} satisfies Readonly<
  Record<AdminRoleName, readonly AdminPermission[]>
>);

export const ADMIN_PERMISSION_SETTINGS = Object.freeze({
  roles: ADMIN_ROLES,
  permissions: ADMIN_PERMISSIONS,
  rolePermissions: ROLE_PERMISSIONS,
});

export class AdminPermissionDeniedError extends Error {
  readonly code = "ADMIN_PERMISSION_DENIED";

  constructor() {
    super("管理员没有执行此操作的权限");
    this.name = "AdminPermissionDeniedError";
  }
}

function isAdminRoleName(
  input: unknown,
): input is AdminRoleName {
  return (
    typeof input === "string" &&
    (ADMIN_ROLES as readonly string[]).includes(input)
  );
}

function isAdminPermission(
  input: unknown,
): input is AdminPermission {
  return (
    typeof input === "string" &&
    (ADMIN_PERMISSIONS as readonly string[]).includes(input)
  );
}

export function hasAdminPermission(
  roleInput: unknown,
  permissionInput: unknown,
): boolean {
  if (
    !isAdminRoleName(roleInput) ||
    !isAdminPermission(permissionInput)
  ) {
    return false;
  }

  return (
    ADMIN_PERMISSION_SETTINGS.rolePermissions[
      roleInput
    ] as readonly AdminPermission[]
  ).includes(permissionInput);
}

export function requireAdminPermission(
  roleInput: unknown,
  permissionInput: unknown,
): AdminRoleName {
  if (!hasAdminPermission(roleInput, permissionInput)) {
    throw new AdminPermissionDeniedError();
  }

  return roleInput as AdminRoleName;
}
