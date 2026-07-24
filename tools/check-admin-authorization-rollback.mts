import assert from "node:assert/strict";
import fs from "node:fs";

import dotenv from "dotenv";

import type { AdminPermission } from "../src/server/auth/admin-permission.ts";

const localEnvironment = dotenv.parse(
  fs.readFileSync(".env.local"),
);
const databaseUrl = localEnvironment.DATABASE_URL;
const applicationRole = localEnvironment.POSTGRES_APP_USER;

if (!databaseUrl || !applicationRole) {
  throw new Error(
    "DATABASE_URL and POSTGRES_APP_USER are required in .env.local",
  );
}

process.env.DATABASE_URL = databaseUrl;
process.env.POSTGRES_APP_USER = applicationRole;

delete process.env.DATABASE_ADMIN_URL;
delete process.env.POSTGRES_OWNER;
delete process.env.POSTGRES_OWNER_PASSWORD;
delete process.env.POSTGRES_APP_PASSWORD;

const [
  { authorizeAdminRequest },
  {
    ADMIN_PERMISSIONS,
    ADMIN_PERMISSION_SETTINGS,
  },
  {
    createAdminSessionInTransaction,
    findActiveAdminSession,
    revokeAdminSession,
  },
  { createSessionToken },
  { AdminRole, AdminStatus },
  { Prisma },
  { prisma },
] = await Promise.all([
  import("../src/server/auth/admin-authorization.ts"),
  import("../src/server/auth/admin-permission.ts"),
  import("../src/server/auth/admin-session.ts"),
  import("../src/server/auth/session-token.ts"),
  import("../src/generated/prisma/enums.ts"),
  import("../src/generated/prisma/client.ts"),
  import("../src/server/db/prisma.ts"),
]);

async function databaseCounts() {
  const [
    adminUsers,
    adminSessions,
    menus,
    dishes,
    menuDishes,
    menuSections,
    sectionDishes,
    dishImages,
  ] = await Promise.all([
    prisma.adminUser.count(),
    prisma.adminSession.count(),
    prisma.menu.count(),
    prisma.dish.count(),
    prisma.menuDish.count(),
    prisma.menuSection.count(),
    prisma.sectionDish.count(),
    prisma.dishImage.count(),
  ]);

  return {
    adminUsers,
    adminSessions,
    businessRows:
      menus +
      dishes +
      menuDishes +
      menuSections +
      sectionDishes +
      dishImages,
  };
}

const BASE_TIME = new Date("2026-07-25T00:00:00.000Z");
const LOOKUP_TIME = new Date(
  BASE_TIME.getTime() + 60_000,
);
const forcedRollbackError =
  new Error("FORCED_ADMIN_AUTHORIZATION_ROLLBACK");
const sessionRequired = {
  authorized: false,
  status: 401,
  error: "ADMIN_SESSION_REQUIRED",
};
const permissionDenied = {
  authorized: false,
  status: 403,
  error: "ADMIN_PERMISSION_DENIED",
};

try {
  const before = await databaseCounts();

  assert.deepEqual(before, {
    adminUsers: 0,
    adminSessions: 0,
    businessRows: 237,
  });

  let invalidCookieDatabaseCalls = 0;
  const rejectUnexpectedDatabaseCall = async () => {
    invalidCookieDatabaseCalls += 1;
    throw new Error("INVALID_COOKIE_REACHED_DATABASE");
  };

  for (const cookieHeader of [
    undefined,
    null,
    "",
    "theme=dark",
    "menu_admin_session=short",
    `menu_admin_session=${createSessionToken().token}; menu_admin_session=${createSessionToken().token}`,
  ]) {
    assert.deepEqual(
      await authorizeAdminRequest(
        cookieHeader,
        "MENU_READ",
        {
          findActiveSession:
            rejectUnexpectedDatabaseCall,
        },
      ),
      sessionRequired,
    );
  }
  assert.equal(invalidCookieDatabaseCalls, 0);

  await assert.rejects(
    prisma.$transaction(
      async (transaction) => {
        const users = await Promise.all([
          transaction.adminUser.create({
            data: {
              email: "authorization.owner@example.invalid",
              displayName: "授权回滚测试所有者",
              passwordHash: "TEST_HASH_NOT_FOR_LOGIN",
              role: AdminRole.OWNER,
              status: AdminStatus.ACTIVE,
            },
          }),
          transaction.adminUser.create({
            data: {
              email: "authorization.editor@example.invalid",
              displayName: "授权回滚测试编辑者",
              passwordHash: "TEST_HASH_NOT_FOR_LOGIN",
              role: AdminRole.EDITOR,
              status: AdminStatus.ACTIVE,
            },
          }),
          transaction.adminUser.create({
            data: {
              email: "authorization.viewer@example.invalid",
              displayName: "授权回滚测试查看者",
              passwordHash: "TEST_HASH_NOT_FOR_LOGIN",
              role: AdminRole.VIEWER,
              status: AdminStatus.ACTIVE,
            },
          }),
        ]);
        const sessions = await Promise.all(
          users.map((user) =>
            createAdminSessionInTransaction(
              transaction,
              user.id,
              BASE_TIME,
            ),
          ),
        );
        const sessionByRole = {
          OWNER: sessions[0],
          EDITOR: sessions[1],
          VIEWER: sessions[2],
        } as const;
        let activeSessionDatabaseCalls = 0;
        const findTransactionSession =
          async (token: string) => {
            activeSessionDatabaseCalls += 1;
            return findActiveAdminSession(token, {
              database: transaction,
              now: LOOKUP_TIME,
            });
          };

        const unknownToken =
          createSessionToken().token;
        assert.deepEqual(
          await authorizeAdminRequest(
            `menu_admin_session=${unknownToken}`,
            "MENU_READ",
            {
              findActiveSession:
                findTransactionSession,
            },
          ),
          sessionRequired,
        );

        for (const role of [
          "OWNER",
          "EDITOR",
          "VIEWER",
        ] as const) {
          const roleSession = sessionByRole[role];
          assert.ok(roleSession);

          for (const permission of ADMIN_PERMISSIONS) {
            const result = await authorizeAdminRequest(
              `menu_admin_session=${roleSession.token}`,
              permission,
              {
                findActiveSession:
                  findTransactionSession,
              },
            );
            const shouldAuthorize =
              ADMIN_PERMISSION_SETTINGS
                .rolePermissions[role]
                .includes(permission);

            if (shouldAuthorize) {
              assert.equal(result.authorized, true);

              if (result.authorized) {
                assert.equal(
                  result.session.user.role,
                  role,
                );
                const safeResult = JSON.stringify(result);
                assert.equal(
                  safeResult.includes(roleSession.token),
                  false,
                );
                assert.equal(
                  safeResult.includes("tokenHash"),
                  false,
                );
                assert.equal(
                  safeResult.includes("passwordHash"),
                  false,
                );
              }
            } else {
              assert.deepEqual(
                result,
                permissionDenied,
              );
              assert.equal("session" in result, false);
            }
          }
        }

        assert.deepEqual(
          await authorizeAdminRequest(
            `menu_admin_session=${sessionByRole.OWNER.token}`,
            "UNKNOWN_PERMISSION" as AdminPermission,
            {
              findActiveSession:
                findTransactionSession,
            },
          ),
          permissionDenied,
        );

        await revokeAdminSession(
          sessionByRole.VIEWER.token,
          {
            database: transaction,
            now: LOOKUP_TIME,
          },
        );
        assert.deepEqual(
          await authorizeAdminRequest(
            `menu_admin_session=${sessionByRole.VIEWER.token}`,
            "MENU_READ",
            {
              findActiveSession:
                findTransactionSession,
            },
          ),
          sessionRequired,
        );

        await transaction.adminUser.update({
          where: {
            id: users[1].id,
          },
          data: {
            status: AdminStatus.DISABLED,
          },
        });
        assert.deepEqual(
          await authorizeAdminRequest(
            `menu_admin_session=${sessionByRole.EDITOR.token}`,
            "MENU_READ",
            {
              findActiveSession:
                findTransactionSession,
            },
          ),
          sessionRequired,
        );

        await transaction.adminUser.update({
          where: {
            id: users[0].id,
          },
          data: {
            lockedUntil: new Date(
              LOOKUP_TIME.getTime() + 60_000,
            ),
          },
        });
        assert.deepEqual(
          await authorizeAdminRequest(
            `menu_admin_session=${sessionByRole.OWNER.token}`,
            "MENU_READ",
            {
              findActiveSession:
                findTransactionSession,
            },
          ),
          sessionRequired,
        );

        assert.ok(activeSessionDatabaseCalls > 0);
        throw forcedRollbackError;
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 30_000,
      },
    ),
    (error: unknown) => error === forcedRollbackError,
  );

  const after = await databaseCounts();
  assert.deepEqual(after, before);

  const source = fs.readFileSync(
    "src/server/auth/admin-authorization.ts",
    "utf8",
  );
  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /node:/);
  assert.doesNotMatch(source, /console\./);

  console.log("administrator authorization guard: passed");
  console.log("invalid cookie before database lookup: passed");
  console.log("missing/unknown/inactive session: unified 401");
  console.log("valid session without permission: 403");
  console.log("OWNER/EDITOR/VIEWER permission matrix: passed");
  console.log("authorized result excludes token/hash/password: passed");
  console.log(
    `AdminUser rows before/after: ${before.adminUsers}/${after.adminUsers}`,
  );
  console.log(
    `AdminSession rows before/after: ${before.adminSessions}/${after.adminSessions}`,
  );
  console.log(
    `business rows before/after: ${before.businessRows}/${after.businessRows}`,
  );
  console.log("transaction committed: no");
} finally {
  await prisma.$disconnect();
}
