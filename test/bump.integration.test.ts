import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";
import { z } from "zod";

import { bump } from "../src/bump.js";
import { PackageManifestSchema } from "../src/release-group.js";
import {
  git,
  initializeGitProject,
  readJson,
  temporaryDirectory,
  writeJson,
} from "./helpers.js";

describe("bump", () => {
  test("versions and commits a root-plus-client release group together", () => {
    const root = temporaryDirectory("bump-n-pub-bump-");
    mkdirSync(join(root, "client"));
    writeJson(join(root, "client/package.json"), {
      name: "service-client",
      version: "1.2.3",
    });
    initializeGitProject(root, {
      description: "Keeps its property order",
      name: "service",
      version: "1.2.3",
      workspaces: ["client"],
    });

    expect(bump({ root, increment: "minor", prereleaseId: "beta" })).toBe(
      "1.3.0-beta.0",
    );

    const service = PackageManifestSchema.parse(readJson(join(root, "package.json")));
    const client = PackageManifestSchema.parse(
      readJson(join(root, "client/package.json")),
    );
    expect(service.version).toBe("1.3.0-beta.0");
    expect(client.version).toBe("1.3.0-beta.0");
    const orderedManifest = z
      .record(z.string(), z.unknown())
      .parse(readJson(join(root, "package.json")));
    expect(Object.keys(orderedManifest)).toEqual([
      "description",
      "name",
      "version",
      "workspaces",
    ]);
    expect(git(root, "show", "--format=%s", "--name-only", "HEAD")).toContain(
      "v1.3.0-beta.0",
    );
    expect(
      git(root, "show", "--format=", "--name-only", "HEAD").split("\n").sort(),
    ).toEqual(["client/package.json", "package.json"]);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(git(root, "tag")).toBe("");
  });

  test("supports a root-only release group", () => {
    const root = temporaryDirectory("bump-n-pub-root-bump-");
    initializeGitProject(root, { name: "single-package", version: "2.0.0" });

    expect(bump({ root, increment: "patch" })).toBe("2.0.1");
    expect(git(root, "log", "-1", "--format=%s", "HEAD")).toBe("v2.0.1");
  });

  test("refuses to change a dirty worktree", () => {
    const root = temporaryDirectory("bump-n-pub-dirty-bump-");
    initializeGitProject(root, { name: "single-package", version: "2.0.0" });
    writeFileSync(join(root, "notes.txt"), "uncommitted\n");

    expect(() => bump({ root, increment: "patch" })).toThrow(
      "Working directory must be empty",
    );
    expect(
      PackageManifestSchema.parse(readJson(join(root, "package.json"))).version,
    ).toBe("2.0.0");
  });
});
