import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

const DependenciesSchema = z.record(z.string(), z.string());
const ManifestSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    private: z.boolean().optional(),
    workspaces: z.unknown().optional(),
    publishConfig: z
      .object({ registry: z.url().optional() })
      .loose()
      .optional(),
    dependencies: DependenciesSchema.optional(),
    devDependencies: DependenciesSchema.optional(),
  })
  .loose();

export type ReleasePackage = {
  dependencies: string[];
  directory: string;
  manifest: Record<string, unknown>;
  manifestPath: string;
  name: string;
  registry: string | undefined;
  relativeManifestPath: string;
  version: string;
};

export type ReleaseGroup = {
  packages: ReleasePackage[];
  root: string;
  version: string;
};

function readPackage(manifestPath: string, relativeManifestPath: string): ReleasePackage {
  let source: unknown;
  try {
    source = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse ${manifestPath}: ${message}`);
  }

  const manifest = z.record(z.string(), z.unknown()).safeParse(source);
  const packageFields = ManifestSchema.safeParse(source);
  if (!manifest.success) {
    throw new Error(
      `Invalid package manifest ${manifestPath}: ${z.prettifyError(manifest.error)}`,
    );
  }
  if (!packageFields.success) {
    throw new Error(
      `Invalid package manifest ${manifestPath}: ${z.prettifyError(packageFields.error)}`,
    );
  }
  if (packageFields.data.private === true) {
    throw new Error(`${manifestPath} is private and cannot be released`);
  }

  return {
    dependencies: Object.keys({
      ...packageFields.data.dependencies,
      ...packageFields.data.devDependencies,
    }),
    directory: dirname(manifestPath),
    manifest: manifest.data,
    manifestPath,
    name: packageFields.data.name,
    registry: packageFields.data.publishConfig?.registry,
    relativeManifestPath,
    version: packageFields.data.version,
  };
}

export function readRootPackage(projectRoot: string): ReleasePackage {
  const root = resolve(projectRoot);
  return readPackage(join(root, "package.json"), "package.json");
}

export function readReleaseGroup(projectRoot: string): ReleaseGroup {
  const root = resolve(projectRoot);
  const rootPackage = readRootPackage(root);
  const workspaces = rootPackage.manifest.workspaces;
  const parsedWorkspaces = z.array(z.string()).safeParse(workspaces ?? []);
  if (
    !parsedWorkspaces.success ||
    (parsedWorkspaces.data.length !== 0 &&
      !(parsedWorkspaces.data.length === 1 && parsedWorkspaces.data[0] === "client"))
  ) {
    throw new Error(
      'Supported package layouts are a root package or a root package with the exact workspace "client"',
    );
  }

  const packages = [rootPackage];
  if (parsedWorkspaces.data[0] === "client") {
    packages.push(readPackage(join(root, "client/package.json"), "client/package.json"));
  }

  const mismatched = packages.filter(
    (releasePackage) => releasePackage.version !== rootPackage.version,
  );
  if (mismatched.length > 0) {
    throw new Error(
      `Package versions do not match (${packages
        .map((releasePackage) => `${releasePackage.name}: ${releasePackage.version}`)
        .join(", ")})`,
    );
  }

  return {
    packages,
    root,
    version: rootPackage.version,
  };
}

export function writeVersion(releasePackage: ReleasePackage, version: string): void {
  releasePackage.manifest.version = version;
  writeFileSync(
    releasePackage.manifestPath,
    `${JSON.stringify(releasePackage.manifest, null, 2)}\n`,
  );
}
