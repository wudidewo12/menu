import "server-only";

import {
  isValidAdminEmail,
  normalizeAdminEmail,
} from "./admin-email";
import {
  validatePasswordPolicy,
  type PasswordPolicyContext,
  type PasswordPolicyIssueCode,
} from "./password-policy";

export type AdminPasswordResetField = "email" | "password";

export type AdminPasswordResetIssueCode =
  | "EMAIL_REQUIRED"
  | "EMAIL_INVALID"
  | PasswordPolicyIssueCode;

export interface AdminPasswordResetIssue {
  field: AdminPasswordResetField;
  code: AdminPasswordResetIssueCode;
  message: string;
}

export interface AdminPasswordResetValidation {
  isValid: boolean;
  email: string;
  passwordCharacterCount: number;
  issues: AdminPasswordResetIssue[];
}

export interface AdminPasswordResetPlan {
  operation: "RESET_ADMIN_PASSWORD";
  email: string;
  password: {
    accepted: true;
    characterCount: number;
    storedAs: "ARGON2ID_HASH_ONLY";
    hashCreated: false;
  };
  sessions: {
    revokeExisting: true;
  };
  database: {
    connected: false;
    writes: 0;
  };
}

export class AdminPasswordResetPlanError extends Error {
  readonly code = "ADMIN_PASSWORD_RESET_INPUT_INVALID";

  constructor(readonly issues: AdminPasswordResetIssue[]) {
    super(issues.map((issue) => issue.message).join("\n"));
    this.name = "AdminPasswordResetPlanError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function adminPasswordResetContext(
  email: string,
  displayName = "",
): PasswordPolicyContext {
  const emailLocalPart = email.split("@")[0] ?? "";

  return {
    blockedValues: [
      email,
      emailLocalPart,
      displayName,
      "menu admin",
      "menu owner",
      "menu administrator",
      `${emailLocalPart} menu admin`,
      `${displayName} menu admin`,
    ].filter(Boolean),
  };
}

export function validateAdminPasswordResetInput(
  input: unknown,
): AdminPasswordResetValidation {
  const source = isRecord(input) ? input : {};
  const email = normalizeAdminEmail(source.email);
  const issues: AdminPasswordResetIssue[] = [];

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

  const passwordResult = validatePasswordPolicy(
    source.password,
    adminPasswordResetContext(email),
  );

  issues.push(
    ...passwordResult.issues.map((issue) => ({
      field: "password" as const,
      code: issue.code,
      message: issue.message,
    })),
  );

  return {
    isValid: issues.length === 0,
    email,
    passwordCharacterCount: passwordResult.characterCount,
    issues,
  };
}

export function buildAdminPasswordResetPlan(
  input: unknown,
): AdminPasswordResetPlan {
  const validation = validateAdminPasswordResetInput(input);

  if (!validation.isValid) {
    throw new AdminPasswordResetPlanError(validation.issues);
  }

  return {
    operation: "RESET_ADMIN_PASSWORD",
    email: validation.email,
    password: {
      accepted: true,
      characterCount: validation.passwordCharacterCount,
      storedAs: "ARGON2ID_HASH_ONLY",
      hashCreated: false,
    },
    sessions: {
      revokeExisting: true,
    },
    database: {
      connected: false,
      writes: 0,
    },
  };
}
