# bump-n-pub

`bump-n-pub` publishes an npm package manually and provides the small release
commands shared by MultiplayerDB services. It is a Node 24 ES-module CLI.

## Manual publishing

Pass a semantic-version increment as the first argument:

```text
bump-n-pub <major|minor|patch|prerelease> [--dry-run] [--alpha|--beta]
```

The command requires a clean worktree and a current branch whose remote can be
fast-forwarded. It checks npm access, delegates the version commit and tag to
`npm version`, asks for confirmation, publishes the root package, then pushes
the commit and tag. Prereleases use the `next` npm distribution tag.

`--dry-run` creates and then removes the local version commit and tag without
publishing or pushing. Declining the confirmation does the same. Once an
`npm publish` attempt starts, the commit and tag are retained so an ambiguous
registry or network failure can be recovered manually.

The package's standard `publishConfig.registry` selects its publication
registry. When that field is absent, npm uses its normal configured registry.
Registry credentials remain in npm configuration or environment variables.

```sh
yarn bump-n-pub minor
yarn bump-n-pub patch --beta
yarn bump-n-pub major --dry-run
```

## Coordinated service commands

These commands support a publishable root package and, optionally, a
publishable `client` workspace declared exactly as `"client"`. The root and
client must have matching versions. Other workspace layouts are rejected.

### Bump only

```text
bump-n-pub <major|minor|patch|prerelease> --bump-only [--dry-run] [--alpha|--beta]
```

`--bump-only` updates the root and optional client versions and commits their
manifests together. It does not fetch, authenticate, prompt, tag, publish, or
push. With `--dry-run`, it validates the project and prints the calculated
version without changing files.

### Check private registries

```text
bump-n-pub check-registries
```

This reads the configured scopes from `yarn config get npmScopes --json`, then
checks root dependencies and development dependencies belonging to those
scopes with `yarn npm info`. Successful queries are quiet. Yarn's output is
shown unchanged when a query fails.

### Prepare a workflow release

```text
bump-n-pub prepare
```

`prepare` requires `GITHUB_REF_NAME`. Stable versions also require
`PUBLISHING_BRANCHES`, a JSON array of branch names. Prereleases may publish
from any branch. Every run queries the exact root and optional client version,
including runs on branches that cannot publish, and rejects a partially
published release group.

Each manifest's `publishConfig.registry` is used for its version query. If
`NODE_AUTH_TOKEN` is set, it is supplied to npm for that registry. The command
prints exactly two lines, suitable for redirecting to `GITHUB_OUTPUT`:

```text
package_version=1.4.0
should_publish=true
```

### Inspect package contents

```text
bump-n-pub check-pack
```

`check-pack` runs `yarn pack --dry-run` in the root and optional client
directories. It does not build or edit either package.
