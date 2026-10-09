import { createInterface } from "node:readline/promises";
import { join } from "node:path";

import { CliError } from "./errors.js";
import { readManifest, writeManifest, type ReleasePackage } from "./release-group.js";
import {
  requireSuccess,
  runCommand,
  type CommandRunner,
} from "./process.js";
import {
  calculateVersion,
  isPrerelease,
  type PrereleaseId,
  type ReleaseIncrement,
} from "./version.js";

export type PublishOptions = {
  root: string;
  increment: ReleaseIncrement;
  prereleaseId?: PrereleaseId;
  github: boolean;
  dryRun: boolean;
  runner?: CommandRunner;
  env?: NodeJS.ProcessEnv;
  confirm?: (version: string) => Promise<boolean>;
  stdout?: (message: string) => void;
};

const githubRegistry = "https://npm.pkg.github.com";

async function askToContinue(version: string): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(
      `New version will be v${version}. Continue? (Y/n) `,
    );
    return /^(?:y|yes)?$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

function rootReleasePackage(root: string): ReleasePackage {
  const manifestPath = join(root, "package.json");
  const manifest = readManifest(manifestPath);
  if (manifest.private === true) {
    throw new CliError("The root package is private and cannot be published");
  }
  return {
    name: manifest.name,
    version: manifest.version,
    directory: root,
    manifestPath,
    relativeManifestPath: "package.json",
    manifest,
    registry: "https://registry.npmjs.org",
  };
}

function validateGit(root: string, runner: CommandRunner): string {
  const status = requireSuccess(
    runner("git", ["status", "--porcelain"], { cwd: root }),
    "Checking the Git worktree",
  );
  if (status.stdout.trim()) {
    throw new CliError(
      `Working directory must be empty to publish:\n${status.stdout.trim()}`,
    );
  }

  requireSuccess(runner("git", ["fetch"], { cwd: root }), "Fetching Git remotes");
  const branch = requireSuccess(
    runner("git", ["symbolic-ref", "--short", "HEAD"], { cwd: root }),
    "Reading the current Git branch",
  ).stdout.trim();
  if (!branch) {
    throw new CliError("Publishing requires a named Git branch");
  }

  const ancestor = runner(
    "git",
    ["merge-base", "--is-ancestor", `origin/${branch}`, "HEAD"],
    { cwd: root },
  );
  if (ancestor.status === 1) {
    throw new CliError(
      `origin/${branch} cannot be fast-forwarded to HEAD; pull or reconcile the branch before publishing`,
    );
  }
  requireSuccess(ancestor, `Checking origin/${branch}`);

  return requireSuccess(
    runner("git", ["rev-parse", "HEAD"], { cwd: root }),
    "Reading the current Git commit",
  ).stdout.trim();
}

function prepareRegistry(
  options: PublishOptions,
  runner: CommandRunner,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (options.github) {
    const token = env.NPM_PKG_TOKEN;
    if (!token) {
      throw new CliError(
        "NPM_PKG_TOKEN is required when publishing to the GitHub registry",
      );
    }
    const publishEnv = { ...env };
    publishEnv["npm_config_//npm.pkg.github.com/:_authToken"] = token;
    return publishEnv;
  }

  const whoami = runner("npm", ["whoami"], { cwd: options.root, env });
  if (whoami.status !== 0) {
    requireSuccess(
      runner("npm", ["adduser"], {
        cwd: options.root,
        env,
        input: "inherit",
      }),
      "Logging in to npm",
    );
  }
  return env;
}

function rollback(
  root: string,
  originalHead: string,
  version: string,
  tagCreated: boolean,
  runner: CommandRunner,
): void {
  if (tagCreated) {
    requireSuccess(
      runner("git", ["tag", "-d", `v${version}`], { cwd: root }),
      "Removing the release tag",
    );
  }
  requireSuccess(
    runner("git", ["reset", "--hard", originalHead], { cwd: root }),
    "Restoring the release commit",
  );
}

export async function publish(options: PublishOptions): Promise<string> {
  const runner = options.runner ?? runCommand;
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? ((message: string) => process.stdout.write(message));
  const releasePackage = rootReleasePackage(options.root);
  const originalHead = validateGit(options.root, runner);
  const publishEnv = prepareRegistry(options, runner, env);
  const version = calculateVersion(
    releasePackage.version,
    options.increment,
    options.prereleaseId,
  );
  let releaseStateCreated = false;
  let tagCreated = false;
  let packagePublished = false;

  try {
    writeManifest(releasePackage, { ...releasePackage.manifest, version });
    releaseStateCreated = true;
    requireSuccess(
      runner("git", ["add", "--", "package.json"], { cwd: options.root }),
      "Staging the version manifest",
    );
    requireSuccess(
      runner("git", ["commit", "-m", `v${version}`], { cwd: options.root }),
      "Committing the release version",
    );
    requireSuccess(
      runner("git", ["tag", "-a", `v${version}`, "-m", `v${version}`], {
        cwd: options.root,
      }),
      "Creating the release tag",
    );
    tagCreated = true;

    if (options.dryRun) {
      rollback(options.root, originalHead, version, tagCreated, runner);
      releaseStateCreated = false;
      stdout(`Dry run complete: version would have been v${version}.\n`);
      return version;
    }

    const confirmed = await (options.confirm ?? askToContinue)(version);
    if (!confirmed) {
      rollback(options.root, originalHead, version, tagCreated, runner);
      releaseStateCreated = false;
      stdout("Release cancelled; the version commit and tag were removed.\n");
      return version;
    }

    const { devDependencies: omittedDevDependencies, ...publishManifest } = {
      ...releasePackage.manifest,
      version,
    };
    void omittedDevDependencies;
    writeManifest(releasePackage, publishManifest);

    const publishArgs = ["publish"];
    if (isPrerelease(version)) publishArgs.push("--tag", "next");
    if (options.github) publishArgs.push("--registry", githubRegistry);
    requireSuccess(
      runner("npm", publishArgs, {
        cwd: options.root,
        env: publishEnv,
        input: "inherit",
      }),
      `Publishing ${releasePackage.name}@${version}`,
    );
    packagePublished = true;

    requireSuccess(
      runner("git", ["checkout", "--", "package.json"], { cwd: options.root }),
      "Restoring package.json",
    );
    requireSuccess(
      runner("git", ["push"], { cwd: options.root }),
      "Pushing the release commit",
    );
    requireSuccess(
      runner("git", ["push", "origin", `v${version}`], { cwd: options.root }),
      "Pushing the release tag",
    );

    stdout(`Published ${releasePackage.name}@${version}.\n`);
    return version;
  } catch (error) {
    if (releaseStateCreated && !packagePublished) {
      rollback(options.root, originalHead, version, tagCreated, runner);
    } else if (releaseStateCreated) {
      runner("git", ["checkout", "--", "package.json"], { cwd: options.root });
    }
    throw error;
  }
}
