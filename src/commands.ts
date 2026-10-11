import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

import { z } from "zod";

import {
  readReleaseGroup,
  readRootPackage,
  writeVersion,
  type ReleasePackage,
} from "./project.js";
import {
  calculateVersion,
  isPrerelease,
  releaseType,
  type PrereleaseId,
  type ReleaseIncrement,
} from "./version.js";

const PublishingBranchesSchema = z.array(z.string());
const YarnScopesSchema = z.record(z.string(), z.unknown());
const NpmErrorSchema = z.object({ error: z.object({ code: z.literal("E404") }).loose() });

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function capture(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  }).trim();
}

function requireCleanWorktree(root: string, action: string): void {
  const status = capture("git", ["status", "--porcelain"], root);
  if (status) throw new Error(`Working directory must be empty to ${action}:\n${status}`);
}

function outputFromError(error: unknown, name: "stdout" | "stderr"): string {
  if (typeof error !== "object" || error === null) return "";
  const value = Reflect.get(error, name);
  if (typeof value === "string") return value;
  return Buffer.isBuffer(value) ? value.toString("utf8") : "";
}

function packageIsUnpublished(output: string): boolean {
  try {
    return NpmErrorSchema.safeParse(JSON.parse(output)).success;
  } catch {
    return false;
  }
}

function versionIsPublished(releasePackage: ReleasePackage): boolean {
  const registryArguments = releasePackage.registry
    ? ["--registry", releasePackage.registry]
    : [];
  const env = { ...process.env };
  if (releasePackage.registry && process.env.NODE_AUTH_TOKEN) {
    const registry = new URL(releasePackage.registry);
    const path = registry.pathname.endsWith("/")
      ? registry.pathname
      : `${registry.pathname}/`;
    env[`npm_config_//${registry.host}${path}:_authToken`] = process.env.NODE_AUTH_TOKEN;
  }

  let output: string;
  try {
    output = execFileSync(
      "npm",
      [
        "view",
        `${releasePackage.name}@${releasePackage.version}`,
        "version",
        "--json",
        ...registryArguments,
      ],
      {
        cwd: releasePackage.directory,
        encoding: "utf8",
        env,
        stdio: ["inherit", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const stdout = outputFromError(error, "stdout");
    const stderr = outputFromError(error, "stderr");
    if (packageIsUnpublished(stdout) || packageIsUnpublished(stderr)) return false;
    if (stdout) process.stderr.write(stdout);
    if (stderr) process.stderr.write(stderr);
    throw new Error(`Could not query ${releasePackage.name}`);
  }

  let version: unknown;
  try {
    version = JSON.parse(output);
  } catch {
    throw new Error(`npm view returned malformed JSON for ${releasePackage.name}`);
  }
  if (version !== releasePackage.version) {
    throw new Error(`npm view returned an unexpected version for ${releasePackage.name}`);
  }
  return true;
}

export function releaseShouldPublish(
  version: string,
  published: boolean[],
  branch: string,
  publishingBranches: string[],
): boolean {
  const publishedCount = published.filter(Boolean).length;
  if (publishedCount !== 0 && publishedCount !== published.length) {
    throw new Error(
      "Exactly one package version is already published; bump all package versions before retrying",
    );
  }
  return (
    publishedCount === 0 &&
    (isPrerelease(version) || publishingBranches.includes(branch))
  );
}

export function bumpOnly(
  root: string,
  increment: ReleaseIncrement,
  prereleaseId: PrereleaseId | undefined,
  dryRun: boolean,
): void {
  const group = readReleaseGroup(root);
  requireCleanWorktree(group.root, "bump");
  const version = calculateVersion(group.version, increment, prereleaseId);
  if (dryRun) {
    process.stdout.write(`Version would be ${version}.\n`);
    return;
  }

  for (const releasePackage of group.packages) writeVersion(releasePackage, version);
  run(
    "git",
    [
      "add",
      "--",
      ...group.packages.map((releasePackage) => releasePackage.relativeManifestPath),
    ],
    group.root,
  );
  run("git", ["commit", "-m", `v${version}`], group.root);
  process.stdout.write(`Bumped package versions to ${version}.\n`);
}

export function checkRegistries(root: string): void {
  const rootPackage = readRootPackage(root);
  const scopes = YarnScopesSchema.parse(
    JSON.parse(
      capture("yarn", ["config", "get", "npmScopes", "--json"], rootPackage.directory),
    ),
  );
  const privateDependencies = rootPackage.dependencies.filter((name) =>
    Object.keys(scopes).some((scope) => name.startsWith(`@${scope}/`)),
  );
  for (const dependency of privateDependencies) {
    try {
      execFileSync("yarn", ["npm", "info", dependency, "--fields", "name", "--json"], {
        cwd: rootPackage.directory,
        stdio: ["inherit", "pipe", "pipe"],
      });
    } catch (error) {
      const stdout = outputFromError(error, "stdout");
      const stderr = outputFromError(error, "stderr");
      if (stdout) process.stderr.write(stdout);
      if (stderr) process.stderr.write(stderr);
      throw new Error(`Could not read ${dependency}`);
    }
  }
}

export function prepare(root: string): void {
  const group = readReleaseGroup(root);
  const branch = process.env.GITHUB_REF_NAME;
  if (!branch) throw new Error("GITHUB_REF_NAME is required to prepare a release");

  const published = group.packages.map(versionIsPublished);
  let publishingBranches: string[] = [];
  if (!isPrerelease(group.version)) {
    const source = process.env.PUBLISHING_BRANCHES;
    if (!source) throw new Error("PUBLISHING_BRANCHES is required for a stable release");
    try {
      publishingBranches = PublishingBranchesSchema.parse(JSON.parse(source));
    } catch {
      throw new Error("PUBLISHING_BRANCHES must be a JSON array of branch names");
    }
  }

  const shouldPublish = releaseShouldPublish(
    group.version,
    published,
    branch,
    publishingBranches,
  );
  process.stdout.write(
    `package_version=${group.version}\nshould_publish=${String(shouldPublish)}\n`,
  );
}

export function checkPack(root: string): void {
  const group = readReleaseGroup(root);
  for (const releasePackage of group.packages) {
    run("yarn", ["pack", "--dry-run"], releasePackage.directory);
  }
}

function checkNpmAccess(root: string, registry: string | undefined): void {
  const registryArgs = registry ? ["--registry", registry] : [];
  try {
    execFileSync("npm", ["whoami", ...registryArgs], { cwd: root, stdio: "ignore" });
  } catch {
    run("npm", ["adduser", ...registryArgs], root);
  }
}

function restoreRelease(root: string, originalHead: string, tag: string): void {
  if (capture("git", ["tag", "--list", tag], root)) {
    run("git", ["tag", "-d", tag], root);
  }
  run("git", ["reset", "--hard", originalHead], root);
}

async function confirmRelease(tag: string): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(`New version will be ${tag}. Continue? (Y/n) `);
    return /^(?:y|yes)?$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

export async function publish(
  root: string,
  increment: ReleaseIncrement,
  prereleaseId: PrereleaseId | undefined,
  dryRun: boolean,
): Promise<void> {
  const releasePackage = readRootPackage(root);
  requireCleanWorktree(releasePackage.directory, "publish");
  run("git", ["fetch"], releasePackage.directory);
  const branch = capture(
    "git",
    ["symbolic-ref", "--short", "HEAD"],
    releasePackage.directory,
  );
  run(
    "git",
    ["merge-base", "--is-ancestor", `origin/${branch}`, "HEAD"],
    releasePackage.directory,
  );
  checkNpmAccess(releasePackage.directory, releasePackage.registry);

  const originalHead = capture("git", ["rev-parse", "HEAD"], releasePackage.directory);
  const version = calculateVersion(releasePackage.version, increment, prereleaseId);
  const tag = `${capture("npm", ["config", "get", "tag-version-prefix"], releasePackage.directory)}${version}`;
  const versionArguments = ["version", releaseType(increment, prereleaseId)];
  if (prereleaseId) versionArguments.push("--preid", prereleaseId);
  let publishAttempted = false;

  try {
    capture("npm", versionArguments, releasePackage.directory);
    if (dryRun) {
      restoreRelease(releasePackage.directory, originalHead, tag);
      process.stdout.write(`Dry run complete: version would have been ${tag}.\n`);
      return;
    }
    if (!(await confirmRelease(tag))) {
      restoreRelease(releasePackage.directory, originalHead, tag);
      process.stdout.write("Release cancelled; the version commit and tag were removed.\n");
      return;
    }

    const publishArguments = ["publish"];
    if (isPrerelease(version)) publishArguments.push("--tag", "next");
    publishAttempted = true;
    run("npm", publishArguments, releasePackage.directory);
    run("git", ["push"], releasePackage.directory);
    run("git", ["push", "origin", tag], releasePackage.directory);
    process.stdout.write(`Published ${releasePackage.name}@${version}.\n`);
  } catch (error) {
    if (!publishAttempted) restoreRelease(releasePackage.directory, originalHead, tag);
    throw error;
  }
}
