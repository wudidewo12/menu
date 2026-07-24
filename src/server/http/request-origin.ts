import "server-only";

export const REQUEST_ORIGIN_SETTINGS = Object.freeze({
  allowedProtocols: Object.freeze(
    ["http:", "https:"] as const,
  ),
});

export class InvalidAllowedOriginError extends Error {
  readonly code = "INVALID_ALLOWED_ORIGIN";

  constructor() {
    super("允许的站点来源配置无效");
    this.name = "InvalidAllowedOriginError";
  }
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function parseHttpOrigin(candidate: string): URL | null {
  if (
    !candidate ||
    candidate === "null" ||
    candidate.includes("*") ||
    candidate.includes(",") ||
    CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (
    !REQUEST_ORIGIN_SETTINGS.allowedProtocols.includes(
      parsed.protocol as "http:" | "https:",
    ) ||
    parsed.origin === "null" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    return null;
  }

  return parsed;
}

/**
 * 规范化服务器配置的唯一允许来源。
 * 配置错误必须抛出，让服务器失败关闭，而不是意外放行请求。
 */
export function normalizeAllowedOrigin(input: unknown): string {
  if (typeof input !== "string") {
    throw new InvalidAllowedOriginError();
  }

  const parsed = parseHttpOrigin(input.trim());

  if (!parsed) {
    throw new InvalidAllowedOriginError();
  }

  return parsed.origin;
}

function normalizeRequestOrigin(input: unknown): string | null {
  if (
    typeof input !== "string" ||
    input !== input.trim()
  ) {
    return null;
  }

  const parsed = parseHttpOrigin(input);

  if (!parsed) {
    return null;
  }

  const authorityStart = input.indexOf("://") + 3;

  if (
    authorityStart < 3 ||
    input.slice(authorityStart).includes("/")
  ) {
    return null;
  }

  return parsed.origin;
}

/**
 * 检查浏览器Origin请求头是否与服务器允许的来源完全同源。
 * 域名大小写和默认端口按URL标准规范化后比较。
 */
export function hasAllowedRequestOrigin(
  originHeader: unknown,
  allowedOriginInput: unknown,
): boolean {
  const allowedOrigin =
    normalizeAllowedOrigin(allowedOriginInput);
  const requestOrigin = normalizeRequestOrigin(originHeader);

  return requestOrigin === allowedOrigin;
}
