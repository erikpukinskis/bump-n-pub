import { describe, expect, test } from "vitest";

import { calculateVersion } from "../src/version.js";

describe("calculateVersion", () => {
  test.each([
    ["1.2.3", "major", undefined, "2.0.0"],
    ["1.2.3", "minor", undefined, "1.3.0"],
    ["1.2.3", "patch", undefined, "1.2.4"],
    ["1.2.3", "minor", "alpha", "1.3.0-alpha.0"],
    ["1.2.3", "patch", "beta", "1.2.4-beta.0"],
    ["1.3.0-beta.0", "prerelease", undefined, "1.3.0-beta.1"],
    ["1.3.0-alpha.3", "prerelease", "beta", "1.3.0-beta.0"],
  ])("bumps %s with %s and %s", (current, increment, prereleaseId, expected) => {
    const parsedIncrement =
      increment === "major" ||
      increment === "minor" ||
      increment === "patch" ||
      increment === "prerelease"
        ? increment
        : "patch";
    const parsedPrereleaseId =
      prereleaseId === "alpha" || prereleaseId === "beta"
        ? prereleaseId
        : undefined;
    expect(calculateVersion(current, parsedIncrement, parsedPrereleaseId)).toBe(
      expected,
    );
  });

  test("rejects a malformed current version", () => {
    expect(() => calculateVersion("next", "patch")).toThrow(
      "not a valid semantic version",
    );
  });
});
