import { CliError } from "./errors.js";
import {
  discoverReleaseGroup,
  writeManifest,
  type ReleaseGroup,
} from "./release-group.js";
import {
  requireSuccess,
  runCommand,
  type CommandRunner,
} from "./process.js";
import {
  calculateVersion,
  type PrereleaseId,
  type ReleaseIncrement,
} from "./version.js";

export type BumpOptions = {
  root: string;
  increment: ReleaseIncrement;
  prereleaseId?: PrereleaseId;
  runner?: CommandRunner;
};

function requireCleanWorktree(group: ReleaseGroup, runner: CommandRunner): void {
  const result = requireSuccess(
    runner("git", ["status", "--porcelain"], { cwd: group.root }),
    "Checking the Git worktree",
  );

  if (result.stdout.trim()) {
    throw new CliError(
      `Working directory must be empty to bump:\n${result.stdout.trim()}`,
    );
  }
}

export function bump(options: BumpOptions): string {
  const runner = options.runner ?? runCommand;
  const group = discoverReleaseGroup(options.root);
  requireCleanWorktree(group, runner);
  const version = calculateVersion(
    group.version,
    options.increment,
    options.prereleaseId,
  );

  for (const releasePackage of group.packages) {
    writeManifest(releasePackage, {
      ...releasePackage.manifest,
      version,
    });
  }

  const manifestPaths = group.packages.map(
    (releasePackage) => releasePackage.relativeManifestPath,
  );
  requireSuccess(
    runner("git", ["add", "--", ...manifestPaths], { cwd: group.root }),
    "Staging release-group manifests",
  );
  requireSuccess(
    runner("git", ["commit", "-m", `v${version}`], { cwd: group.root }),
    "Committing release-group version",
  );

  return version;
}
