import "server-only";

import {
  hash,
  verify,
  type Options,
} from "@node-rs/argon2";

import {
  normalizePasswordForAuthentication,
  preparePasswordForHashing,
  type PasswordPolicyContext,
} from "./password-policy";

export const PASSWORD_HASH_SETTINGS = Object.freeze({
  algorithm: "argon2id",
  version: 19,
  memoryCostKiB: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLength: 32,
});

// @node-rs/argon2 的类型定义中，2 代表 Argon2id，1 代表 Argon2 v19。
// 使用具名常量可兼容本项目的 isolatedModules TypeScript 设置。
const ARGON2ID_ALGORITHM = 2 satisfies NonNullable<Options["algorithm"]>;
const ARGON2_VERSION_19 = 1 satisfies NonNullable<Options["version"]>;

const ARGON2ID_OPTIONS: Options = {
  algorithm: ARGON2ID_ALGORITHM,
  version: ARGON2_VERSION_19,
  memoryCost: PASSWORD_HASH_SETTINGS.memoryCostKiB,
  timeCost: PASSWORD_HASH_SETTINGS.timeCost,
  parallelism: PASSWORD_HASH_SETTINGS.parallelism,
  outputLen: PASSWORD_HASH_SETTINGS.outputLength,
};

function hasPasswordValue(password: unknown): password is string {
  return typeof password === "string" && password.length > 0;
}

/**
 * 为准备保存到数据库的密码生成不可逆的 Argon2id 哈希。
 * 原始密码只参与本次计算，不会被这个模块保存或记录。
 */
export async function hashPassword(
  password: string,
  context: PasswordPolicyContext = {},
): Promise<string> {
  return hash(
    preparePasswordForHashing(password, context),
    ARGON2ID_OPTIONS,
  );
}

/**
 * 比较用户输入的密码和数据库中的哈希。
 * 无效或损坏的哈希按验证失败处理，不把底层解析错误暴露给登录请求。
 */
export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (!hasPasswordValue(password) || !passwordHash) {
    return false;
  }

  try {
    return await verify(
      passwordHash,
      normalizePasswordForAuthentication(password),
    );
  } catch {
    return false;
  }
}
