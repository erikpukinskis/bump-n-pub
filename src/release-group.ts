import { globSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { CliError, errorMessage } from "./errors.js";

const WorkspacesSchema = z.union([
  z.array(z.string()),
  z.object({ packages: z.array(z.string()) }),
]);

const WorkspaceManifestSchema = z
  .object({
    name: z.string().min(1).optional(),
    version: z.string().min(1).optional(),
    private: z.boolean().optional(),
    workspaces: WorkspacesSchema.optional(),
  })
  .loose();
type WorkspaceManifest = z.infer<typeof WorkspaceManifestSchema>;

export const PackageManifestSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    private: z.boolean().optional(),
    workspaces: WorkspacesSchema.optional(),
    publishConfig: z.record(z.string(), z.unknown()).optional(),
    dependencies: z.record(z.string(), z.string()).optional(),
    optionalDependencies: z.record(z.string(), z.string()).optional(),
    peerDependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
  })
  .loose();

export type PackageManifest = z.infer<typeof PackageManifestSchema>;

export type ReleasePackage = {
  name: string;
  version: string;
  directory: string;
  manifestPath: string;
  relativeManifestPath: string;
  manifest: PackageManifest;
  registry: string;
};

export type ReleaseGroup = {
  root: string;
  packages: ReleasePackage[];
  version: string;
};

const YarnRegistrySchema = z
  .object({
    npmRegistryServer: z.string().url().optional(),
    npmPublishRegistry: z.string().url().optional(),
  })
  .loose();

const YarnConfigSchema = z
  .object({
    npmRegistryServer: z.string().url().optional(),
    npmScopes: z.record(z.string(), YarnRegistrySchema).optional(),
  })
  .loose();

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new CliError(`Could not parse ${path}: ${errorMessage(error)}`);
  }
}

export function readManifest(path: string): PackageManifest {
  const parsed = PackageManifestSchema.safeParse(readJson(path));
  if (!parsed.success) {
    throw new CliError(
      `Invalid package manifest ${path}: ${z.prettifyError(parsed.error)}`,
    );
  }

  return parsed.data;
}

function readWorkspaceManifest(path: string): WorkspaceManifest {
  const parsed = WorkspaceManifestSchema.safeParse(readJson(path));
  if (!parsed.success) {
    throw new CliError(
      `Invalid workspace manifest ${path}: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

function readYarnConfig(root: string): z.infer<typeof YarnConfigSchema> {
  const path = join(root, ".yarnrc.yml");
  let source: string;

  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }
    throw new CliError(`Could not read ${path}: ${errorMessage(error)}`);
  }

  let untypedConfig: unknown;
  try {
    untypedConfig = parseYaml(source);
  } catch (error) {
    throw new CliError(`Could not parse ${path}: ${errorMessage(error)}`);
  }

  const parsed = YarnConfigSchema.safeParse(untypedConfig);
  if (!parsed.success) {
    throw new CliError(`Invalid ${path}: ${z.prettifyError(parsed.error)}`);
  }

  return parsed.data;
}

function packageScope(name: string): string | undefined {
  const match = /^@([^/]+)\//.exec(name);
  return match?.[1];
}

function packageRegistry(
  manifest: PackageManifest,
  yarnConfig: z.infer<typeof YarnConfigSchema>,
): string {
  const scope = packageScope(manifest.name);
  const scopeConfig = scope ? yarnConfig.npmScopes?.[scope] : undefined;
  const manifestRegistry = manifest.publishConfig?.registry;

  if (scopeConfig?.npmRegistryServer) {
    return scopeConfig.npmRegistryServer;
  }
  if (scopeConfig?.npmPublishRegistry) {
    return scopeConfig.npmPublishRegistry;
  }
  if (typeof manifestRegistry === "string") {
    return manifestRegistry;
  }

  return yarnConfig.npmRegistryServer ?? "https://registry.yarnpkg.com";
}

function workspacePatterns(manifest: WorkspaceManifest): string[] {
  if (!manifest.workspaces) {
    return [];
  }
  return Array.isArray(manifest.workspaces)
    ? manifest.workspaces
    : manifest.workspaces.packages;
}

function manifestPaths(root: string, rootManifest: WorkspaceManifest): string[] {
  const paths = new Set<string>([join(root, "package.json")]);

  for (const pattern of workspacePatterns(rootManifest)) {
    if (pattern.startsWith("/") || pattern.split(/[\\/]/).includes("..")) {
      throw new CliError(`Workspace pattern must stay within the project: ${pattern}`);
    }

    const matches = globSync(`${pattern.replace(/\/$/, "")}/package.json`, {
      cwd: root,
      exclude: ["**/node_modules/**", "**/.yarn/**"],
    });

    for (const match of matches) {
      paths.add(resolve(root, match));
    }
  }

  return [...paths].sort((left, right) => {
    if (left === join(root, "package.json")) return -1;
    if (right === join(root, "package.json")) return 1;
    return left.localeCompare(right);
  });
}

export function discoverReleaseGroup(projectRoot: string): ReleaseGroup {
  const root = resolve(projectRoot);
  const rootManifestPath = join(root, "package.json");
  const rootManifest = readWorkspaceManifest(rootManifestPath);
  const yarnConfig = readYarnConfig(root);
  const packages: ReleasePackage[] = [];
  const packageNames = new Set<string>();

  for (const manifestPath of manifestPaths(root, rootManifest)) {
    const workspaceManifest =
      manifestPath === rootManifestPath
        ? rootManifest
        : readWorkspaceManifest(manifestPath);

    if (workspaceManifest.private === true) {
      continue;
    }
    const parsedManifest = PackageManifestSchema.safeParse(workspaceManifest);
    if (!parsedManifest.success) {
      throw new CliError(
        `Publishable workspace ${manifestPath} must have a name and version: ${z.prettifyError(parsedManifest.error)}`,
      );
    }
    const manifest = parsedManifest.data;
    if (packageNames.has(manifest.name)) {
      throw new CliError(`Release group contains duplicate package name ${manifest.name}`);
    }

    packageNames.add(manifest.name);
    packages.push({
      name: manifest.name,
      version: manifest.version,
      directory: dirname(manifestPath),
      manifestPath,
      relativeManifestPath: relative(root, manifestPath).split(sep).join("/"),
      manifest,
      registry: packageRegistry(manifest, yarnConfig),
    });
  }

  if (packages.length === 0) {
    throw new CliError("The project has no publishable release-group packages");
  }

  const versions = new Map<string, string[]>();
  for (const releasePackage of packages) {
    const names = versions.get(releasePackage.version) ?? [];
    names.push(releasePackage.name);
    versions.set(releasePackage.version, names);
  }

  if (versions.size !== 1) {
    const detail = [...versions.entries()]
      .map(([version, names]) => `${version}: ${names.join(", ")}`)
      .join("; ");
    throw new CliError(`Release-group package versions do not match (${detail})`);
  }

  const firstPackage = packages[0];
  if (!firstPackage) {
    throw new CliError("The project has no publishable release-group packages");
  }

  return { root, packages, version: firstPackage.version };
}

export function writeManifest(
  releasePackage: ReleasePackage,
  manifest: PackageManifest,
): void {
  const current = z
    .record(z.string(), z.unknown())
    .parse(readJson(releasePackage.manifestPath));
  const ordered: Record<string, unknown> = {};

  for (const key of Object.keys(current)) {
    if (Object.hasOwn(manifest, key)) {
      ordered[key] = manifest[key];
    }
  }
  for (const [key, value] of Object.entries(manifest)) {
    if (!Object.hasOwn(current, key)) {
      ordered[key] = value;
    }
  }

  writeFileSync(
    releasePackage.manifestPath,
    `${JSON.stringify(ordered, null, 2)}\n`,
  );
}
