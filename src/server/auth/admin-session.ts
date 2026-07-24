import "server-only";

import { Prisma } from "../../generated/prisma/client";
import {
  AdminStatus,
} from "../../generated/prisma/enums";
import { prisma } from "../db/prisma";
import {
  ADMIN_SESSION_SETTINGS,
} from "./admin-session-settings";
import {
  InvalidSessionTokenError,
  createSessionToken,
  hashSessionToken,
} from "./session-token";

export {
  ADMIN_SESSION_SETTINGS,
} from "./admin-session-settings";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AdminSessionDatabase = Pick<
  Prisma.TransactionClient,
  "adminUser" | "adminSession"
>;

export interface CreatedAdminSession {
  /**
   * 只交给浏览器Cookie一次，不能保存到数据库或日志。
   */
  token: string;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    lastSeenAt: Date;
    createdAt: Date;
  };
}

export interface ActiveAdminSession {
  id: string;
  expiresAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: "OWNER" | "EDITOR" | "VIEWER";
    status: "ACTIVE";
  };
}

interface SessionDatabaseOptions {
  database?: AdminSessionDatabase;
  now?: Date;
}

export class InvalidAdminSessionUserIdError extends Error {
  readonly code = "INVALID_ADMIN_SESSION_USER_ID";

  constructor() {
    super("管理员用户ID格式无效");
    this.name = "InvalidAdminSessionUserIdError";
  }
}

export class AdminSessionUserUnavailableError extends Error {
  readonly code = "ADMIN_SESSION_USER_UNAVAILABLE";

  constructor() {
    super("管理员账号不存在、已停用或当前被锁定");
    this.name = "AdminSessionUserUnavailableError";
  }
}

function requireUserId(userId: unknown): string {
  if (
    typeof userId !== "string" ||
    !UUID_PATTERN.test(userId)
  ) {
    throw new InvalidAdminSessionUserIdError();
  }

  return userId;
}

function requireOperationTime(now: Date | undefined): Date {
  const operationTime = now ?? new Date();

  if (Number.isNaN(operationTime.getTime())) {
    throw new TypeError("会话操作时间无效");
  }

  return operationTime;
}

function isInvalidSessionToken(error: unknown): boolean {
  return error instanceof InvalidSessionTokenError;
}

export async function createAdminSessionInTransaction(
  transaction: Prisma.TransactionClient,
  userIdInput: unknown,
  nowInput?: Date,
): Promise<CreatedAdminSession> {
  const userId = requireUserId(userIdInput);
  const now = requireOperationTime(nowInput);
  const user = await transaction.adminUser.findUnique({
    where: {
      id: userId,
    },
    select: {
      status: true,
      lockedUntil: true,
    },
  });

  if (
    !user ||
    user.status !== AdminStatus.ACTIVE ||
    (user.lockedUntil !== null && user.lockedUntil > now)
  ) {
    throw new AdminSessionUserUnavailableError();
  }

  const { token, tokenHash } = createSessionToken();
  const expiresAt = new Date(
    now.getTime() + ADMIN_SESSION_SETTINGS.absoluteLifetimeMs,
  );
  const session = await transaction.adminSession.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      lastSeenAt: now,
    },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });

  return {
    token,
    session,
  };
}

export async function createAdminSession(
  userId: unknown,
): Promise<CreatedAdminSession> {
  return prisma.$transaction((transaction) =>
    createAdminSessionInTransaction(transaction, userId),
  );
}

export async function findActiveAdminSession(
  token: unknown,
  options: SessionDatabaseOptions = {},
): Promise<ActiveAdminSession | null> {
  const database = options.database ?? prisma;
  const now = requireOperationTime(options.now);
  let tokenHash: string;

  try {
    tokenHash = hashSessionToken(token);
  } catch (error) {
    if (isInvalidSessionToken(error)) {
      return null;
    }

    throw error;
  }

  const session = await database.adminSession.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: {
        gt: now,
      },
      user: {
        is: {
          status: AdminStatus.ACTIVE,
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
    },
    select: {
      id: true,
      expiresAt: true,
      lastSeenAt: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          status: true,
        },
      },
    },
  });

  if (!session || session.user.status !== AdminStatus.ACTIVE) {
    return null;
  }

  return {
    ...session,
    user: {
      ...session.user,
      status: "ACTIVE",
    },
  };
}

export async function revokeAdminSession(
  token: unknown,
  options: SessionDatabaseOptions = {},
): Promise<boolean> {
  const database = options.database ?? prisma;
  const now = requireOperationTime(options.now);
  let tokenHash: string;

  try {
    tokenHash = hashSessionToken(token);
  } catch (error) {
    if (isInvalidSessionToken(error)) {
      return false;
    }

    throw error;
  }

  const result = await database.adminSession.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt: now,
    },
  });

  return result.count === 1;
}
