Perhaps you are lazy, and don't want to have to do the work of manually tagging
a release, updating your package.json, checking if you're logged in to NPM,
running `npm publish`, and pushing the new version to Github...

**bump-n-pub** does all of that for you in one command:

### Usage

```bash
npx bump-n-pub [major | minor | patch | premajor | preminor | prepatch | prerelease]
```

### What it does
1. Logs you in to NPM if needed
2. Makes sure your working directory is clean
3. Runs `npm version [major | minor | etc...]`
    - Creates a git tag "vX.Y.Z"
    - Updates your package.json version to "X.Y.Z"
    - Commits that change
4. Runs npm publish
5. Runs git push

### Future
- [ ] Push git tags
