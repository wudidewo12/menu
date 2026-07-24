import "server-only";

import {
  buildInitialOwnerPlan,
  type InitialOwnerPlan,
} from "./owner-bootstrap-plan";

export interface OwnerBootstrapPreviewIO {
  readVisible(prompt: string): Promise<string>;
  readHidden(prompt: string): Promise<string>;
  writeLine(line: string): void;
}

export interface OwnerBootstrapPreviewResult {
  plan: InitialOwnerPlan;
  lines: string[];
}

export class OwnerPasswordConfirmationMismatchError extends Error {
  readonly code = "OWNER_PASSWORD_CONFIRMATION_MISMATCH";

  constructor() {
    super("两次输入的管理员密码不一致");
    this.name = "OwnerPasswordConfirmationMismatchError";
  }
}

function safePreviewLines(plan: InitialOwnerPlan): string[] {
  return [
    "",
    "首次 OWNER 初始化安全预览",
    `邮箱：${plan.email}`,
    `显示名称：${plan.displayName}`,
    `角色：${plan.role}`,
    `状态：${plan.status}`,
    `密码：已通过规则（${plan.password.characterCount} 个字符，内容不显示）`,
    `密码存储：${plan.password.storedAs}`,
    "密码哈希已创建：否",
    "数据库连接：否",
    "数据库写入：0",
    "结果：仅预览，尚未创建管理员",
  ];
}

export async function runInitialOwnerPreview(
  io: OwnerBootstrapPreviewIO,
): Promise<OwnerBootstrapPreviewResult> {
  const email = await io.readVisible("管理员邮箱：");
  const displayName = await io.readVisible("管理员显示名称：");
  let password = "";
  let passwordConfirmation = "";

  try {
    password = await io.readHidden("管理员密码（输入时不显示）：");
    passwordConfirmation = await io.readHidden("再次输入管理员密码：");

    if (password !== passwordConfirmation) {
      throw new OwnerPasswordConfirmationMismatchError();
    }

    const plan = buildInitialOwnerPlan({
      email,
      displayName,
      password,
    });
    const lines = safePreviewLines(plan);

    for (const line of lines) {
      io.writeLine(line);
    }

    return {
      plan,
      lines,
    };
  } finally {
    password = "";
    passwordConfirmation = "";
  }
}
