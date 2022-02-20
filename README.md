Perhaps you are lazy, and don't want to have to do the work of manually tagging a release,
updating your package.json, running `npm publish`, and pushing the new version to Github...

**bump-n-pub** does all of that for you in one command:

### Usage

```bash
npx bump-n-pub [major | minor | patch | premajor | preminor | prepatch | prerelease]
```

### What it does
1. Makes sure your working directory is clean
2. Runs `npm version [major | minor | etc...]`
    - Creates a git tag "vX.Y.Z"
    - Updates your package.json version to "X.Y.Z"
    - Commits that change
3. Runs npm publish
4. Runs git push
