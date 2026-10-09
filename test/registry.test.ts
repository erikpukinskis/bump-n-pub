import { describe, expect, test } from "vitest";

import {
  classifyRegistryFailure,
  isUnpublishedPackageFailure,
  queryPackageVersions,
} from "../src/registry.js";
import type { ReleasePackage } from "../src/release-group.js";
import type { CommandResult, CommandRunner } from "../src/process.js";

const releasePackage: ReleasePackage = {
  name: "@multiplayerdb/service",
  version: "1.0.0",
  directory: "/project",
  manifestPath: "/project/package.json",
  relativeManifestPath: "package.json",
  manifest: { name: "@multiplayerdb/service", version: "1.0.0" },
  registry: "https://npm.pkg.github.com",
};

function result(
  status: number,
  stdout: string = "",
  stderr: string = "",
): CommandResult {
  return { status, stdout, stderr };
}

function recordedRunner(recorded: CommandResult): CommandRunner {
  return () => recorded;
}

describe("registry response classification", () => {
  test("recognizes Yarn's exact unpublished-package response", () => {
    const response = result(
      1,
      JSON.stringify({
        type: "error",
        displayName: "YN0035",
        data: "Package not found",
      }),
    );
    expect(isUnpublishedPackageFailure(response)).toBe(true);
    expect(queryPackageVersions(releasePackage, recordedRunner(response))).toEqual({
      status: "unpublished",
      versions: [],
    });
  });

  test.each([
    ["authentication", '{"displayName":"YN0041","data":"Invalid authentication"}'],
    ["authorization", "Response Code: 403 (Forbidden)"],
    ["network", "getaddrinfo EAI_AGAIN npm.pkg.github.com"],
    ["command", "Unexpected package-manager failure"],
  ])("classifies %s failures", (category, output) => {
    expect(classifyRegistryFailure(result(1, output))).toBe(category);
  });

  test("parses a successful versions response", () => {
    expect(
      queryPackageVersions(
        releasePackage,
        recordedRunner(result(0, '{"versions":["0.9.0","1.0.0"]}')),
      ),
    ).toEqual({ status: "available", versions: ["0.9.0", "1.0.0"] });
  });

  test("fails closed on malformed success output", () => {
    expect(() =>
      queryPackageVersions(
        releasePackage,
        recordedRunner(result(0, '{"name":"@multiplayerdb/service"}')),
      ),
    ).toThrow("malformed-response");
  });
});
