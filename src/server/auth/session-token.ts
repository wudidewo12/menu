import "server-only";

import {
  createHash,
  randomBytes,
} from "node:crypto";

export const SESSION_TOKEN_SETTINGS = Object.freeze({
  randomBytes: 32,
  entropyBits: 256,
  encoding: "base64url",
  tokenCharacters: 43,
  hashAlgorithm: "sha256",
  hashCharacters: 64,
});

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface NewSessionToken {
  /**
   * 只交给浏览器一次的原始令牌，不能写入数据库或日志。
   */
  token: string;
  /**
   * 保存到数据库的不可逆摘要，用它查找会话。
   */
  tokenHash: string;
}

export class InvalidSessionTokenError extends Error {
  readonly code = "INVALID_SESSION_TOKEN";

  constructor() {
    super("会话令牌格式无效");
    this.name = "InvalidSessionTokenError";
  }
}

function requireValidSessionToken(token: unknown): asserts token is string {
  if (
    typeof token !== "string" ||
    !SESSION_TOKEN_PATTERN.test(token)
  ) {
    throw new InvalidSessionTokenError();
  }
}

/**
 * 把浏览器提交的原始令牌转换成数据库查询所需的SHA-256摘要。
 */
export function hashSessionToken(token: unknown): string {
  requireValidSessionToken(token);

  return createHash(SESSION_TOKEN_SETTINGS.hashAlgorithm)
    .update(token, "utf8")
    .digest("hex");
}

/**
 * 生成一次新的256位随机会话令牌。
 * 调用方只把token交给浏览器，只把tokenHash保存到数据库。
 */
export function createSessionToken(): NewSessionToken {
  const token = randomBytes(SESSION_TOKEN_SETTINGS.randomBytes)
    .toString(SESSION_TOKEN_SETTINGS.encoding);

  return {
    token,
    tokenHash: hashSessionToken(token),
  };
}
