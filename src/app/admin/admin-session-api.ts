export type AdminRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export interface AdminLoginInput {
  email: string;
  password: string;
}

export interface AdminAuthenticatedSession {
  authenticated: true;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: AdminRole;
    status: 'ACTIVE';
  };
  session: {
    id: string;
    expiresAt: string;
    lastSeenAt: string;
    createdAt: string;
  };
}

export interface AdminSignedOutSession {
  authenticated: false;
}

export class AdminSessionApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(
      status > 0
        ? `管理员会话请求失败（${status}）`
        : '无法连接管理员会话服务',
    );
    this.name = 'AdminSessionApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(
  source: Record<string, unknown>,
  key: string,
): string {
  const value = source[key];

  if (typeof value !== 'string' || !value) {
    throw new AdminSessionApiError(502, 'ADMIN_SESSION_RESPONSE_INVALID');
  }

  return value;
}

function requiredTimestamp(
  source: Record<string, unknown>,
  key: string,
): string {
  const value = requiredString(source, key);

  if (Number.isNaN(Date.parse(value))) {
    throw new AdminSessionApiError(502, 'ADMIN_SESSION_RESPONSE_INVALID');
  }

  return value;
}

function requiredRole(value: unknown): AdminRole {
  if (value === 'OWNER' || value === 'EDITOR' || value === 'VIEWER') {
    return value;
  }

  throw new AdminSessionApiError(502, 'ADMIN_SESSION_RESPONSE_INVALID');
}

function parseAuthenticatedSession(
  payload: unknown,
): AdminAuthenticatedSession {
  if (!isRecord(payload) || payload.authenticated !== true) {
    throw new AdminSessionApiError(502, 'ADMIN_SESSION_RESPONSE_INVALID');
  }

  const user = payload.user;
  const session = payload.session;

  if (!isRecord(user) || !isRecord(session) || user.status !== 'ACTIVE') {
    throw new AdminSessionApiError(502, 'ADMIN_SESSION_RESPONSE_INVALID');
  }

  return {
    authenticated: true,
    user: {
      id: requiredString(user, 'id'),
      email: requiredString(user, 'email'),
      displayName: requiredString(user, 'displayName'),
      role: requiredRole(user.role),
      status: 'ACTIVE',
    },
    session: {
      id: requiredString(session, 'id'),
      expiresAt: requiredTimestamp(session, 'expiresAt'),
      lastSeenAt: requiredTimestamp(session, 'lastSeenAt'),
      createdAt: requiredTimestamp(session, 'createdAt'),
    },
  };
}

function parseSignedOutSession(payload: unknown): AdminSignedOutSession {
  if (!isRecord(payload) || payload.authenticated !== false) {
    throw new AdminSessionApiError(502, 'ADMIN_SESSION_RESPONSE_INVALID');
  }

  return {
    authenticated: false,
  };
}

async function errorCode(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null);

  return isRecord(payload) && typeof payload.error === 'string'
    ? payload.error
    : 'ADMIN_SESSION_REQUEST_FAILED';
}

async function requestAdminSession(
  init: RequestInit,
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch('/api/admin/session', {
      ...init,
      credentials: 'same-origin',
    });
  } catch {
    throw new AdminSessionApiError(0, 'ADMIN_SESSION_NETWORK_ERROR');
  }

  if (!response.ok) {
    throw new AdminSessionApiError(
      response.status,
      await errorCode(response),
    );
  }

  try {
    return await response.json();
  } catch {
    throw new AdminSessionApiError(502, 'ADMIN_SESSION_RESPONSE_INVALID');
  }
}

export async function loginAdminSession(
  input: AdminLoginInput,
): Promise<AdminAuthenticatedSession> {
  const payload = await requestAdminSession({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return parseAuthenticatedSession(payload);
}

export async function fetchAdminSession(): Promise<AdminAuthenticatedSession> {
  const payload = await requestAdminSession({
    method: 'GET',
    cache: 'no-store',
  });

  return parseAuthenticatedSession(payload);
}

export async function logoutAdminSession(): Promise<AdminSignedOutSession> {
  const payload = await requestAdminSession({
    method: 'DELETE',
  });

  return parseSignedOutSession(payload);
}
