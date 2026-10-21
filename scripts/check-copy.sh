#!/usr/bin/env bash
# Owner rule: no em dashes (U+2014) or en dashes (U+2013) anywhere in UI copy
# or docs. Prints file:line for every hit and exits 1 if there is any.
# The characters are built from their UTF-8 bytes so this file never contains them.
set -euo pipefail

cd "$(dirname "$0")/.."

EM=$(printf '\xe2\x80\x94')
EN=$(printf '\xe2\x80\x93')

targets=()
for t in src docs supabase README.md AGENTS.md; do
  [ -e "$t" ] && targets+=("$t")
done

if hits=$(LC_ALL=C grep -rnI -e "$EM" -e "$EN" "${targets[@]}"); then
  echo "Em or en dash found. Rewrite with a period, comma, colon, or plain hyphen:"
  echo "$hits"
  exit 1
fi

echo "check:copy ok: no em or en dashes in ${targets[*]}"
