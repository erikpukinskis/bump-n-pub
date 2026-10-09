import { CliError } from "./errors.js";
import { runCommand, type CommandRunner } from "./process.js";
import { discoverReleaseGroup } from "./release-group.js";

export type CheckPackOptions = {
  root: string;
  runner?: CommandRunner;
  env?: NodeJS.ProcessEnv;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
};

export function checkPack(options: CheckPackOptions): void {
  const group = discoverReleaseGroup(options.root);
  const runner = options.runner ?? runCommand;
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? ((message: string) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message: string) => process.stderr.write(message));

  for (const releasePackage of group.packages) {
    stdout(`Inspecting ${releasePackage.name}\n`);
    const result = runner("yarn", ["pack", "--dry-run"], {
      cwd: releasePackage.directory,
      env,
    });
    if (result.stdout) stdout(result.stdout);
    if (result.stderr) stderr(result.stderr);
    if (result.status !== 0) {
      throw new CliError(
        `Could not pack ${releasePackage.name} from ${releasePackage.directory}`,
        result.status,
      );
    }
  }
}
