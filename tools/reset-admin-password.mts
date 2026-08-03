import {
  AdminPasswordResetPlanError,
} from "../src/server/auth/admin-password-reset-plan.ts";
import {
  AdminPasswordConfirmationMismatchError,
  runAdminPasswordResetCommit,
  type AdminPasswordResetCommitInput,
} from "../src/server/auth/admin-password-reset-preview.ts";
import {
  InteractiveTerminalRequiredError,
  TerminalHiddenInput,
} from "./terminal-hidden-input.mts";

class AdminPasswordResetArgumentsError extends Error {
  readonly code = "ADMIN_PASSWORD_RESET_ARGUMENTS_INVALID";

  constructor() {
    super("正式密码重置命令需要且只接受固定的 --commit 标记");
    this.name = "AdminPasswordResetArgumentsError";
  }
}

async function resetPasswordAfterConfirmation(
  input: AdminPasswordResetCommitInput,
) {
  const [fsModule, dotenvModule] = await Promise.all([
    import("node:fs"),
    import("dotenv"),
  ]);
  const localEnvironment = dotenvModule.default.parse(
    fsModule.readFileSync(".env.local"),
  );
  const databaseUrl = localEnvironment.DATABASE_URL;
  const applicationRole = localEnvironment.POSTGRES_APP_USER;

  if (!databaseUrl || !applicationRole) {
    throw new Error("Missing runtime database configuration");
  }

  process.env.DATABASE_URL = databaseUrl;
  process.env.POSTGRES_APP_USER = applicationRole;

  delete process.env.DATABASE_ADMIN_URL;
  delete process.env.POSTGRES_OWNER;
  delete process.env.POSTGRES_OWNER_PASSWORD;
  delete process.env.POSTGRES_APP_PASSWORD;
  delete process.env.ADMIN_PASSWORD;

  const [{ resetAdminPassword }, { prisma }] = await Promise.all([
    import("../src/server/auth/admin-password-reset.ts"),
    import("../src/server/db/prisma.ts"),
  ]);

  try {
    return await resetAdminPassword(input);
  } finally {
    await prisma.$disconnect();
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

async function main() {
  const argumentsList = process.argv.slice(2);

  if (
    argumentsList.length !== 1 ||
    argumentsList[0] !== "--commit"
  ) {
    throw new AdminPasswordResetArgumentsError();
  }

  const terminal = new TerminalHiddenInput();

  try {
    await runAdminPasswordResetCommit(
      terminal,
      resetPasswordAfterConfirmation,
    );
  } finally {
    terminal.close();
  }
}

try {
  await main();
} catch (error) {
  if (
    error instanceof AdminPasswordResetArgumentsError ||
    error instanceof InteractiveTerminalRequiredError ||
    error instanceof AdminPasswordConfirmationMismatchError
  ) {
    console.error(error.message);
  } else if (error instanceof AdminPasswordResetPlanError) {
    for (const issue of error.issues) {
      console.error(`${issue.field}：${issue.message}`);
    }
  } else if (
    hasErrorCode(error, "ADMIN_PASSWORD_RESET_USER_NOT_FOUND")
  ) {
    console.error("没有找到这个管理员账号");
  } else {
    console.error("管理员密码重置失败；数据库没有完成这次写入");
  }

  process.exitCode = 1;
}
