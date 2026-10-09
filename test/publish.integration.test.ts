import { readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { describe, expect, test } from "vitest";
import { z } from "zod";

import { publish } from "../src/publish.js";
import { PackageManifestSchema } from "../src/release-group.js";
import {
  createRecordingNpm,
  git,
  initializeGitProject,
  readJson,
  temporaryDirectory,
} from "./helpers.js";

function recordedCommands(path: string): unknown[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => z.array(z.string()).parse(JSON.parse(line)));
}

describe("publish", () => {
  test("dry-runs the legacy root-only workflow and restores Git", async () => {
    const root = temporaryDirectory("bump-n-pub-publish-dry-");
    initializeGitProject(root, {
      name: "single-package",
      version: "1.2.3",
      devDependencies: { typescript: "1.0.0" },
    });
    const originalHead = git(root, "rev-parse", "HEAD");
    const npm = createRecordingNpm(temporaryDirectory("bump-n-pub-npm-"));

    await expect(
      publish({
        root,
        increment: "patch",
        github: false,
        dryRun: true,
        env: {
          ...process.env,
          PATH: `${npm.bin}${delimiter}${process.env.PATH ?? ""}`,
          COMMAND_LOG: npm.log,
        },
      }),
    ).resolves.toBe("1.2.4");

    expect(git(root, "rev-parse", "HEAD")).toBe(originalHead);
    expect(git(root, "tag")).toBe("");
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(recordedCommands(npm.log)).toEqual([["whoami"]]);
  });

  test("publishes a stable npm release, restores dev dependencies, and pushes", async () => {
    const root = temporaryDirectory("bump-n-pub-publish-stable-");
    const { remote } = initializeGitProject(root, {
      name: "single-package",
      version: "1.2.3",
      devDependencies: { typescript: "1.0.0" },
    });
    const npm = createRecordingNpm(temporaryDirectory("bump-n-pub-npm-"));

    await publish({
      root,
      increment: "minor",
      github: false,
      dryRun: false,
      confirm: async () => true,
      env: {
        ...process.env,
        PATH: `${npm.bin}${delimiter}${process.env.PATH ?? ""}`,
        COMMAND_LOG: npm.log,
      },
    });

    const manifest = PackageManifestSchema.parse(readJson(join(root, "package.json")));
    expect(manifest.version).toBe("1.3.0");
    expect(manifest.devDependencies).toEqual({ typescript: "1.0.0" });
    expect(recordedCommands(npm.log)).toEqual([["whoami"], ["publish"]]);
    expect(git(remote, "tag")).toBe("v1.3.0");
    expect(git(remote, "log", "-1", "--format=%s", "main")).toBe("v1.3.0");
  });

  test("uses the next tag and GitHub registry without exposing the token", async () => {
    const root = temporaryDirectory("bump-n-pub-publish-preview-");
    initializeGitProject(root, {
      name: "@example/single-package",
      version: "1.2.3",
      devDependencies: { typescript: "1.0.0" },
    });
    const npm = createRecordingNpm(temporaryDirectory("bump-n-pub-npm-"));
    const token = "secret-test-token";

    await publish({
      root,
      increment: "minor",
      prereleaseId: "alpha",
      github: true,
      dryRun: false,
      confirm: async () => true,
      env: {
        ...process.env,
        PATH: `${npm.bin}${delimiter}${process.env.PATH ?? ""}`,
        COMMAND_LOG: npm.log,
        NPM_PKG_TOKEN: token,
      },
    });

    expect(recordedCommands(npm.log)).toEqual([
      [
        "publish",
        "--tag",
        "next",
        "--registry",
        "https://npm.pkg.github.com",
      ],
    ]);
    expect(readFileSync(npm.log, "utf8")).not.toContain(token);
  });

  test("restores the worktree when creating the release tag fails", async () => {
    const root = temporaryDirectory("bump-n-pub-publish-tag-failure-");
    initializeGitProject(root, {
      name: "single-package",
      version: "1.2.3",
    });
    const originalHead = git(root, "rev-parse", "HEAD");
    git(root, "tag", "v1.2.4");
    const npm = createRecordingNpm(temporaryDirectory("bump-n-pub-npm-"));

    await expect(
      publish({
        root,
        increment: "patch",
        github: false,
        dryRun: false,
        confirm: async () => true,
        env: {
          ...process.env,
          PATH: `${npm.bin}${delimiter}${process.env.PATH ?? ""}`,
          COMMAND_LOG: npm.log,
        },
      }),
    ).rejects.toThrow("Creating the release tag failed");

    expect(git(root, "rev-parse", "HEAD")).toBe(originalHead);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(git(root, "tag")).toBe("v1.2.4");
  });
});
