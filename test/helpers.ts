import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const cliPath = join(import.meta.dirname, "../dist/cli.js");

export function temporaryDirectory(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

export function initializeGitProject(
  manifest: Record<string, unknown>,
  clientManifest?: Record<string, unknown>,
): string {
  const root = temporaryDirectory("bump-n-pub-project-");
  writeJson(join(root, "package.json"), manifest);
  if (clientManifest) writeJson(join(root, "client/package.json"), clientManifest);
  git(root, "init", "--initial-branch=main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test User");
  git(root, "add", ".");
  git(root, "commit", "-m", "Initial commit");
  return root;
}

export function runCli(
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env,
  });
}

export function runCliAsync(
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [cliPath, ...args],
      { cwd: root, encoding: "utf8", env },
      (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stderr, stdout }));
        else resolve({ stderr, stdout });
      },
    );
  });
}

export function runCliWithInput(
  root: string,
  args: string[],
  input: string,
): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd: root });
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stderr, stdout });
      else reject(Object.assign(new Error(`CLI exited with ${String(code)}`), { stderr, stdout }));
    });
    child.stdin.end(input);
  });
}
