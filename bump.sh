#/bin/bash


##################
# Helper functions

usage() {
  echo "Usage: npx bump-n-pub newversion [--github] [--dry-run]"
  echo ""
  echo "Options:"
  echo "  newversion    How much to bump:"
  echo "                   major — breaking change"
  echo "                   minor — new feature"
  echo "                   patch — bug fix"
  echo "                   premajor - etc"
  echo "                   preminor"
  echo "                   prepatch"
  echo "                   prerelease"
  echo "  --github      publish to the Github registry instead of the npmjs.com one"
  echo "  --dry-run     Don't actually _do_ the release, just check things out"
  exit 1
}

generic_validation () {
  if ! [ $increment ]; then
    echo "Error: Must provide a level"
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

prepare_for_github () {
  echo "Preparing to publish packge to Github..."

  if [ "$NPM_PKG_TOKEN" = "" ]; then
    echo "Error: No \$NPM_PKG_TOKEN found in env"
  fi

  if test -f ".npmrc"; then
    echo "Error: To publish to Github, this script must write an .npmrc with an auth token but an .npmrc already exists"
    exit 1
  fi
}

copy_auth () {
  echo "//npm.pkg.github.com/:_authToken=$NPM_PKG_TOKEN" > .npmrc
}

clear_auth () {
  rm .npmrc
}

prepare_for_npm () {
  echo "Preparing to publish packge to npmjs.com..."

  if npm whoami > /dev/null 2>&1; echo $? | grep -Eq '1'; then
    npm adduser
  fi
}


########
# Script

args=$(echo $@ | tr " " "\n")
github=0
dryrun=0
for arg in $args
do
  case $arg in
    major|minor)
      increment=$arg
      ;;
    "--github")
      github=1
      ;;
    "--dry-run")
      dryrun=1
      ;;
    *)
      echo "Error: Unrecogied option $arg"
      usage
  esac
done

# echo "increment $increment"
# echo "--github $github"
# echo "--dry-run $dryrun"

if [ -z "$increment" ]
then
  usage
  exit 1
fi

generic_validation


if  [ $github -eq 1 ]; then
  prepare_for_github
else
  prepare_for_npm
fi

if [ $dryrun -eq 1 ]; then
  version=$(npm version $increment)
  echo ""
  echo "✨ Dry run! ✨ version would have been $version"
  echo ""
  git tag -d $version
  git reset --hard HEAD^
  exit 1
fi

version=$(npm version $increment)

git commit -m $version
npx json -f package.json -I -e "delete this.devDependencies"

if  [ $github -eq 1 ]; then
  copy_auth
  npm publish
  clear_auth
else
  npm publish
fi

git checkout -- package.json
git push
git push origin $version
