import "server-only";

import { Prisma } from "../../generated/prisma/client";
import {
  AdminStatus,
} from "../../generated/prisma/enums";
import { prisma } from "../db/prisma";
import {
  createAdminSessionInTransaction,
  type CreatedAdminSession,
} from "./admin-session";
import {
  prepareAdminLoginInput,
  type AdminLoginCredentials,
} from "./login-input";
import { verifyPassword } from "./password";

export const ADMIN_LOGIN_SETTINGS = Object.freeze({
  maximumFailedAttempts: 5,
  lockDurationMinutes: 15,
  lockDurationMs: 15 * 60 * 1_000,
});

/**
 * 公开的固定假哈希，不属于任何真实账号。
 * 未知邮箱也执行一次相同参数的Argon2id验证，降低账号枚举的时间差异。
 */
const UNKNOWN_ADMIN_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$AEHg4o55UECj0odAFo5xmw$YQAG2oVvjEWB10C74fuCiIv8JMnBLNXGhVmB76uEJsY";

export interface SuccessfulAdminLogin {
  authenticated: true;
  token: string;
  session: CreatedAdminSession["session"];
  user: {
    id: string;
    email: string;
    displayName: string;
    role: "OWNER" | "EDITOR" | "VIEWER";
    status: "ACTIVE";
  };
}

export interface FailedAdminLogin {
  authenticated: false;
}

export type AdminLoginAttempt =
  | SuccessfulAdminLogin
  | FailedAdminLogin;

export class AdminLoginRejectedError extends Error {
  readonly code = "ADMIN_LOGIN_REJECTED";

  constructor() {
    super("邮箱或密码不正确，或账号当前不可用");
    this.name = "AdminLoginRejectedError";
  }
}

function requireOperationTime(now: Date | undefined): Date {
  const operationTime = now ?? new Date();

  if (
    !(operationTime instanceof Date) ||
    Number.isNaN(operationTime.getTime())
  ) {
    throw new TypeError("登录操作时间无效");
  }

  return operationTime;
}

function failedLogin(): FailedAdminLogin {
  return {
    authenticated: false,
  };
}

export async function loginAdminInTransaction(
  transaction: Prisma.TransactionClient,
  credentials: AdminLoginCredentials,
  nowInput?: Date,
): Promise<AdminLoginAttempt> {
  const now = requireOperationTime(nowInput);
  const user = await transaction.adminUser.findUnique({
    where: {
      email: credentials.email,
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      passwordHash: true,
      role: true,
      status: true,
      failedLoginAttempts: true,
      lockedUntil: true,
    },
  });

  if (!user) {
    await verifyPassword(
      credentials.password,
      UNKNOWN_ADMIN_PASSWORD_HASH,
    );

    return failedLogin();
  }

  const passwordMatches = await verifyPassword(
    credentials.password,
    user.passwordHash,
  );
  const currentlyLocked =
    user.lockedUntil !== null && user.lockedUntil > now;

  if (
    user.status !== AdminStatus.ACTIVE ||
    currentlyLocked
  ) {
    return failedLogin();
  }

  if (!passwordMatches) {
    const previousAttempts =
      user.lockedUntil !== null && user.lockedUntil <= now
        ? 0
        : user.failedLoginAttempts;
    const failedLoginAttempts = previousAttempts + 1;
    const shouldLock =
      failedLoginAttempts >=
      ADMIN_LOGIN_SETTINGS.maximumFailedAttempts;
    const lockedUntil = shouldLock
      ? new Date(
          now.getTime() + ADMIN_LOGIN_SETTINGS.lockDurationMs,
        )
      : null;

    await transaction.adminUser.update({
      where: {
        id: user.id,
      },
      data: {
        failedLoginAttempts,
        lockedUntil,
      },
    });

    return failedLogin();
  }

  await transaction.adminUser.update({
    where: {
      id: user.id,
    },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: now,
    },
  });

  const createdSession = await createAdminSessionInTransaction(
    transaction,
    user.id,
    now,
  );

  return {
    authenticated: true,
    token: createdSession.token,
    session: createdSession.session,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: "ACTIVE",
    },
  };
}

export async function loginAdmin(
  input: unknown,
): Promise<SuccessfulAdminLogin> {
  const credentials = prepareAdminLoginInput(input);
  const result = await prisma.$transaction(
    (transaction) =>
      loginAdminInTransaction(transaction, credentials),
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 30_000,
    },
  );

  if (!result.authenticated) {
    throw new AdminLoginRejectedError();
  }

  return result;
}
