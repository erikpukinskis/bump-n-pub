import { expect, test } from "vitest";

import { requireSuccess, runCommand } from "../src/process.js";

test("external command output redacts registry credentials", () => {
  const result = runCommand(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "process.stdout.write(process.env.NODE_AUTH_TOKEN); process.stderr.write(process.env.NPM_PKG_TOKEN)",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_AUTH_TOKEN: "node-secret",
        NPM_PKG_TOKEN: "npm-secret",
      },
    },
  );

  expect(result.stdout).toBe("[redacted]");
  expect(result.stderr).toBe("[redacted]");
});

test("external command failures preserve their exit status", () => {
  expect(() =>
    requireSuccess(
      { status: 7, stdout: "", stderr: "failed" },
      "Controlled command",
    ),
  ).toThrow(
    expect.objectContaining({
      exitCode: 7,
      message: "Controlled command failed:\nfailed",
    }),
  );
});
