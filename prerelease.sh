#!/bin/sh
if [ $# != 1 ]; then
  echo Usage: ./prerelease.sh 1.2.3
  exit 1
fi

msed () {
    case $(uname -s) in
        *[Dd]arwin* | *BSD* ) gsed "$@";;
        *) sed "$@";;
    esac
}

new_version="$1"
msed -i 's/"version": ".*"/"version": "'$new_version'"/' vscode-aeon/package.json
git commit -am "Release $new_version (pre-release)"
git tag -a v$new_version-pre -m "vscode-aeon $new_version (pre-release)"

git push
git push --tags
