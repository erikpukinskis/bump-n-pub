import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";

import { expect, test } from "vitest";
import { z } from "zod";

import { checkPack } from "../src/check-pack.js";
import { temporaryDirectory, writeJson } from "./helpers.js";

test("check-pack inspects every publishable release-group member", () => {
  const root = temporaryDirectory("bump-n-pub-pack-");
  const client = join(root, "client");
  const bin = join(root, "bin");
  const log = join(root, "pack-log.jsonl");
  mkdirSync(client);
  mkdirSync(bin);
  writeJson(join(root, "package.json"), {
    name: "service",
    version: "1.0.0",
    workspaces: ["client"],
  });
  writeJson(join(client, "package.json"), {
    name: "service-client",
    version: "1.0.0",
  });
  const executable = join(bin, "yarn");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.PACK_LOG, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + "\\n");
console.log("dry-run pack output");
`,
  );
  chmodSync(executable, 0o755);
  let output = "";

  checkPack({
    root,
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      PACK_LOG: log,
    },
    stdout: (message) => {
      output += message;
    },
  });

  const RecordSchema = z.object({
    cwd: z.string(),
    args: z.array(z.string()),
  });
  const records = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => RecordSchema.parse(JSON.parse(line)));
  expect(records).toEqual([
    { cwd: realpathSync(root), args: ["pack", "--dry-run"] },
    { cwd: realpathSync(client), args: ["pack", "--dry-run"] },
  ]);
  expect(output.match(/dry-run pack output/g)).toHaveLength(2);
});
