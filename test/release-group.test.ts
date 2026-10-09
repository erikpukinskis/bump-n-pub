import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { discoverReleaseGroup } from "../src/release-group.js";
import { temporaryDirectory, writeJson } from "./helpers.js";

describe("discoverReleaseGroup", () => {
  test("discovers a publishable root and client using Yarn scope configuration", () => {
    const root = temporaryDirectory("bump-n-pub-group-");
    mkdirSync(join(root, "client"));
    mkdirSync(join(root, "private-tool"));
    writeJson(join(root, "package.json"), {
      name: "@multiplayerdb/service",
      version: "1.2.3",
      workspaces: ["client", "private-*"],
    });
    writeJson(join(root, "client/package.json"), {
      name: "@multiplayerdb/service-client",
      version: "1.2.3",
    });
    writeJson(join(root, "private-tool/package.json"), {
      private: true,
    });
    writeFileSync(
      join(root, ".yarnrc.yml"),
      "npmScopes:\n  multiplayerdb:\n    npmRegistryServer: https://npm.pkg.github.com\n",
    );

    const group = discoverReleaseGroup(root);

    expect(group.version).toBe("1.2.3");
    expect(group.packages.map((releasePackage) => releasePackage.name)).toEqual([
      "@multiplayerdb/service",
      "@multiplayerdb/service-client",
    ]);
    expect(group.packages.map((releasePackage) => releasePackage.registry)).toEqual([
      "https://npm.pkg.github.com",
      "https://npm.pkg.github.com",
    ]);
  });

  test("excludes a private root while discovering public workspaces", () => {
    const root = temporaryDirectory("bump-n-pub-private-root-");
    mkdirSync(join(root, "client"));
    writeJson(join(root, "package.json"), {
      private: true,
      workspaces: ["client"],
    });
    writeJson(join(root, "client/package.json"), {
      name: "public-client",
      version: "4.0.0",
    });

    const group = discoverReleaseGroup(root);

    expect(group.version).toBe("4.0.0");
    expect(group.packages.map((releasePackage) => releasePackage.name)).toEqual([
      "public-client",
    ]);
  });

  test("rejects mismatched release-group versions", () => {
    const root = temporaryDirectory("bump-n-pub-mismatch-");
    mkdirSync(join(root, "client"));
    writeJson(join(root, "package.json"), {
      name: "service",
      version: "1.2.3",
      workspaces: ["client"],
    });
    writeJson(join(root, "client/package.json"), {
      name: "service-client",
      version: "1.2.2",
    });

    expect(() => discoverReleaseGroup(root)).toThrow(
      "Release-group package versions do not match",
    );
  });
});
