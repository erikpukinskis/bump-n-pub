import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  calculateReleasePlan,
  prepare,
  type PackagePublication,
} from "../src/prepare.js";
import { temporaryDirectory, writeJson } from "./helpers.js";

const servicePackage: PackagePublication = {
  name: "service",
  registry: "https://registry.yarnpkg.com",
  published: false,
};
const clientPackage: PackagePublication = {
  name: "service-client",
  registry: "https://registry.yarnpkg.com",
  published: false,
};
const packages = [servicePackage, clientPackage];

describe("calculateReleasePlan", () => {
  test("publishes an unpublished stable group from an allowed branch", () => {
    expect(
      calculateReleasePlan({
        version: "1.2.3",
        packages,
        branch: "main",
        publishingBranches: ["main"],
      }),
    ).toMatchObject({
      should_publish: true,
      dist_tag: "latest",
      reason: "not_published",
    });
  });

  test("skips an unpublished stable group from another branch", () => {
    expect(
      calculateReleasePlan({
        version: "1.2.3",
        packages,
        branch: "feature",
        publishingBranches: ["main"],
      }),
    ).toMatchObject({
      should_publish: false,
      dist_tag: "latest",
      reason: "branch_not_allowed",
    });
  });

  test("allows a prerelease from a feature branch", () => {
    expect(
      calculateReleasePlan({
        version: "1.3.0-beta.1",
        packages,
        branch: "feature",
        publishingBranches: [],
      }),
    ).toMatchObject({
      should_publish: true,
      dist_tag: "preview",
      reason: "not_published",
    });
  });

  test("skips a fully published release group", () => {
    expect(
      calculateReleasePlan({
        version: "1.2.3",
        packages: packages.map((releasePackage) => ({
          ...releasePackage,
          published: true,
        })),
        branch: "main",
        publishingBranches: ["main"],
      }),
    ).toMatchObject({ should_publish: false, reason: "already_published" });
  });

  test("rejects partial publication", () => {
    expect(() =>
      calculateReleasePlan({
        version: "1.2.3",
        packages: [{ ...servicePackage, published: true }, clientPackage],
        branch: "main",
        publishingBranches: ["main"],
      }),
    ).toThrow("Only part of the release group is published");
  });
});

test("prepare writes stable JSON and GitHub Actions scalar outputs", () => {
  const root = temporaryDirectory("bump-n-pub-prepare-");
  const githubOutput = join(root, "github-output");
  writeJson(join(root, "package.json"), { name: "service", version: "1.2.3" });
  let stdout = "";
  let stderr = "";

  const plan = prepare({
    root,
    githubActions: true,
    env: {
      GITHUB_REF_NAME: "main",
      PUBLISHING_BRANCHES: '["main"]',
      GITHUB_OUTPUT: githubOutput,
    },
    query: () => ({ status: "unpublished", versions: [] }),
    stdout: (message) => {
      stdout += message;
    },
    stderr: (message) => {
      stderr += message;
    },
  });

  expect(JSON.parse(stdout)).toEqual(plan);
  expect(stderr).toContain("ready to publish");
  expect(readFileSync(githubOutput, "utf8")).toBe(
    "package_version=1.2.3\nshould_publish=true\ndist_tag=latest\nreason=not_published\n",
  );
});
