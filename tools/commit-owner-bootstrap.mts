import {
  OwnerBootstrapPlanError,
} from "../src/server/auth/owner-bootstrap-plan.ts";
import {
  OwnerPasswordConfirmationMismatchError,
  runInitialOwnerCommit,
  type InitialOwnerCommitInput,
} from "../src/server/auth/owner-bootstrap-preview.ts";
import {
  InteractiveTerminalRequiredError,
  TerminalHiddenInput,
} from "./terminal-hidden-input.mts";

class OwnerCommitArgumentsError extends Error {
  readonly code = "OWNER_COMMIT_ARGUMENTS_INVALID";

  constructor() {
    super("正式创建命令需要且只接受固定的 --commit 标记");
    this.name = "OwnerCommitArgumentsError";
  }
}

async function createOwnerAfterConfirmation(
  input: InitialOwnerCommitInput,
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

  const [{ createInitialOwner }, { prisma }] = await Promise.all([
    import("../src/server/auth/owner-bootstrap.ts"),
    import("../src/server/db/prisma.ts"),
  ]);

  try {
    return await createInitialOwner(input);
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
    throw new OwnerCommitArgumentsError();
  }

  const terminal = new TerminalHiddenInput();

  try {
    await runInitialOwnerCommit(
      terminal,
      createOwnerAfterConfirmation,
    );
  } finally {
    terminal.close();
  }
}

try {
  await main();
} catch (error) {
  if (
    error instanceof OwnerCommitArgumentsError ||
    error instanceof InteractiveTerminalRequiredError ||
    error instanceof OwnerPasswordConfirmationMismatchError
  ) {
    console.error(error.message);
  } else if (error instanceof OwnerBootstrapPlanError) {
    for (const issue of error.issues) {
      console.error(`${issue.field}：${issue.message}`);
    }
  } else if (hasErrorCode(error, "INITIAL_OWNER_ALREADY_EXISTS")) {
    console.error("管理员账号已经初始化，不能再次创建首次 OWNER");
  } else {
    console.error("首次 OWNER 创建失败；数据库没有完成这次写入");
  }

  process.exitCode = 1;
}
