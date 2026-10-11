#!/usr/bin/env node

import { bumpOnly, checkPack, checkRegistries, prepare, publish } from "./commands.js";
import type { PrereleaseId, ReleaseIncrement } from "./version.js";

const usage = `Usage:
  bump-n-pub <major|minor|patch|prerelease> [--dry-run] [--alpha|--beta]
  bump-n-pub <major|minor|patch|prerelease> --bump-only [--dry-run] [--alpha|--beta]
  bump-n-pub check-registries
  bump-n-pub prepare
  bump-n-pub check-pack`;

class UsageError extends Error {}

function parseIncrement(value: string | undefined): ReleaseIncrement | undefined {
  switch (value) {
    case "major":
    case "minor":
    case "patch":
    case "prerelease":
      return value;
    default:
      return undefined;
  }
}

function requireNoArguments(command: string, args: string[]): void {
  if (args.length > 0) throw new UsageError(`${command} does not accept arguments`);
}

async function runCli(args: string[]): Promise<void> {
  const [first, ...rest] = args;
  if (first === "check-registries") {
    requireNoArguments(first, rest);
    checkRegistries(process.cwd());
    return;
  }
  if (first === "prepare") {
    requireNoArguments(first, rest);
    prepare(process.cwd());
    return;
  }
  if (first === "check-pack") {
    requireNoArguments(first, rest);
    checkPack(process.cwd());
    return;
  }

  const increment = parseIncrement(first);
  if (!increment) {
    throw new UsageError(first ? `Unknown command ${first}` : "An increment is required");
  }
  let bumpOnlyRequested = false;
  let dryRun = false;
  let prereleaseId: PrereleaseId | undefined;
  for (const argument of rest) {
    if (argument === "--bump-only") bumpOnlyRequested = true;
    else if (argument === "--dry-run") dryRun = true;
    else if (argument === "--alpha" || argument === "--beta") {
      const requested = argument === "--alpha" ? "alpha" : "beta";
      if (prereleaseId && prereleaseId !== requested) {
        throw new UsageError("Choose either --alpha or --beta, not both");
      }
      prereleaseId = requested;
    } else {
      throw new UsageError(`Unrecognized option ${argument}`);
    }
  }

  if (bumpOnlyRequested) {
    bumpOnly(process.cwd(), increment, prereleaseId, dryRun);
  } else {
    await publish(process.cwd(), increment, prereleaseId, dryRun);
  }
}

try {
  await runCli(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  if (error instanceof UsageError) process.stderr.write(`\n${usage}\n`);
  process.exitCode = 1;
}
