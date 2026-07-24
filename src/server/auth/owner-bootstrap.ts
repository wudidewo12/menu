import "server-only";

import { Prisma } from "../../generated/prisma/client";
import {
  AdminRole,
  AdminStatus,
} from "../../generated/prisma/enums";
import { prisma } from "../db/prisma";
import {
  buildInitialOwnerPlan,
  initialOwnerPasswordContext,
  type InitialOwnerPlan,
} from "./owner-bootstrap-plan";
import { hashPassword } from "./password";

export const INITIAL_OWNER_ADVISORY_LOCK = Object.freeze({
  // 0x4d454e55 = "MENU", 0x4f574e52 = "OWNER"
  namespace: 0x4d45_4e55,
  key: 0x4f57_4e52,
});

export interface InitialOwnerCreationResult {
  created: true;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: "OWNER";
    status: "ACTIVE";
    passwordChangedAt: Date;
    createdAt: Date;
  };
}

export interface InitialOwnerCreationOptions {
  /**
   * 仅供回滚测试使用。正式初始化命令不能设置此钩子。
   */
  beforeCommit?: (
    result: InitialOwnerCreationResult,
    transaction: Prisma.TransactionClient,
  ) => void | Promise<void>;
}

export class InitialOwnerAlreadyExistsError extends Error {
  readonly code = "INITIAL_OWNER_ALREADY_EXISTS";

  constructor() {
    super("管理员账号已经初始化，不能再次创建首次 OWNER");
    this.name = "InitialOwnerAlreadyExistsError";
  }
}

function readPassword(input: unknown): string {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    typeof (input as Record<string, unknown>).password !== "string"
  ) {
    throw new Error("Validated OWNER input did not contain a password");
  }

  return (input as Record<string, string>).password;
}

export async function acquireInitialOwnerBootstrapLock(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  const rows = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT TRUE AS acquired
    FROM (
      SELECT pg_advisory_xact_lock(
        ${INITIAL_OWNER_ADVISORY_LOCK.namespace},
        ${INITIAL_OWNER_ADVISORY_LOCK.key}
      )
    ) AS owner_bootstrap_lock
  `;

  if (rows[0]?.acquired !== true) {
    throw new Error("Failed to acquire the initial OWNER bootstrap lock");
  }
}

export async function assertInitialOwnerBootstrapAvailable(
  transaction: Prisma.TransactionClient,
): Promise<void> {
  const adminUserCount = await transaction.adminUser.count();

  if (adminUserCount !== 0) {
    throw new InitialOwnerAlreadyExistsError();
  }
}

export async function createInitialOwner(
  input: unknown,
  options: InitialOwnerCreationOptions = {},
): Promise<InitialOwnerCreationResult> {
  const plan: InitialOwnerPlan = buildInitialOwnerPlan(input);
  const password = readPassword(input);

  return prisma.$transaction(
    async (transaction) => {
      await acquireInitialOwnerBootstrapLock(transaction);
      await assertInitialOwnerBootstrapAvailable(transaction);

      const passwordHash = await hashPassword(
        password,
        initialOwnerPasswordContext(plan.email, plan.displayName),
      );
      const user = await transaction.adminUser.create({
        data: {
          email: plan.email,
          displayName: plan.displayName,
          passwordHash,
          role: AdminRole.OWNER,
          status: AdminStatus.ACTIVE,
        },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          status: true,
          passwordChangedAt: true,
          createdAt: true,
        },
      });
      const result: InitialOwnerCreationResult = {
        created: true,
        user: {
          ...user,
          role: "OWNER",
          status: "ACTIVE",
        },
      };

      await options.beforeCommit?.(result, transaction);

      return result;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 30_000,
    },
  );
}
