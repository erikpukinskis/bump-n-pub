import semver, { type ReleaseType } from "semver";
import { z } from "zod";

import { CliError } from "./errors.js";

export const ReleaseIncrementSchema = z.enum([
  "major",
  "minor",
  "patch",
  "prerelease",
]);
export type ReleaseIncrement = z.infer<typeof ReleaseIncrementSchema>;

export const PrereleaseIdSchema = z.enum(["alpha", "beta"]);
export type PrereleaseId = z.infer<typeof PrereleaseIdSchema>;

export function calculateVersion(
  currentVersion: string,
  increment: ReleaseIncrement,
  prereleaseId?: PrereleaseId,
): string {
  if (!semver.valid(currentVersion)) {
    throw new CliError(`${currentVersion} is not a valid semantic version`);
  }

  let release: ReleaseType = increment;
  if (prereleaseId && increment !== "prerelease") {
    release = `pre${increment}`;
  }

  const version = prereleaseId
    ? semver.inc(currentVersion, release, prereleaseId)
    : semver.inc(currentVersion, release);
  if (!version) {
    throw new CliError(`Could not bump ${currentVersion} with ${release}`);
  }

  return version;
}

export function isPrerelease(version: string): boolean {
  if (!semver.valid(version)) {
    throw new CliError(`${version} is not a valid semantic version`);
  }
  return semver.prerelease(version) !== null;
}
