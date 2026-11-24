#!/bin/sh
# Replaces the file $1/$2 with stdin in one rename, so a reader sees the old content or the new, never part of it:
# the directory mode 700, the file 600 (session.ts runs it for the session file).
set -eu
umask 077
mkdir -p "$1"
chmod 700 "$1"
tmp=$(mktemp "$1/.$2.XXXXXX")
trap 'rm -f "$tmp"' EXIT
cat >"$tmp"
mv -f "$tmp" "$1/$2"
