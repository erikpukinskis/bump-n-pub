# bump-n-pub

`bump-n-pub` provides release-policy commands for npm packages and Yarn
workspaces. It requires Node 24 or newer.

Add it to a project and run it through that project's package manager:

```sh
yarn add --dev bump-n-pub
yarn bump-n-pub check-registries
```

## Composable release commands

These commands leave builds, package publication, GitHub releases, images,
tags, and pushes visible in the calling workflow:

```text
bump-n-pub bump <major|minor|patch|prerelease> [--alpha|--beta]
bump-n-pub check-registries
bump-n-pub prepare [--github-actions]
bump-n-pub check-pack
```

The release group is the publishable root package plus its publishable Yarn
workspaces. Private workspaces are ignored. Every selected package must have the
same version; a mismatch fails with the affected package names and versions.

### `bump`

`bump` requires a clean Git worktree, calculates the next semantic version,
updates every release-group manifest, and commits only those manifests with a
`v<version>` message. It does not create a tag, fetch, push, publish, or rewrite
Git history.

```sh
yarn bump-n-pub bump minor
yarn bump-n-pub bump patch --beta
yarn bump-n-pub bump prerelease
```

`--alpha` and `--beta` start a prerelease when combined with `major`, `minor`,
or `patch`. `prerelease` continues the current prerelease identifier unless one
of those flags selects another identifier.

### `check-registries`

`check-registries` queries every package through Yarn using the project's
configured scopes and registries. It treats a package that has never been
published as reachable while reporting authentication, authorization, network,
and malformed-response failures separately.

Registry credentials come from the existing Yarn configuration and
`NODE_AUTH_TOKEN`. The command never creates or changes `.npmrc`.

### `prepare`

`prepare` queries the exact common version and prints one JSON object to stdout:

```json
{"package_version":"1.4.0","should_publish":true,"dist_tag":"latest","reason":"not_published","packages":[{"name":"@example/service","registry":"https://npm.pkg.github.com","published":false}]}
```

Stable releases require `GITHUB_REF_NAME` and a `PUBLISHING_BRANCHES` JSON array.
Prereleases may publish from any branch and use the `preview` distribution tag.
The command rejects a release where only some group members are already
published.

With `--github-actions`, `GITHUB_OUTPUT` is also appended with
`package_version`, `should_publish`, `dist_tag`, and `reason`. Diagnostics are
written to stderr, so stdout remains safe to parse.

```sh
PUBLISHING_BRANCHES='["main"]' GITHUB_REF_NAME=main \
  yarn bump-n-pub prepare --github-actions
```

### `check-pack`

`check-pack` runs `yarn pack --dry-run` in each release-group package. Run the
project's normal build first. This command does not build, edit manifests, or
create package archives.

## All-in-one publishing

The explicit `publish` command preserves the original root-package workflow:

```text
bump-n-pub publish <major|minor|patch|prerelease> [--github] [--dry-run] [--alpha|--beta]
```

It requires a clean worktree and a remote branch that can be fast-forwarded.
It checks registry access, creates the version commit and Git tag, asks for
confirmation, publishes the root package, then pushes the commit and tag.
Prereleases use the `next` distribution tag. `--dry-run` creates and removes the
local commit and tag without publishing or pushing.

The default registry uses the current npm login. `--github` publishes to
`https://npm.pkg.github.com` and requires `NPM_PKG_TOKEN`. The token is passed to
npm through the child-process environment and is not written to `.npmrc` or
included in command output.

```sh
yarn bump-n-pub publish minor
NPM_PKG_TOKEN=... yarn bump-n-pub publish patch --beta --github
yarn bump-n-pub publish major --dry-run
```
