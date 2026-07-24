import "server-only";

import type {
  ActiveAdminSession,
} from "./admin-session";
import {
  hasAdminPermission,
  type AdminPermission,
} from "./admin-permission";
import {
  readAdminSessionToken,
} from "./admin-session-cookie";

export interface AuthorizedAdminRequest {
  authorized: true;
  session: ActiveAdminSession;
}

export interface RejectedAdminRequest {
  authorized: false;
  status: 401 | 403;
  error:
    | "ADMIN_SESSION_REQUIRED"
    | "ADMIN_PERMISSION_DENIED";
}

export type AdminAuthorizationResult =
  | AuthorizedAdminRequest
  | RejectedAdminRequest;

type ActiveSessionFinder = (
  token: string,
) => Promise<ActiveAdminSession | null>;

interface AdminAuthorizationOptions {
  findActiveSession?: ActiveSessionFinder;
}

const SESSION_REQUIRED_RESULT = Object.freeze({
  authorized: false,
  status: 401,
  error: "ADMIN_SESSION_REQUIRED",
} satisfies RejectedAdminRequest);

const PERMISSION_DENIED_RESULT = Object.freeze({
  authorized: false,
  status: 403,
  error: "ADMIN_PERMISSION_DENIED",
} satisfies RejectedAdminRequest);

async function findDefaultActiveSession(
  token: string,
): Promise<ActiveAdminSession | null> {
  const { findActiveAdminSession } =
    await import("./admin-session");

  return findActiveAdminSession(token);
}

export async function authorizeAdminRequest(
  cookieHeader: unknown,
  requiredPermission: AdminPermission,
  options: AdminAuthorizationOptions = {},
): Promise<AdminAuthorizationResult> {
  const token = readAdminSessionToken(cookieHeader);

  if (!token) {
    return SESSION_REQUIRED_RESULT;
  }

  const findActiveSession =
    options.findActiveSession ??
    findDefaultActiveSession;
  const session = await findActiveSession(token);

  if (!session) {
    return SESSION_REQUIRED_RESULT;
  }

  if (
    !hasAdminPermission(
      session.user.role,
      requiredPermission,
    )
  ) {
    return PERMISSION_DENIED_RESULT;
  }

  return {
    authorized: true,
    session,
  };
}
