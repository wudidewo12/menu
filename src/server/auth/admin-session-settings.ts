import "server-only";

export const ADMIN_SESSION_SETTINGS = Object.freeze({
  absoluteLifetimeHours: 8,
  absoluteLifetimeMs: 8 * 60 * 60 * 1_000,
});
