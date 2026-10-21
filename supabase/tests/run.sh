#!/usr/bin/env bash
# Runs the plain SQL tests against the local Supabase database.
# Usage: pnpm test:sql   (after `supabase start` and `supabase db reset`)
# DB_URL overrides the default local connection string.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found; install the Postgres client to run SQL tests" >&2
  exit 1
fi
status=0
for f in "$DIR"/[0-9][0-9]_*.sql; do
  name="$(basename "$f")"
  if out="$(psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
    echo "ok   $name"
    if [ -n "${VERBOSE:-}" ]; then echo "$out"; fi
  else
    echo "FAIL $name"
    echo "$out" | grep -v -E '^(BEGIN|ROLLBACK|DO|SET|RESET)$' | tail -20
    status=1
  fi
done
exit $status
