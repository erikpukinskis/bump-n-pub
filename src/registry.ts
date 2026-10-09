import { z } from "zod";

import { CliError } from "./errors.js";
import {
  runCommand,
  type CommandResult,
  type CommandRunner,
} from "./process.js";
import {
  discoverReleaseGroup,
  type ReleasePackage,
} from "./release-group.js";

const PackageInfoSchema = z.object({
  versions: z.array(z.string()),
});

const YarnErrorSchema = z
  .object({
    type: z.string().optional(),
    displayName: z.string().optional(),
    data: z.unknown().optional(),
  })
  .loose();

export type RegistryFailureCategory =
  | "authentication"
  | "authorization"
  | "network"
  | "malformed-response"
  | "command";

export type PackageVersions =
  | { status: "available"; versions: string[] }
  | { status: "unpublished"; versions: [] };

function outputText(result: CommandResult): string {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function yarnErrors(output: string): z.infer<typeof YarnErrorSchema>[] {
  const errors: z.infer<typeof YarnErrorSchema>[] = [];

  for (const line of output.split("\n").map((value) => value.trim())) {
    if (!line.startsWith("{")) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = YarnErrorSchema.safeParse(value);
    if (parsed.success) errors.push(parsed.data);
  }

  return errors;
}

export function isUnpublishedPackageFailure(result: CommandResult): boolean {
  return yarnErrors(outputText(result)).some(
    (error) =>
      error.displayName === "YN0035" &&
      error.data === "Package not found",
  );
}

export function classifyRegistryFailure(
  result: CommandResult,
): RegistryFailureCategory {
  const output = outputText(result);
  const displayNames = yarnErrors(output)
    .map((error) => error.displayName ?? "")
    .join(" ");
  const searchable = `${displayNames}\n${output}`;

  if (
    /ENET|ECONN|EAI_AGAIN|ETIMEDOUT|getaddrinfo|network|socket|request failed/i.test(
      searchable,
    )
  ) {
    return "network";
  }
  if (/YN0041|E401|401|unauthenticated|authentication|unauthorized/i.test(searchable)) {
    return "authentication";
  }
  if (/E403|403|forbidden|permission|not authorized/i.test(searchable)) {
    return "authorization";
  }
  return "command";
}

export function queryPackageVersions(
  releasePackage: ReleasePackage,
  runner: CommandRunner = runCommand,
  env: NodeJS.ProcessEnv = process.env,
): PackageVersions {
  const result = runner(
    "yarn",
    ["npm", "info", releasePackage.name, "--fields", "versions", "--json"],
    { cwd: releasePackage.directory, env },
  );

  if (result.status !== 0) {
    if (isUnpublishedPackageFailure(result)) {
      return { status: "unpublished", versions: [] };
    }

    const category = classifyRegistryFailure(result);
    const detail = outputText(result);
    throw new CliError(
      `${releasePackage.name} registry ${releasePackage.registry} failed (${category})${
        detail ? `:\n${detail}` : ""
      }`,
      result.status,
    );
  }

  let output: unknown;
  try {
    output = JSON.parse(result.stdout);
  } catch {
    throw new CliError(
      `${releasePackage.name} registry ${releasePackage.registry} failed (malformed-response): returned malformed JSON`,
    );
  }

  const parsed = PackageInfoSchema.safeParse(output);
  if (!parsed.success) {
    throw new CliError(
      `${releasePackage.name} registry ${releasePackage.registry} failed (malformed-response): ${z.prettifyError(parsed.error)}`,
    );
  }

  return { status: "available", versions: parsed.data.versions };
}

export type CheckRegistriesOptions = {
  root: string;
  runner?: CommandRunner;
  env?: NodeJS.ProcessEnv;
  write?: (message: string) => void;
};

export function checkRegistries(options: CheckRegistriesOptions): void {
  const group = discoverReleaseGroup(options.root);
  const runner = options.runner ?? runCommand;
  const env = options.env ?? process.env;
  const write = options.write ?? ((message: string) => process.stdout.write(message));

  for (const releasePackage of group.packages) {
    const result = queryPackageVersions(releasePackage, runner, env);
    const status = result.status === "unpublished" ? "unpublished" : "reachable";
    write(`${releasePackage.name}: ${status} (${releasePackage.registry})\n`);
  }
}
