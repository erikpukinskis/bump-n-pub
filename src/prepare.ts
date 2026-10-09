import { appendFileSync } from "node:fs";

import { z } from "zod";

import { CliError } from "./errors.js";
import {
  queryPackageVersions,
  type PackageVersions,
} from "./registry.js";
import {
  discoverReleaseGroup,
  type ReleasePackage,
} from "./release-group.js";
import { runCommand, type CommandRunner } from "./process.js";
import { isPrerelease } from "./version.js";

const PublishingBranchesSchema = z.array(z.string());

export type PackagePublication = {
  name: string;
  registry: string;
  published: boolean;
};

export type ReleasePlan = {
  package_version: string;
  should_publish: boolean;
  dist_tag: "latest" | "preview";
  reason: "not_published" | "already_published" | "branch_not_allowed";
  packages: PackagePublication[];
};

export type CalculateReleasePlanOptions = {
  version: string;
  packages: PackagePublication[];
  branch: string;
  publishingBranches: string[];
};

export function calculateReleasePlan(
  options: CalculateReleasePlanOptions,
): ReleasePlan {
  const prerelease = isPrerelease(options.version);
  const publishedCount = options.packages.filter(
    (releasePackage) => releasePackage.published,
  ).length;

  if (publishedCount !== 0 && publishedCount !== options.packages.length) {
    const published = options.packages
      .filter((releasePackage) => releasePackage.published)
      .map((releasePackage) => releasePackage.name);
    const missing = options.packages
      .filter((releasePackage) => !releasePackage.published)
      .map((releasePackage) => releasePackage.name);
    throw new CliError(
      `Only part of the release group is published (published: ${published.join(
        ", ",
      )}; unpublished: ${missing.join(", ")}). Bump all package versions before retrying.`,
    );
  }

  const allPublished = publishedCount === options.packages.length;
  const branchAllowed =
    prerelease || options.publishingBranches.includes(options.branch);
  let reason: ReleasePlan["reason"] = "not_published";
  if (allPublished) {
    reason = "already_published";
  } else if (!branchAllowed) {
    reason = "branch_not_allowed";
  }

  return {
    package_version: options.version,
    should_publish: !allPublished && branchAllowed,
    dist_tag: prerelease ? "preview" : "latest",
    reason,
    packages: options.packages,
  };
}

function publishingBranches(
  version: string,
  env: NodeJS.ProcessEnv,
): string[] {
  if (isPrerelease(version)) {
    return [];
  }

  const source = env.PUBLISHING_BRANCHES;
  if (!source) {
    throw new CliError(
      "PUBLISHING_BRANCHES must be a JSON array for a stable release",
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new CliError("PUBLISHING_BRANCHES must be valid JSON");
  }

  const parsed = PublishingBranchesSchema.safeParse(value);
  if (!parsed.success) {
    throw new CliError("PUBLISHING_BRANCHES must be a JSON array of branch names");
  }
  return parsed.data;
}

function exactVersionIsPublished(
  releasePackage: ReleasePackage,
  result: PackageVersions,
): boolean {
  return result.status === "available"
    ? result.versions.includes(releasePackage.version)
    : false;
}

export type PrepareOptions = {
  root: string;
  githubActions: boolean;
  runner?: CommandRunner;
  env?: NodeJS.ProcessEnv;
  query?: (
    releasePackage: ReleasePackage,
    runner: CommandRunner,
    env: NodeJS.ProcessEnv,
  ) => PackageVersions;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
};

export function prepare(options: PrepareOptions): ReleasePlan {
  const group = discoverReleaseGroup(options.root);
  const runner = options.runner ?? runCommand;
  const env = options.env ?? process.env;
  const query = options.query ?? queryPackageVersions;
  const stdout = options.stdout ?? ((message: string) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message: string) => process.stderr.write(message));
  const branch = env.GITHUB_REF_NAME;
  if (!branch) {
    throw new CliError("GITHUB_REF_NAME is required to prepare a release");
  }

  const packages = group.packages.map((releasePackage) => ({
    name: releasePackage.name,
    registry: releasePackage.registry,
    published: exactVersionIsPublished(
      releasePackage,
      query(releasePackage, runner, env),
    ),
  }));
  const plan = calculateReleasePlan({
    version: group.version,
    packages,
    branch,
    publishingBranches: publishingBranches(group.version, env),
  });

  if (plan.reason === "already_published") {
    stderr(`Release group ${plan.package_version} is already published.\n`);
  } else if (plan.reason === "branch_not_allowed") {
    stderr(`Branch ${branch} is not allowed to publish a stable release.\n`);
  } else if (plan.dist_tag === "preview") {
    stderr(`Prerelease ${plan.package_version} may publish from ${branch}.\n`);
  } else {
    stderr(`Release group ${plan.package_version} is ready to publish.\n`);
  }

  if (options.githubActions) {
    const outputPath = env.GITHUB_OUTPUT;
    if (!outputPath) {
      throw new CliError("GITHUB_OUTPUT is required with --github-actions");
    }
    appendFileSync(
      outputPath,
      [
        `package_version=${plan.package_version}`,
        `should_publish=${String(plan.should_publish)}`,
        `dist_tag=${plan.dist_tag}`,
        `reason=${plan.reason}`,
        "",
      ].join("\n"),
    );
  }

  stdout(`${JSON.stringify(plan)}\n`);
  return plan;
}
