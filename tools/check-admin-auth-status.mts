import fs from 'node:fs';

import dotenv from 'dotenv';

const localEnvironment = dotenv.parse(fs.readFileSync('.env.local'));
const databaseUrl = localEnvironment.DATABASE_URL;
const applicationRole = localEnvironment.POSTGRES_APP_USER;

if (!databaseUrl || !applicationRole) {
  throw new Error(
    'DATABASE_URL and POSTGRES_APP_USER are required in .env.local',
  );
}

process.env.DATABASE_URL = databaseUrl;
process.env.POSTGRES_APP_USER = applicationRole;

delete process.env.DATABASE_ADMIN_URL;
delete process.env.POSTGRES_OWNER;
delete process.env.POSTGRES_OWNER_PASSWORD;
delete process.env.POSTGRES_APP_PASSWORD;

const { prisma } = await import('../src/server/db/prisma.ts');

try {
  const identityRows = await prisma.$queryRaw<
    Array<{
      roleName: string;
      canCreateInSchema: boolean;
    }>
  >`
    SELECT
      current_user AS "roleName",
      has_schema_privilege(
        current_user,
        'public',
        'CREATE'
      ) AS "canCreateInSchema"
  `;
  const identity = identityRows[0];

  if (
    !identity
    || identity.roleName !== applicationRole
    || identity.canCreateInSchema
  ) {
    throw new Error(
      'Authentication status must use the low-privilege runtime role',
    );
  }

  const now = new Date();
  const [
    adminUsers,
    activeAdminUsers,
    activeOwners,
    adminSessions,
    activeSessions,
  ] = await Promise.all([
    prisma.adminUser.count(),
    prisma.adminUser.count({
      where: {
        status: 'ACTIVE',
      },
    }),
    prisma.adminUser.count({
      where: {
        role: 'OWNER',
        status: 'ACTIVE',
      },
    }),
    prisma.adminSession.count(),
    prisma.adminSession.count({
      where: {
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
        user: {
          status: 'ACTIVE',
          OR: [
            {
              lockedUntil: null,
            },
            {
              lockedUntil: {
                lte: now,
              },
            },
          ],
        },
      },
    }),
  ]);

  console.log('administrator authentication status: checked');
  console.log('database role: low privilege');
  console.log(`administrator users: ${adminUsers}`);
  console.log(`active administrator users: ${activeAdminUsers}`);
  console.log(`active owners: ${activeOwners}`);
  console.log(`stored sessions: ${adminSessions}`);
  console.log(`active sessions: ${activeSessions}`);
  console.log(
    activeOwners > 0
      ? 'session UI activation: ready'
      : 'session UI activation: blocked (initial owner required)',
  );
  console.log('credential/account/session details printed: 0');
  console.log('database writes: 0');
} finally {
  await prisma.$disconnect();
}
