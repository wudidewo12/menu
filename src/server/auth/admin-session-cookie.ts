import "server-only";

import {
  ADMIN_SESSION_SETTINGS,
} from "./admin-session-settings";
import {
  InvalidSessionTokenError,
  hashSessionToken,
} from "./session-token";

export const ADMIN_SESSION_COOKIE_SETTINGS = Object.freeze({
  name: "menu_admin_session",
  path: "/",
  httpOnly: true,
  sameSite: "Strict",
  maxAgeSeconds:
    ADMIN_SESSION_SETTINGS.absoluteLifetimeMs / 1_000,
  clearedExpires: "Thu, 01 Jan 1970 00:00:00 GMT",
});

export type AdminSessionCookieMode =
  | "development"
  | "production";

export class InvalidAdminSessionCookieModeError extends Error {
  readonly code = "INVALID_ADMIN_SESSION_COOKIE_MODE";

  constructor() {
    super("会话Cookie运行模式无效");
    this.name = "InvalidAdminSessionCookieModeError";
  }
}

function requireCookieMode(
  mode: unknown,
): AdminSessionCookieMode {
  if (mode !== "development" && mode !== "production") {
    throw new InvalidAdminSessionCookieModeError();
  }

  return mode;
}

function cookieAttributes(
  modeInput: unknown,
  maxAgeSeconds: number,
  additionalAttributes: string[] = [],
): string[] {
  const mode = requireCookieMode(modeInput);
  const attributes = [
    `Path=${ADMIN_SESSION_COOKIE_SETTINGS.path}`,
    "HttpOnly",
    `SameSite=${ADMIN_SESSION_COOKIE_SETTINGS.sameSite}`,
    `Max-Age=${maxAgeSeconds}`,
    ...additionalAttributes,
  ];

  if (mode === "production") {
    attributes.push("Secure");
  }

  return attributes;
}

function validToken(token: unknown): token is string {
  try {
    hashSessionToken(token);
    return true;
  } catch (error) {
    if (error instanceof InvalidSessionTokenError) {
      return false;
    }

    throw error;
  }
}

export function serializeAdminSessionCookie(
  token: unknown,
  mode: unknown,
): string {
  if (!validToken(token)) {
    throw new InvalidSessionTokenError();
  }

  return [
    `${ADMIN_SESSION_COOKIE_SETTINGS.name}=${token}`,
    ...cookieAttributes(
      mode,
      ADMIN_SESSION_COOKIE_SETTINGS.maxAgeSeconds,
    ),
  ].join("; ");
}

export function serializeClearedAdminSessionCookie(
  mode: unknown,
): string {
  return [
    `${ADMIN_SESSION_COOKIE_SETTINGS.name}=`,
    ...cookieAttributes(mode, 0, [
      `Expires=${ADMIN_SESSION_COOKIE_SETTINGS.clearedExpires}`,
    ]),
  ].join("; ");
}

export function readAdminSessionToken(
  cookieHeader: unknown,
): string | null {
  if (typeof cookieHeader !== "string" || !cookieHeader) {
    return null;
  }

  const matchingValues: string[] = [];

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const name = part.slice(0, separatorIndex).trim();

    if (name !== ADMIN_SESSION_COOKIE_SETTINGS.name) {
      continue;
    }

    matchingValues.push(
      part.slice(separatorIndex + 1).trim(),
    );
  }

  if (
    matchingValues.length !== 1 ||
    !validToken(matchingValues[0])
  ) {
    return null;
  }

  return matchingValues[0] ?? null;
}
