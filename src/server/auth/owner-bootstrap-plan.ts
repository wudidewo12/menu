import "server-only";

import {
  ADMIN_EMAIL_SETTINGS,
  isValidAdminEmail,
  normalizeAdminEmail,
} from "./admin-email";
import {
  validatePasswordPolicy,
  type PasswordPolicyContext,
  type PasswordPolicyIssueCode,
} from "./password-policy";

export const INITIAL_OWNER_SETTINGS = Object.freeze({
  role: "OWNER",
  status: "ACTIVE",
  minimumDisplayNameCharacters: 1,
  maximumDisplayNameCharacters: 80,
  maximumEmailCharacters: ADMIN_EMAIL_SETTINGS.maximumCharacters,
});

export type OwnerBootstrapField = "email" | "displayName" | "password";

export type OwnerBootstrapIssueCode =
  | "EMAIL_REQUIRED"
  | "EMAIL_INVALID"
  | "DISPLAY_NAME_REQUIRED"
  | "DISPLAY_NAME_TOO_LONG"
  | "DISPLAY_NAME_HAS_CONTROL_CHARACTERS"
  | PasswordPolicyIssueCode;

export interface OwnerBootstrapIssue {
  field: OwnerBootstrapField;
  code: OwnerBootstrapIssueCode;
  message: string;
}

export interface OwnerBootstrapValidation {
  isValid: boolean;
  email: string;
  displayName: string;
  passwordCharacterCount: number;
  issues: OwnerBootstrapIssue[];
}

export interface InitialOwnerPlan {
  operation: "CREATE_INITIAL_OWNER";
  email: string;
  displayName: string;
  role: "OWNER";
  status: "ACTIVE";
  password: {
    accepted: true;
    characterCount: number;
    storedAs: "ARGON2ID_HASH_ONLY";
    hashCreated: false;
  };
  database: {
    connected: false;
    writes: 0;
  };
}

export class OwnerBootstrapPlanError extends Error {
  readonly code = "OWNER_BOOTSTRAP_INPUT_INVALID";

  constructor(readonly issues: OwnerBootstrapIssue[]) {
    super(issues.map((issue) => issue.message).join("\n"));
    this.name = "OwnerBootstrapPlanError";
  }
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDisplayName(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFC").trim().replace(/\p{Zs}+/gu, " ")
    : "";
}

export function initialOwnerPasswordContext(
  email: string,
  displayName: string,
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
      `${emailLocalPart} menu owner`,
      `${displayName} menu owner`,
    ].filter(Boolean),
  };
}

export function validateInitialOwnerInput(
  input: unknown,
): OwnerBootstrapValidation {
  const source = isRecord(input) ? input : {};
  const email = normalizeAdminEmail(source.email);
  const displayName = normalizeDisplayName(source.displayName);
  const issues: OwnerBootstrapIssue[] = [];

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

  if (!displayName) {
    issues.push({
      field: "displayName",
      code: "DISPLAY_NAME_REQUIRED",
      message: "请输入管理员显示名称",
    });
  } else {
    const displayNameCharacters = Array.from(displayName).length;

    if (
      displayNameCharacters >
      INITIAL_OWNER_SETTINGS.maximumDisplayNameCharacters
    ) {
      issues.push({
        field: "displayName",
        code: "DISPLAY_NAME_TOO_LONG",
        message: `管理员显示名称最多允许 ${INITIAL_OWNER_SETTINGS.maximumDisplayNameCharacters} 个字符`,
      });
    }

    if (CONTROL_CHARACTER_PATTERN.test(displayName)) {
      issues.push({
        field: "displayName",
        code: "DISPLAY_NAME_HAS_CONTROL_CHARACTERS",
        message: "管理员显示名称不能包含控制字符",
      });
    }
  }

  const passwordResult = validatePasswordPolicy(
    source.password,
    initialOwnerPasswordContext(email, displayName),
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
    displayName,
    passwordCharacterCount: passwordResult.characterCount,
    issues,
  };
}

export function buildInitialOwnerPlan(input: unknown): InitialOwnerPlan {
  const validation = validateInitialOwnerInput(input);

  if (!validation.isValid) {
    throw new OwnerBootstrapPlanError(validation.issues);
  }

  return {
    operation: "CREATE_INITIAL_OWNER",
    email: validation.email,
    displayName: validation.displayName,
    role: INITIAL_OWNER_SETTINGS.role,
    status: INITIAL_OWNER_SETTINGS.status,
    password: {
      accepted: true,
      characterCount: validation.passwordCharacterCount,
      storedAs: "ARGON2ID_HASH_ONLY",
      hashCreated: false,
    },
    database: {
      connected: false,
      writes: 0,
    },
  };
}
