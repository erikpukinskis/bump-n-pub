#!/bin/bash
set -e

##################
# Helper functions

usage() {
  echo "Usage: npx bump-n-pub increment [--github] [--dry-run] [--alpha] [--beta]"
  echo ""
  echo "Options:"
  echo "  increment    How much to bump:"
  echo "                   major — breaking change"
  echo "                   minor — new feature"
  echo "                   patch — bug fix"
  echo "                   prerelease — beta.1, beta.2, etc"
  echo "  --alpha       do an alpha prerelease of the new version"
  echo "  --beta        do a beta prerelease of the new version"
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
  set +e
  git merge-base --is-ancestor origin/$branch_name HEAD

  if [ $? -eq 1 ]; then
    echo "Error: There are changes on origin/$branch_name. This script can only fast forward the remote branch."
    echo ""
    echo "Try git pull --rebase or git push -f"
    exit 1
  fi

  set -e
}

prepare_for_github () {
  echo "Preparing to publish packge to Github..."

  if [ "$NPM_PKG_TOKEN" = "" ]; then
    echo "Error: No \$NPM_PKG_TOKEN found in env"
  fi
}

npmrc_existed=0

copy_auth () {
  if test -f ".npmrc"; then
    npmrc_existed=1
    npmrc=$(cat .npmrc)
  fi
  echo "//npm.pkg.github.com/:_authToken=$NPM_PKG_TOKEN" >> .npmrc
}

clear_auth () {
  if $npmrc_existed -eq 1; then
    echo "npmrc existed"
    rm .npmrc
  else
    echo "npmrc did not exist"
    echo $npmrc > .npmrc
  fi
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
    major|minor|patch|prerelease)
      increment=$arg
      ;;
    "--alpha")
      preid="alpha"
      ;;
    "--beta")
      preid="beta"
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

if ! [ -z "$preid" ]
then
  case $increment in
    major)
      increment="premajor"
      ;;
    minor)
      increment="preminor"
      ;;
    patch)
      increment="prepatch"
      ;;
  esac
  preidflag="--preid $preid"
  tagflag="--tag next"
fi

# echo "increment $increment"
# echo "github $github"
# echo "dry-run $dryrun"
# echo "preid $preid"

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

version=$(npm version $increment $preidflag)

if [ $dryrun -eq 0 ]; then
  read -n1 -p "New version will be $version. Continue? (Y/n) " confirm
  echo ""
fi

cleanup() {
  git tag -d $version
  git reset --hard HEAD^
  exit 1
}

if ! echo $confirm | grep '^[Yy]\?$'; then
  echo "Cleaning up..."
  cleanup
fi

if [ $dryrun -eq 1 ]; then
  echo ""
  echo "✨ Dry run! ✨ version would have been $version"
  echo ""
  cleanup
fi

npx json -f package.json -I -e "delete this.devDependencies"

publish() {
  npm publish $tagflag
}

if  [ $github -eq 1 ]; then
  copy_auth
  publish
  clear_auth
else
  publish
fi

git checkout -- package.json
git push
git push origin $version
