#/bin/bash
arg=$1

function usage {
  echo ""
  echo "Usage:"
  echo "npx bump-n-sub [major | minor | patch | premajor | preminor | prepatch | prerelease]"
  echo ""
}

if ! [[ $arg ]]; then
  echo "Error: Must provide a level"
  usage
  exit 1
fi

levels='major|minor|patch|premajor|preminor|prepatch|prerelease'

if ! [[ $arg =~ $levels ]]; then
  echo "Error: Invalid version: $1"
  usage
  exit 1
fi

if [[ $(git diff --stat) != '' ]]; then
  echo "Error: Working directory must be clean to bump'n'pub"
  git diff --stat
  exit 1
fi

git commit -m "v`npm version $arg`"
npx json -f package.json -I -e "delete this.devDependencies"
npm publish --access public
git checkout -- package.json
git push
