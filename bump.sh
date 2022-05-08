#/bin/bash
newversion=$1
flag=$2
arg_count=$#

##################
# Helper functions

function usage {
  echo ""
  echo "Publish to npmjs.com:"
  echo "npx bump-n-pub [major | minor | patch | premajor | preminor | prepatch | prerelease]"
  echo ""
  echo "Publish to Github:"
  echo "npx bump-n-pub [major | minor etc...] --github"
}

function generic_validation {
  if [ $arg_count -eq 0 ]; then
    echo "Error: Must provide a level"
    usage
    exit 1
  fi

  if echo $newversion | grep -Eqv '^(major|minor|patch|premajor|preminor|prepatch|prerelease)$'; then
    echo "Error: Invalid version: $1"
    usage
    exit 1
  fi

  if git diff --stat | grep -E '.' > /dev/null; then
    echo "Error: Working directory must be clean to bump'n'pub"
    git diff --stat
    exit 1
  fi

  git fetch
  branch_name=`git symbolic-ref --short HEAD`
  out=$( git merge-base --is-ancestor origin/$branch_name HEAD )

  if [ $? -eq 1 ]; then
    echo "Error: There are changes on origin/$branch_name. This script can only fast forward the remote branch. Try git pull --rebase"
    exit 1
  fi
}

function prepare_for_github {
  echo "Preparing to publish packge to Github..."

  if [ "$NPM_PKG_TOKEN" = "" ]; then
    echo "Error: No \$NPM_PKG_TOKEN found in env"
  fi

  if [ test -f ".npmrc" ]; then
    echo "Error: To publish to Github, this script must write an .npmrc with an auth token but an .npmrc already exists"
    exit 1
  fi

  echo "//npm.pkg.github.com/:_authToken=$NPM_PKG_TOKEN" > .npmrc
}

function prepare_for_npm {
  echo "Preparing to publish packge to npmjs.com..."

  npm login

  if npm whoami > /dev/null 2>&1; echo $? | grep -Eq '1'; then
    npm adduser
  fi
}


########
# Script

generic_validation

if [ "$flag" = "--github" ]; then
  prepare_for_github
else
  prepare_for_npm
fi

version="v`npm version $newversion`"

git commit -m $version
git tag $version
npx json -f package.json -I -e "delete this.devDependencies"
npm publish
git checkout -- package.json
git push
git push origin version
