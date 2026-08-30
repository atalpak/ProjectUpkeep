#!/usr/bin/env bash
#
# Applies every migration in supabase/migrations to a throwaway Postgres
# database, then runs supabase/tests/schema_test.sql against it.
#
# This is a schema check, not a Supabase check: it stubs auth.users and
# auth.uid() (see supabase/tests/_shim_auth.sql) so the SQL can be exercised on
# a stock Postgres. It catches the things that actually bite — typos, bad
# constraint syntax, triggers that don't fire, RLS policies that don't isolate
# users — without needing Docker or a Supabase project.
#
# Usage:
#   PGURL=postgres://... ./scripts/verify-migrations.sh
#   ./scripts/verify-migrations.sh              # uses a local cluster on :55432
#
set -euo pipefail

cd "$(dirname "$0")/.."

PGHOSTOPTS=${PGURL:-}
DBNAME=${DBNAME:-mtg_verify}

if [[ -n "$PGHOSTOPTS" ]]; then
  BASE="psql $PGHOSTOPTS"
else
  BASE="psql -h ${PGHOST:-localhost} -p ${PGPORT:-55432} -U ${PGUSER:-postgres}"
fi

RUN="$BASE -v ON_ERROR_STOP=1 -X -q -d $DBNAME"

echo "==> recreating database $DBNAME"
$BASE -X -q -d postgres -c "drop database if exists $DBNAME;" -c "create database $DBNAME;"

echo "==> applying auth/platform shim"
$RUN -f supabase/tests/_shim_auth.sql

echo "==> applying migrations"
for f in supabase/migrations/*.sql; do
  echo "    $f"
  $RUN -f "$f"
done

echo "==> running schema tests"
$RUN -f supabase/tests/schema_test.sql

echo "==> OK"
