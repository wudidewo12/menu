import * as readline from "node:readline/promises";
import { Writable } from "node:stream";

type TerminalInput = NodeJS.ReadableStream & {
  isTTY?: boolean;
};

type TerminalOutput = NodeJS.WritableStream & {
  isTTY?: boolean;
};

export class InteractiveTerminalRequiredError extends Error {
  readonly code = "INTERACTIVE_TERMINAL_REQUIRED";

  constructor() {
    super("该命令必须在交互式终端中运行，不能通过管道或重定向输入密码");
    this.name = "InteractiveTerminalRequiredError";
  }
}

export class TerminalHiddenInput {
  private readonly terminal: readline.Interface;
  private hidden = false;

  constructor(
    private readonly input: TerminalInput = process.stdin,
    private readonly output: TerminalOutput = process.stdout,
  ) {
    if (!input.isTTY || !output.isTTY) {
      throw new InteractiveTerminalRequiredError();
    }

    const protectedOutput = new Writable({
      write: (chunk, _encoding, callback) => {
        if (!this.hidden) {
          this.output.write(chunk);
        }
        callback();
      },
    });

    this.terminal = readline.createInterface({
      input,
      output: protectedOutput,
      terminal: true,
    });
  }

  async readVisible(prompt: string): Promise<string> {
    this.hidden = false;
    return this.terminal.question(prompt);
  }

  async readHidden(prompt: string): Promise<string> {
    this.output.write(prompt);
    this.hidden = true;

    try {
      return await this.terminal.question("");
    } finally {
      this.hidden = false;
      this.output.write("\n");
    }
  }

  writeLine(line: string): void {
    this.output.write(`${line}\n`);
  }

  close(): void {
    this.hidden = false;
    this.terminal.close();
  }
}
