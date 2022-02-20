#/bin/bash
if [[ $(git diff --stat) != '' ]]; then
  echo 'Working directory must be clean to bump-n-pub'
  exit 1
else
git reset
git add package.json
git commit -m "v`npm version minor`"
npx json -f package.json -I -e "delete this.devDependencies"
npm publish --access public
git checkout -- package.json
git push
