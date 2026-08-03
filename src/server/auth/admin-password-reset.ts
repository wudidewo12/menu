import "server-only";

import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../db/prisma";
import {
  AdminPasswordResetPlanError,
  adminPasswordResetContext,
  buildAdminPasswordResetPlan,
  type AdminPasswordResetIssue,
} from "./admin-password-reset-plan";
import {
  validatePasswordPolicy,
} from "./password-policy";
import { hashPassword } from "./password";

export interface AdminPasswordResetResult {
  reset: true;
  user: {
    email: string;
    displayName: string;
    role: "OWNER" | "EDITOR" | "VIEWER";
    status: "ACTIVE" | "DISABLED";
    passwordChangedAt: Date;
    updatedAt: Date;
  };
  password: {
    storedAs: "ARGON2ID_HASH_ONLY";
  };
  sessionsRevoked: number;
}

interface AdminPasswordResetOperationOptions {
  now?: Date;
}

export class AdminPasswordResetUserNotFoundError extends Error {
  readonly code = "ADMIN_PASSWORD_RESET_USER_NOT_FOUND";

  constructor() {
    super("没有找到这个管理员账号");
    this.name = "AdminPasswordResetUserNotFoundError";
  }
}

function readPassword(input: unknown): string {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    typeof (input as Record<string, unknown>).password !== "string"
  ) {
    throw new Error(
      "Validated administrator password reset input did not contain a password",
    );
  }

  return (input as Record<string, string>).password;
}

function requireOperationTime(now: Date | undefined): Date {
  const operationTime = now ?? new Date();

  if (Number.isNaN(operationTime.getTime())) {
    throw new TypeError("密码重置时间无效");
  }

  return operationTime;
}

function passwordIssuesWithAccountContext(
  password: string,
  email: string,
  displayName: string,
): AdminPasswordResetIssue[] {
  return validatePasswordPolicy(
    password,
    adminPasswordResetContext(email, displayName),
  ).issues.map((issue) => ({
    field: "password",
    code: issue.code,
    message: issue.message,
  }));
}

export async function resetAdminPasswordInTransaction(
  transaction: Prisma.TransactionClient,
  input: unknown,
  options: AdminPasswordResetOperationOptions = {},
): Promise<AdminPasswordResetResult> {
  const plan = buildAdminPasswordResetPlan(input);
  const password = readPassword(input);
  const now = requireOperationTime(options.now);
  const existingUser = await transaction.adminUser.findUnique({
    where: {
      email: plan.email,
    },
    select: {
      id: true,
      email: true,
      displayName: true,
    },
  });

  if (!existingUser) {
    throw new AdminPasswordResetUserNotFoundError();
  }

  const accountContextIssues = passwordIssuesWithAccountContext(
    password,
    existingUser.email,
    existingUser.displayName,
  );

  if (accountContextIssues.length > 0) {
    throw new AdminPasswordResetPlanError(accountContextIssues);
  }

  const passwordHash = await hashPassword(
    password,
    adminPasswordResetContext(
      existingUser.email,
      existingUser.displayName,
    ),
  );
  const [user, revokedSessions] = await Promise.all([
    transaction.adminUser.update({
      where: {
        id: existingUser.id,
      },
      data: {
        passwordHash,
        passwordChangedAt: now,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
      select: {
        email: true,
        displayName: true,
        role: true,
        status: true,
        passwordChangedAt: true,
        updatedAt: true,
      },
    }),
    transaction.adminSession.updateMany({
      where: {
        userId: existingUser.id,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    }),
  ]);

  return {
    reset: true,
    user,
    password: {
      storedAs: "ARGON2ID_HASH_ONLY",
    },
    sessionsRevoked: revokedSessions.count,
  };
}

export async function resetAdminPassword(
  input: unknown,
): Promise<AdminPasswordResetResult> {
  buildAdminPasswordResetPlan(input);

  return prisma.$transaction(
    (transaction) =>
      resetAdminPasswordInTransaction(transaction, input),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 30_000,
    },
  );
}
