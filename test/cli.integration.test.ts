import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

import { expect, test } from "vitest";
import { z } from "zod";

import {
  git,
  initializeGitProject,
  readJson,
  runCli,
  runCliAsync,
  runCliWithInput,
  temporaryDirectory,
} from "./helpers.js";

const ManifestSchema = z.object({ version: z.string() }).loose();

test("bump-only commits matching root and client versions without a tag", () => {
  const root = initializeGitProject(
    {
      name: "@fixture/service",
      version: "1.2.3",
      workspaces: ["client"],
      packageManager: "yarn@4.11.0",
    },
    { name: "@fixture/service-client", version: "1.2.3" },
  );

  expect(runCli(root, ["minor", "--bump-only"])).toContain("1.3.0");
  expect(ManifestSchema.parse(readJson(join(root, "package.json"))).version).toBe("1.3.0");
  expect(ManifestSchema.parse(readJson(join(root, "client/package.json"))).version).toBe(
    "1.3.0",
  );
  expect(git(root, "log", "-1", "--format=%s")).toBe("v1.3.0");
  expect(git(root, "tag")).toBe("");
});

test("bump-only dry runs without changing the project", () => {
  const root = initializeGitProject({ name: "fixture", version: "1.2.3" });
  const originalHead = git(root, "rev-parse", "HEAD");

  expect(runCli(root, ["patch", "--bump-only", "--dry-run"])).toBe(
    "Version would be 1.2.4.\n",
  );
  expect(git(root, "rev-parse", "HEAD")).toBe(originalHead);
  expect(git(root, "status", "--porcelain")).toBe("");
});

test("check-pack traverses the root and client with real Yarn", () => {
  const root = initializeGitProject(
    {
      name: "@fixture/service",
      version: "1.2.3",
      workspaces: ["client"],
      packageManager: "yarn@4.11.0",
    },
    { name: "@fixture/service-client", version: "1.2.3" },
  );
  writeFileSync(join(root, "index.js"), "export {};\n");
  writeFileSync(join(root, "client/index.js"), "export {};\n");

  expect(runCli(root, ["check-pack"]).match(/Done in/g)).toHaveLength(2);
});

test("prepare queries both packages on an ineligible branch and keeps stdout scalar", async () => {
  const requests: string[] = [];
  const authorizations: Array<string | undefined> = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    authorizations.push(request.headers.authorization);
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test registry did not start");
  const registry = `http://127.0.0.1:${address.port}`;
  const root = initializeGitProject(
    {
      name: "@fixture/service",
      version: "1.2.3",
      workspaces: ["client"],
      packageManager: "yarn@4.11.0",
      publishConfig: { registry },
    },
    {
      name: "@fixture/service-client",
      version: "1.2.3",
      publishConfig: { registry },
    },
  );
  writeFileSync(
    join(root, ".yarnrc.yml"),
    `unsafeHttpWhitelist:\n  - 127.0.0.1\nnpmScopes:\n  fixture:\n    npmRegistryServer: "${registry}"\n`,
  );

  try {
    const result = await runCliAsync(root, ["prepare"], {
      ...process.env,
      GITHUB_REF_NAME: "feature",
      NODE_AUTH_TOKEN: "fixture-token",
      PUBLISHING_BRANCHES: '["main"]',
    });
    expect(result.stdout).toBe("package_version=1.2.3\nshould_publish=false\n");
    expect(requests).toHaveLength(2);
    expect(authorizations).toEqual(["Bearer fixture-token", "Bearer fixture-token"]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("check-registries quietly checks configured-scope root dependencies", async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        name: "@fixture/dependency",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name: "@fixture/dependency", version: "1.0.0" },
        },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test registry did not start");
  const registry = `http://127.0.0.1:${address.port}`;
  const root = initializeGitProject({
    name: "service",
    version: "1.2.3",
    workspaces: ["unsupported-*"],
    packageManager: "yarn@4.11.0",
    dependencies: { "@fixture/dependency": "1.0.0", public: "1.0.0" },
  });
  writeFileSync(
    join(root, ".yarnrc.yml"),
    `unsafeHttpWhitelist:\n  - 127.0.0.1\nnpmScopes:\n  fixture:\n    npmRegistryServer: "${registry}"\n`,
  );

  try {
    const result = await runCliAsync(root, ["check-registries"]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(requests).toHaveLength(1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("the default dry run uses npm version and removes its commit and tag", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ username: "fixture" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test registry did not start");
  const registry = `http://127.0.0.1:${address.port}`;
  const root = initializeGitProject({
    name: "fixture",
    version: "1.2.3",
    publishConfig: { registry },
  });
  writeFileSync(
    join(root, ".npmrc"),
    `//127.0.0.1:${address.port}/:_authToken=fixture\ntag-version-prefix=release-\n`,
  );
  git(root, "add", ".npmrc");
  git(root, "commit", "-m", "Configure registry");
  const remote = temporaryDirectory("bump-n-pub-remote-");
  git(remote, "init", "--bare");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "--set-upstream", "origin", "main");
  const originalHead = git(root, "rev-parse", "HEAD");

  try {
    const result = await runCliAsync(root, ["patch", "--dry-run"]);
    expect(result.stdout).toContain("version would have been release-1.2.4");
    expect(git(root, "rev-parse", "HEAD")).toBe(originalHead);
    expect(git(root, "tag")).toBe("");
    expect(git(root, "status", "--porcelain")).toBe("");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("a failed postversion script removes the version commit and tag", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ username: "fixture" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test registry did not start");
  const registry = `http://127.0.0.1:${address.port}`;
  const root = initializeGitProject({
    name: "fixture",
    version: "1.2.3",
    publishConfig: { registry },
    scripts: { postversion: 'node -e "process.exit(1)"' },
  });
  writeFileSync(
    join(root, ".npmrc"),
    `//127.0.0.1:${address.port}/:_authToken=fixture\n`,
  );
  git(root, "add", ".npmrc");
  git(root, "commit", "-m", "Configure registry");
  const remote = temporaryDirectory("bump-n-pub-remote-");
  git(remote, "init", "--bare");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "--set-upstream", "origin", "main");
  const originalHead = git(root, "rev-parse", "HEAD");

  try {
    await expect(runCliAsync(root, ["patch", "--dry-run"])).rejects.toBeDefined();
    expect(git(root, "rev-parse", "HEAD")).toBe(originalHead);
    expect(git(root, "tag")).toBe("");
    expect(git(root, "status", "--porcelain")).toBe("");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("a failed npm publish retains the version commit and tag", async () => {
  const server = createServer((request, response) => {
    if (request.method === "PUT") {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "publication rejected" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ username: "fixture" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test registry did not start");
  const registry = `http://127.0.0.1:${address.port}`;
  const root = initializeGitProject({
    name: "fixture",
    version: "1.2.3",
    publishConfig: { registry },
  });
  writeFileSync(
    join(root, ".npmrc"),
    `//127.0.0.1:${address.port}/:_authToken=fixture\n`,
  );
  git(root, "add", ".npmrc");
  git(root, "commit", "-m", "Configure registry");
  const remote = temporaryDirectory("bump-n-pub-remote-");
  git(remote, "init", "--bare");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "--set-upstream", "origin", "main");

  try {
    await expect(runCliWithInput(root, ["patch"], "y\n")).rejects.toThrow(
      "CLI exited with 1",
    );
    expect(git(root, "log", "-1", "--format=%s")).toBe("1.2.4");
    expect(git(root, "tag")).toBe("v1.2.4");
    expect(git(root, "status", "--porcelain")).toBe("");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
