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

export interface InitialOwnerCommitInput {
  email: string;
  displayName: string;
  password: string;
}

export interface InitialOwnerPublicResult {
  created: true;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: "OWNER";
    status: "ACTIVE";
    passwordChangedAt: Date;
    createdAt: Date;
  };
}

export type CreateInitialOwner = (
  input: InitialOwnerCommitInput,
) => Promise<InitialOwnerPublicResult>;

export type OwnerBootstrapCommitResult =
  | {
      committed: false;
      plan: InitialOwnerPlan;
      lines: string[];
    }
  | {
      committed: true;
      plan: InitialOwnerPlan;
      owner: InitialOwnerPublicResult["user"];
      lines: string[];
    };

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

function writeLines(io: OwnerBootstrapPreviewIO, lines: string[]): void {
  for (const line of lines) {
    io.writeLine(line);
  }
}

async function withValidatedOwnerInput<T>(
  io: OwnerBootstrapPreviewIO,
  action: (
    input: InitialOwnerCommitInput,
    plan: InitialOwnerPlan,
  ) => Promise<T>,
): Promise<T> {
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

    return await action(
      {
        email: plan.email,
        displayName: plan.displayName,
        password,
      },
      plan,
    );
  } finally {
    password = "";
    passwordConfirmation = "";
  }
}

export function initialOwnerCommitConfirmation(
  plan: InitialOwnerPlan,
): string {
  return `CREATE OWNER ${plan.email}`;
}

export async function runInitialOwnerPreview(
  io: OwnerBootstrapPreviewIO,
): Promise<OwnerBootstrapPreviewResult> {
  return withValidatedOwnerInput(io, async (_input, plan) => {
    const lines = safePreviewLines(plan);

    writeLines(io, lines);

    return {
      plan,
      lines,
    };
  });
}

export async function runInitialOwnerCommit(
  io: OwnerBootstrapPreviewIO,
  createOwner: CreateInitialOwner,
): Promise<OwnerBootstrapCommitResult> {
  return withValidatedOwnerInput(io, async (input, plan) => {
    const previewLines = safePreviewLines(plan);
    const confirmation = initialOwnerCommitConfirmation(plan);
    const confirmationLines = [
      "",
      "若确认创建，请完整输入下面这句话：",
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

    const result = await createOwner(input);
    const successLines = [
      "",
      "首次 OWNER 创建成功",
      `邮箱：${result.user.email}`,
      `显示名称：${result.user.displayName}`,
      `角色：${result.user.role}`,
      `状态：${result.user.status}`,
      "数据库写入：1",
      "密码或密码哈希：不显示",
    ];

    writeLines(io, successLines);

    return {
      committed: true,
      plan,
      owner: result.user,
      lines: [
        ...previewLines,
        ...confirmationLines,
        ...successLines,
      ],
    };
  });
}
