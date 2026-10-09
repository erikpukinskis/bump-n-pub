import { spawnSync } from "node:child_process";

import { CliError } from "./errors.js";

export type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

export type RunOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  input?: "inherit";
};

export type CommandRunner = (
  command: string,
  args: string[],
  options: RunOptions,
) => CommandResult;

function redact(value: string, env: NodeJS.ProcessEnv): string {
  let redacted = value;

  for (const name of ["NODE_AUTH_TOKEN", "NPM_PKG_TOKEN"]) {
    const secret = env[name];
    if (secret) {
      redacted = redacted.split(secret).join("[redacted]");
    }
  }

  return redacted;
}

export const runCommand: CommandRunner = (command, args, options) => {
  const env = options.env ?? process.env;
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env,
    stdio: options.input === "inherit" ? ["inherit", "pipe", "pipe"] : "pipe",
  });

  if (result.error) {
    throw new CliError(
      `Could not run ${command}: ${redact(result.error.message, env)}`,
    );
  }

  return {
    status: result.status ?? 1,
    stdout: redact(result.stdout ?? "", env),
    stderr: redact(result.stderr ?? "", env),
  };
};

export function requireSuccess(
  result: CommandResult,
  description: string,
): CommandResult {
  if (result.status !== 0) {
    const detail = [result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    throw new CliError(
      `${description} failed${detail ? `:\n${detail}` : ""}`,
      result.status,
    );
  }

  return result;
}
