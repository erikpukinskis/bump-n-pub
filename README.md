Perhaps you are lazy, and don't want to have to do the work of manually tagging
a release, updating your package.json, checking if you're logged in to NPM,
running `npm publish`, and pushing the new version to Github...

**bump-n-pub** does all of that for you in one command:

### Usage

```
Usage: npx bump-n-pub increment [--github] [--dry-run] [--alpha] [--beta]

Options:
  increment    How much to bump:
                   major — breaking change
                   minor — new feature
                   patch — bug fix
                   prerelease — beta.1, beta.2, etc
  --alpha       do an alpha prerelease of the new version
  --beta        do a beta prerelease of the new version
  --github      publish to the Github registry instead of the npmjs.com one
  --dry-run     Don't actually _do_ the release, just check things out
```

You can publish to the Github registry instead of the npmjs.com one, by setting
the `$NPM_PKG_TOKEN` environment variable and using the --github flag:

```
NPM_PKG_TOKEN=[personal access token] npx bump-n-pub minor --github
```

You can make a personal access token [in your Github settings](https://github.com/settings/tokens).
It must have the `write:packages` scope.

Do a dry-run by appending --dry-run:

```
npx bump-n-pub major dry-run
```

Alpha and beta prereleases can be done by adding those flags. For example if the version is at `1.1.3` by running...

```
npx bump-n-pub minor --alpha
```

...the new version would be `1.2.0-alpha.0`

### What it does
1. Logs you in to NPM if needed
2. Makes sure your working directory is clean
3. Makes sure you can fast forward
4. Runs `npm version [major | minor | etc...]`
    - Creates a git tag "vX.Y.Z"
    - Updates your package.json version to "X.Y.Z"
    - Commits that change
5. [--github only] copies your auth token into an .npmrc
6. Confirms the version is correct before publishing
7. Temporarily removes the `devDependencies` from your package.json so package consumers don't need to install them
8. Runs npm publish
9. Tags your release as @latest or @next appropriately
10. Runs git push
11. Pushes the new tag

If any of that fails, it tries to clean up gracefully.

### Todo
* [ ] Call it `pre` instead of `prerelease`? Or just presume the prerelease increment if you omit it?
* [ ] Rewind the commit & tag if publish fails
* [ ] Don't push prerelease tags to Github?
* [ ] Don't leave package.json in a bad state when trying to publish to github but not authed
