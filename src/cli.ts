#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { bump } from "./bump.js";
import { checkPack } from "./check-pack.js";
import { CliError, errorMessage } from "./errors.js";
import { prepare } from "./prepare.js";
import { publish } from "./publish.js";
import { checkRegistries } from "./registry.js";
import {
  PrereleaseIdSchema,
  ReleaseIncrementSchema,
  type PrereleaseId,
  type ReleaseIncrement,
} from "./version.js";

const usage = `Usage:
  bump-n-pub publish <major|minor|patch|prerelease> [--github] [--dry-run] [--alpha|--beta]
  bump-n-pub bump <major|minor|patch|prerelease> [--alpha|--beta]
  bump-n-pub check-registries
  bump-n-pub prepare [--github-actions]
  bump-n-pub check-pack`;

type ReleaseArguments = {
  increment: ReleaseIncrement;
  prereleaseId?: PrereleaseId;
  github: boolean;
  dryRun: boolean;
};

function parseReleaseArguments(
  args: string[],
  allowedFlags: Set<string>,
): ReleaseArguments {
  let increment: ReleaseIncrement | undefined;
  let prereleaseId: PrereleaseId | undefined;
  let github = false;
  let dryRun = false;

  for (const argument of args) {
    const parsedIncrement = ReleaseIncrementSchema.safeParse(argument);
    if (parsedIncrement.success) {
      if (increment) throw new CliError("Provide exactly one release increment");
      increment = parsedIncrement.data;
      continue;
    }

    if (!allowedFlags.has(argument)) {
      throw new CliError(`Unrecognized option ${argument}`);
    }
    if (argument === "--github") github = true;
    if (argument === "--dry-run") dryRun = true;
    if (argument === "--alpha" || argument === "--beta") {
      const parsedPrerelease = PrereleaseIdSchema.parse(argument.slice(2));
      if (prereleaseId && prereleaseId !== parsedPrerelease) {
        throw new CliError("Choose either --alpha or --beta, not both");
      }
      prereleaseId = parsedPrerelease;
    }
  }

  if (!increment) throw new CliError("A release increment is required");
  return {
    increment,
    ...(prereleaseId ? { prereleaseId } : {}),
    github,
    dryRun,
  };
}

function requireNoArguments(command: string, args: string[]): void {
  if (args.length !== 0) {
    throw new CliError(`${command} does not accept arguments`);
  }
}

export async function runCli(
  args: string[],
  root: string = process.cwd(),
): Promise<void> {
  const [command, ...commandArguments] = args;

  if (command === "publish") {
    const parsed = parseReleaseArguments(
      commandArguments,
      new Set(["--github", "--dry-run", "--alpha", "--beta"]),
    );
    await publish({
      root,
      increment: parsed.increment,
      ...(parsed.prereleaseId ? { prereleaseId: parsed.prereleaseId } : {}),
      github: parsed.github,
      dryRun: parsed.dryRun,
    });
    return;
  }

  if (command === "bump") {
    const parsed = parseReleaseArguments(
      commandArguments,
      new Set(["--alpha", "--beta"]),
    );
    const version = bump({
      root,
      increment: parsed.increment,
      ...(parsed.prereleaseId ? { prereleaseId: parsed.prereleaseId } : {}),
    });
    process.stdout.write(`Bumped release-group packages to ${version}.\n`);
    return;
  }

  if (command === "check-registries") {
    requireNoArguments(command, commandArguments);
    checkRegistries({ root });
    return;
  }

  if (command === "prepare") {
    const githubActions = commandArguments.includes("--github-actions");
    const unexpected = commandArguments.filter(
      (argument) => argument !== "--github-actions",
    );
    if (unexpected.length > 0 || commandArguments.length > 1) {
      throw new CliError(`Unrecognized prepare option ${unexpected[0] ?? ""}`);
    }
    prepare({ root, githubActions });
    return;
  }

  if (command === "check-pack") {
    requireNoArguments(command, commandArguments);
    checkPack({ root });
    return;
  }

  throw new CliError(command ? `Unknown command ${command}` : "A command is required");
}

async function main(): Promise<void> {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Error: ${errorMessage(error)}\n\n${usage}\n`);
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
