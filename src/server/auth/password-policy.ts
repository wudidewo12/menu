import "server-only";

export const PASSWORD_POLICY_SETTINGS = Object.freeze({
  minimumCharacters: 15,
  maximumCharacters: 128,
  unicodeNormalization: "NFC",
  requiresCharacterMix: false,
});

export type PasswordPolicyIssueCode =
  | "PASSWORD_REQUIRED"
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_HAS_CONTROL_CHARACTERS"
  | "PASSWORD_BLOCKED";

export interface PasswordPolicyIssue {
  code: PasswordPolicyIssueCode;
  message: string;
}

export interface PasswordPolicyResult {
  isValid: boolean;
  characterCount: number;
  issues: PasswordPolicyIssue[];
}

export interface PasswordPolicyContext {
  /**
   * 调用方可以传入邮箱、显示名和服务名的完整变体。
   * 这里只做整条密码匹配，不扫描或记录密码片段。
   */
  blockedValues?: readonly string[];
}

export class PasswordPolicyValidationError extends Error {
  readonly code = "PASSWORD_POLICY_FAILED";

  constructor(readonly issues: PasswordPolicyIssue[]) {
    super(issues.map((issue) => issue.message).join("\n"));
    this.name = "PasswordPolicyValidationError";
  }
}

const BASELINE_BLOCKED_PASSWORDS = new Set([
  "password",
  "password123",
  "passwordpassword",
  "123456789012345",
  "qwertyqwertyqwerty",
  "adminadminadmin",
  "administrator123",
  "letmeinletmein",
  "menuadminpassword",
  "menu-menu-menu-menu",
]);

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export function normalizePasswordForAuthentication(password: string): string {
  return password.normalize(PASSWORD_POLICY_SETTINGS.unicodeNormalization);
}

function passwordComparisonValue(password: string): string {
  return normalizePasswordForAuthentication(password).toLowerCase();
}

function blockedPassword(
  normalizedPassword: string,
  context: PasswordPolicyContext,
): boolean {
  const comparisonValue = normalizedPassword.toLowerCase();

  if (BASELINE_BLOCKED_PASSWORDS.has(comparisonValue)) {
    return true;
  }

  return (context.blockedValues ?? []).some(
    (value) => passwordComparisonValue(value) === comparisonValue,
  );
}

export function validatePasswordPolicy(
  password: unknown,
  context: PasswordPolicyContext = {},
): PasswordPolicyResult {
  if (typeof password !== "string" || password.length === 0) {
    return {
      isValid: false,
      characterCount: 0,
      issues: [
        {
          code: "PASSWORD_REQUIRED",
          message: "请输入密码",
        },
      ],
    };
  }

  const normalizedPassword = normalizePasswordForAuthentication(password);
  const characterCount = Array.from(normalizedPassword).length;
  const issues: PasswordPolicyIssue[] = [];

  if (characterCount < PASSWORD_POLICY_SETTINGS.minimumCharacters) {
    issues.push({
      code: "PASSWORD_TOO_SHORT",
      message: `密码至少需要 ${PASSWORD_POLICY_SETTINGS.minimumCharacters} 个字符`,
    });
  }

  if (characterCount > PASSWORD_POLICY_SETTINGS.maximumCharacters) {
    issues.push({
      code: "PASSWORD_TOO_LONG",
      message: `密码最多允许 ${PASSWORD_POLICY_SETTINGS.maximumCharacters} 个字符`,
    });
  }

  if (CONTROL_CHARACTER_PATTERN.test(normalizedPassword)) {
    issues.push({
      code: "PASSWORD_HAS_CONTROL_CHARACTERS",
      message: "密码不能包含换行、制表符等控制字符",
    });
  }

  if (blockedPassword(normalizedPassword, context)) {
    issues.push({
      code: "PASSWORD_BLOCKED",
      message: "这个密码过于常见或与账号信息过于接近，请换一个",
    });
  }

  return {
    isValid: issues.length === 0,
    characterCount,
    issues,
  };
}

export function preparePasswordForHashing(
  password: unknown,
  context: PasswordPolicyContext = {},
): string {
  const result = validatePasswordPolicy(password, context);

  if (!result.isValid || typeof password !== "string") {
    throw new PasswordPolicyValidationError(result.issues);
  }

  return normalizePasswordForAuthentication(password);
}
