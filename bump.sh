#/bin/bash
arg=$1

ps -p $$

usage () {
  echo ""
  echo "Usage:"
  echo "npx bump-n-sub [major | minor | patch | premajor | preminor | prepatch | prerelease]"
  echo ""
}

if [ $# -eq 0 ]; then
  echo "Error: Must provide a level"
  usage
  exit 1
fi

if echo $arg | grep -Eqv '^(major|minor|patch|premajor|preminor|prepatch|prerelease)$'; then
  echo "Error: Invalid version: $1"
  usage
  exit 1
fi


if git diff --stat | grep -E '.'; then
  echo "Error: Working directory must be clean to bump'n'pub"
  git diff --stat
  exit 1
fi

git commit -m "v`npm version $arg`"
npx json -f package.json -I -e "delete this.devDependencies"
npm publish
git checkout -- package.json
git push
