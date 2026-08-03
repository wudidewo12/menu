import "server-only";

import {
  buildAdminPasswordResetPlan,
  type AdminPasswordResetPlan,
} from "./admin-password-reset-plan";

export interface AdminPasswordResetPreviewIO {
  readVisible(prompt: string): Promise<string>;
  readHidden(prompt: string): Promise<string>;
  writeLine(line: string): void;
}

export interface AdminPasswordResetCommitInput {
  email: string;
  password: string;
}

export interface AdminPasswordResetPublicResult {
  reset: true;
  user: {
    email: string;
    displayName: string;
    role: "OWNER" | "EDITOR" | "VIEWER";
    status: "ACTIVE" | "DISABLED";
    passwordChangedAt: Date;
    updatedAt: Date;
  };
  password: {
    storedAs: "ARGON2ID_HASH_ONLY";
  };
  sessionsRevoked: number;
}

export type ResetAdminPassword = (
  input: AdminPasswordResetCommitInput,
) => Promise<AdminPasswordResetPublicResult>;

export type AdminPasswordResetCommitResult =
  | {
      committed: false;
      plan: AdminPasswordResetPlan;
      lines: string[];
    }
  | {
      committed: true;
      plan: AdminPasswordResetPlan;
      result: AdminPasswordResetPublicResult;
      lines: string[];
    };

export class AdminPasswordConfirmationMismatchError extends Error {
  readonly code = "ADMIN_PASSWORD_CONFIRMATION_MISMATCH";

  constructor() {
    super("两次输入的新管理员密码不一致");
    this.name = "AdminPasswordConfirmationMismatchError";
  }
}

function safePreviewLines(plan: AdminPasswordResetPlan): string[] {
  return [
    "",
    "管理员密码重置安全预览",
    `邮箱：${plan.email}`,
    `新密码：已通过规则（${plan.password.characterCount} 个字符，内容不显示）`,
    `密码存储：${plan.password.storedAs}`,
    "密码哈希已创建：否",
    "现有登录会话：正式重置时全部撤销",
    "数据库连接：否",
    "数据库写入：0",
    "结果：仅预览，尚未重置密码",
  ];
}

function writeLines(
  io: AdminPasswordResetPreviewIO,
  lines: string[],
): void {
  for (const line of lines) {
    io.writeLine(line);
  }
}

async function withValidatedResetInput<T>(
  io: AdminPasswordResetPreviewIO,
  action: (
    input: AdminPasswordResetCommitInput,
    plan: AdminPasswordResetPlan,
  ) => Promise<T>,
): Promise<T> {
  const email = await io.readVisible("管理员邮箱：");
  let password = "";
  let passwordConfirmation = "";

  try {
    password = await io.readHidden("新管理员密码（输入时不显示）：");
    passwordConfirmation = await io.readHidden(
      "再次输入新管理员密码：",
    );

    if (password !== passwordConfirmation) {
      throw new AdminPasswordConfirmationMismatchError();
    }

    const plan = buildAdminPasswordResetPlan({
      email,
      password,
    });

    return await action(
      {
        email: plan.email,
        password,
      },
      plan,
    );
  } finally {
    password = "";
    passwordConfirmation = "";
  }
}

export function adminPasswordResetConfirmation(
  plan: AdminPasswordResetPlan,
): string {
  return `RESET PASSWORD ${plan.email}`;
}

export async function runAdminPasswordResetPreview(
  io: AdminPasswordResetPreviewIO,
): Promise<{
  plan: AdminPasswordResetPlan;
  lines: string[];
}> {
  return withValidatedResetInput(io, async (_input, plan) => {
    const lines = safePreviewLines(plan);

    writeLines(io, lines);

    return {
      plan,
      lines,
    };
  });
}

export async function runAdminPasswordResetCommit(
  io: AdminPasswordResetPreviewIO,
  resetPassword: ResetAdminPassword,
): Promise<AdminPasswordResetCommitResult> {
  return withValidatedResetInput(io, async (input, plan) => {
    const previewLines = safePreviewLines(plan);
    const confirmation = adminPasswordResetConfirmation(plan);
    const confirmationLines = [
      "",
      "若确认重置，请完整输入下面这句话：",
      confirmation,
    ];

    writeLines(io, [...previewLines, ...confirmationLines]);

    const answer = await io.readVisible("确认短语：");

    if (answer !== confirmation) {
      const cancellationLines = [
        "",
        "结果：已取消，数据库未连接，数据库写入 0",
      ];

      writeLines(io, cancellationLines);

      return {
        committed: false,
        plan,
        lines: [
          ...previewLines,
          ...confirmationLines,
          ...cancellationLines,
        ],
      };
    }

    const result = await resetPassword(input);
    const successLines = [
      "",
      "管理员密码重置成功",
      `邮箱：${result.user.email}`,
      `显示名称：${result.user.displayName}`,
      `角色：${result.user.role}`,
      `状态：${result.user.status}`,
      `已撤销会话：${result.sessionsRevoked}`,
      "数据库事务：已提交",
      "密码或密码哈希：不显示",
    ];

    writeLines(io, successLines);

    return {
      committed: true,
      plan,
      result,
      lines: [
        ...previewLines,
        ...confirmationLines,
        ...successLines,
      ],
    };
  });
}
