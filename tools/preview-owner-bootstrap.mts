import {
  OwnerBootstrapPlanError,
} from "../src/server/auth/owner-bootstrap-plan.ts";
import {
  OwnerPasswordConfirmationMismatchError,
  runInitialOwnerPreview,
} from "../src/server/auth/owner-bootstrap-preview.ts";
import {
  InteractiveTerminalRequiredError,
  TerminalHiddenInput,
} from "./terminal-hidden-input.mts";

class OwnerPreviewArgumentsError extends Error {
  readonly code = "OWNER_PREVIEW_ARGUMENTS_NOT_ALLOWED";

  constructor() {
    super("安全预览命令不接受任何参数，请在终端提示出现后再输入资料");
    this.name = "OwnerPreviewArgumentsError";
  }
}

async function main() {
  if (process.argv.slice(2).length > 0) {
    throw new OwnerPreviewArgumentsError();
  }

  const terminal = new TerminalHiddenInput();

  try {
    await runInitialOwnerPreview(terminal);
  } finally {
    terminal.close();
  }
}

try {
  await main();
} catch (error) {
  if (
    error instanceof OwnerPreviewArgumentsError ||
    error instanceof InteractiveTerminalRequiredError ||
    error instanceof OwnerPasswordConfirmationMismatchError
  ) {
    console.error(error.message);
  } else if (error instanceof OwnerBootstrapPlanError) {
    for (const issue of error.issues) {
      console.error(`${issue.field}：${issue.message}`);
    }
  } else {
    console.error("OWNER 安全预览失败，请检查终端后重试");
  }

  process.exitCode = 1;
}
