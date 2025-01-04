#!/bin/sh
if [ $# != 1 ]; then
  echo Usage: ./release.sh 1.2.3
  exit 1
fi

new_version="$1"
gsed -i 's/"version": ".*"/"version": "'$new_version'"/' vscode-aeon/package.json
git commit -am "Release $new_version"
git tag -a v$new_version -m "vscode-aeon $new_version"

git push
git push --tags
