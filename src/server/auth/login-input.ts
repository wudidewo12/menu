import "server-only";

import {
  isValidAdminEmail,
  normalizeAdminEmail,
} from "./admin-email";
import {
  PASSWORD_POLICY_SETTINGS,
  normalizePasswordForAuthentication,
} from "./password-policy";

export type AdminLoginField = "email" | "password";

export type AdminLoginIssueCode =
  | "EMAIL_REQUIRED"
  | "EMAIL_INVALID"
  | "PASSWORD_REQUIRED"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_HAS_CONTROL_CHARACTERS";

export interface AdminLoginIssue {
  field: AdminLoginField;
  code: AdminLoginIssueCode;
  message: string;
}

export interface AdminLoginValidation {
  isValid: boolean;
  email: string;
  passwordCharacterCount: number;
  issues: AdminLoginIssue[];
}

export interface AdminLoginCredentials {
  email: string;
  /**
   * 只在服务端内存中交给Argon2id验证，不能记录或返回给前端。
   */
  password: string;
}

export class AdminLoginInputError extends Error {
  readonly code = "ADMIN_LOGIN_INPUT_INVALID";

  constructor(readonly issues: AdminLoginIssue[]) {
    super(issues.map((issue) => issue.message).join("\n"));
    this.name = "AdminLoginInputError";
  }
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateAdminLoginInput(
  input: unknown,
): AdminLoginValidation {
  const source = isRecord(input) ? input : {};
  const email = normalizeAdminEmail(source.email);
  const password =
    typeof source.password === "string"
      ? normalizePasswordForAuthentication(source.password)
      : "";
  const passwordCharacterCount = Array.from(password).length;
  const issues: AdminLoginIssue[] = [];

  if (!email) {
    issues.push({
      field: "email",
      code: "EMAIL_REQUIRED",
      message: "请输入管理员邮箱",
    });
  } else if (!isValidAdminEmail(email)) {
    issues.push({
      field: "email",
      code: "EMAIL_INVALID",
      message: "管理员邮箱格式不正确",
    });
  }

  if (!password) {
    issues.push({
      field: "password",
      code: "PASSWORD_REQUIRED",
      message: "请输入密码",
    });
  } else {
    if (
      passwordCharacterCount >
      PASSWORD_POLICY_SETTINGS.maximumCharacters
    ) {
      issues.push({
        field: "password",
        code: "PASSWORD_TOO_LONG",
        message: `密码最多允许 ${PASSWORD_POLICY_SETTINGS.maximumCharacters} 个字符`,
      });
    }

    if (CONTROL_CHARACTER_PATTERN.test(password)) {
      issues.push({
        field: "password",
        code: "PASSWORD_HAS_CONTROL_CHARACTERS",
        message: "密码不能包含换行、制表符等控制字符",
      });
    }
  }

  return {
    isValid: issues.length === 0,
    email,
    passwordCharacterCount,
    issues,
  };
}

export function prepareAdminLoginInput(
  input: unknown,
): AdminLoginCredentials {
  const validation = validateAdminLoginInput(input);

  if (!validation.isValid || !isRecord(input)) {
    throw new AdminLoginInputError(validation.issues);
  }

  return {
    email: validation.email,
    password: normalizePasswordForAuthentication(
      input.password as string,
    ),
  };
}
