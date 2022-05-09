#/bin/bash
increment=$1
flag=$2

usage() {
  echo "Usage: npx bump-n-pub newversion [--github] [--dry-run]"
  echo ""
  echo "Options:"
  echo "  newversion           How much to bump:"
  echo "                         major — breaking change"
  echo "                         minor — new feature"
  echo "                         patch — bug fix"
  echo "                         premajor - etc"
  echo "                         preminor"
  echo "                         prepatch"
  echo "                         prerelease"
  exit 1
}

print_help () { echo "Option -f \${file}: Set file"; exit 0; }
fail () { echo "Error: $*" >&2; exit 1; }
unset file

OPTIND=1
while getopts :f:h-: option
do case $option in
       h ) print_help;;
       f ) file=$OPTARG;;
       - ) case $OPTARG in
               file ) fail "Option \"$OPTARG\" missing argument";;
               file=* ) file=${OPTARG#*=};;
               help ) print_help;;
               help=* ) fail "Option \"${OPTARG%%=*}\" has unexpected argument";;
               * ) fail "Unknown long option \"${OPTARG%%=*}\"";;
            esac;;
        '?' ) fail "Unknown short option \"$OPTARG\"";;
        : ) fail "Short option \"$OPTARG\" missing argument";;
        * ) fail "Bad state in getopts (OPTARG=\"$OPTARG\")";;
   esac
done
shift $((OPTIND-1))

echo "File is ${file-unset}"

for (( i=1; i<=$#; ++i ))
do printf "\$@[%d]=\"%s\"\n" $i "${@:i:1}"
done


exit

##################
# Helper functions

usage () {
  echo ""
  echo "Publish to npmjs.com:"
  echo "npx bump-n-pub [major | minor | patch | premajor | preminor | prepatch | prerelease]"
  echo ""
  echo "Publish to Github:"
  echo "npx bump-n-pub [major | minor etc...] --github"
}

generic_validation () {
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

prepare_for_github () {
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

prepare_for_npm () {
  echo "Preparing to publish packge to npmjs.com..."

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

version=`npm version $newversion`

git commit -m $version
npx json -f package.json -I -e "delete this.devDependencies"
npm publish
git checkout -- package.json
git push
git push origin $version
