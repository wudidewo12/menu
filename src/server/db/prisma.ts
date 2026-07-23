import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client";

type PrismaGlobal = typeof globalThis & {
  __menuPrisma?: PrismaClient;
};

function requireEnvironmentVariable(name: "DATABASE_URL" | "POSTGRES_APP_USER") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }

  return value;
}

function createPrismaClient() {
  const connectionString = requireEnvironmentVariable("DATABASE_URL");
  const expectedRole = requireEnvironmentVariable("POSTGRES_APP_USER");
  const databaseUrl = new URL(connectionString);
  const connectionRole = decodeURIComponent(databaseUrl.username);

  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol");
  }

  if (connectionRole !== expectedRole) {
    throw new Error("DATABASE_URL must use the configured application database role");
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({ adapter });
}

const prismaGlobal = globalThis as PrismaGlobal;

export const prisma = prismaGlobal.__menuPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.__menuPrisma = prisma;
}
