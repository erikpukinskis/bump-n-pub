import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function temporaryDirectory(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export function initializeGitProject(
  root: string,
  packageJson: Record<string, unknown>,
): { remote: string } {
  const remote = temporaryDirectory("bump-n-pub-remote-");
  git(remote, "init", "--bare");
  writeJson(join(root, "package.json"), packageJson);
  git(root, "init");
  git(root, "branch", "-M", "main");
  git(root, "config", "user.name", "Bump N Pub Tests");
  git(root, "config", "user.email", "bump-n-pub@example.com");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-u", "origin", "main");
  return { remote };
}

export function createRecordingNpm(root: string): {
  bin: string;
  log: string;
} {
  const bin = join(root, "test-bin");
  const log = join(root, "npm-commands.jsonl");
  mkdirSync(bin);
  const executable = join(bin, "npm");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.COMMAND_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "publish") {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  if (manifest.devDependencies) process.exit(17);
}
`,
  );
  chmodSync(executable, 0o755);
  return { bin, log };
}
