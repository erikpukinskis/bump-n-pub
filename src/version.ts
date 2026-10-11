import semver, { type ReleaseType } from "semver";

export type ReleaseIncrement = "major" | "minor" | "patch" | "prerelease";
export type PrereleaseId = "alpha" | "beta";

export function releaseType(
  increment: ReleaseIncrement,
  prereleaseId?: PrereleaseId,
): ReleaseType {
  return prereleaseId && increment !== "prerelease" ? `pre${increment}` : increment;
}

export function calculateVersion(
  currentVersion: string,
  increment: ReleaseIncrement,
  prereleaseId?: PrereleaseId,
): string {
  if (!semver.valid(currentVersion)) {
    throw new Error(`${currentVersion} is not a valid semantic version`);
  }

  const release = releaseType(increment, prereleaseId);

  const version = prereleaseId
    ? semver.inc(currentVersion, release, prereleaseId)
    : semver.inc(currentVersion, release);
  if (!version) {
    throw new Error(`Could not bump ${currentVersion} with ${release}`);
  }

  return version;
}

export function isPrerelease(version: string): boolean {
  if (!semver.valid(version)) {
    throw new Error(`${version} is not a valid semantic version`);
  }
  return semver.prerelease(version) !== null;
}
