#!/usr/bin/env node

import { Argument, Command, Option } from "commander"

import {
  bumpOnly,
  checkPack,
  checkRegistries,
  prepare,
  publish,
} from "./commands.js"
import type { PrereleaseId, ReleaseIncrement } from "./version.js"

type ReleaseOptions = {
  alpha?: boolean
  beta?: boolean
  bumpOnly?: boolean
  dryRun?: boolean
}

function releaseIncrement(value: string): ReleaseIncrement {
  switch (value) {
    case "major":
    case "minor":
    case "patch":
    case "prerelease":
      return value
    default:
      throw new Error(`Unknown increment ${value}`)
  }
}

function prereleaseId(options: ReleaseOptions): PrereleaseId | undefined {
  if (options.alpha) return "alpha"
  if (options.beta) return "beta"
  return undefined
}

const program = new Command()

program
  .name("bump-n-pub")
  .description("Publish an npm package or prepare a service release")
  .usage("<major|minor|patch|prerelease> [options]")
  .showHelpAfterError()
  .addArgument(
    new Argument("<increment>", "semantic version increment").choices([
      "major",
      "minor",
      "patch",
      "prerelease",
    ]),
  )
  .option("--dry-run", "validate and report without publishing or committing")
  .option(
    "--bump-only",
    "commit the root and optional client versions without publishing",
  )
  .addOption(
    new Option("--alpha", "use the alpha prerelease identifier").conflicts(
      "beta",
    ),
  )
  .addOption(
    new Option("--beta", "use the beta prerelease identifier").conflicts(
      "alpha",
    ),
  )
  .action(async (increment: string, options: ReleaseOptions) => {
    const versionIncrement = releaseIncrement(increment)
    const id = prereleaseId(options)
    const dryRun = options.dryRun === true
    if (options.bumpOnly) {
      bumpOnly(process.cwd(), versionIncrement, id, dryRun)
      return
    }
    await publish(process.cwd(), versionIncrement, id, dryRun)
  })

program
  .command("check-registries")
  .description("check that configured private root dependencies are readable")
  .action(() => {
    checkRegistries(process.cwd())
  })

program
  .command("prepare")
  .description("print package_version and should_publish")
  .action(() => {
    prepare(process.cwd())
  })

program
  .command("check-pack")
  .description("dry-run pack the root and optional client")
  .action(() => {
    checkPack(process.cwd())
  })

try {
  await program.parseAsync()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Error: ${message}\n`)
  process.exitCode = 1
}
