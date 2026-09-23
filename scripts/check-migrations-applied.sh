#!/usr/bin/env bash
#
# Fails loudly when a migration file exists locally but was never applied to
# the linked production project.
#
# This is the exact drift that has bitten twice: migrations 36-38 went
# unapplied and broke adding cards to the collection, and migration 40 (the
# trade-item language snapshot) sat local-only for hours on 2026-09-22 before
# anyone noticed by running `supabase migration list --linked` by hand. Both
# times the schema and the code agreed with each other -- CI's own
# `verify-migrations.sh` run was green -- because that check applies every
# migration to a *throwaway* Postgres, which proves the migrations are
# internally consistent but says nothing about whether production has caught
# up. This script is the other half: it compares local migration files
# against what the linked project has actually run.
#
# Two ways to reach the project, so this works the same locally and in CI:
#   - Locally: whatever `supabase link` session is already active (the
#     project ref lives in the gitignored supabase/.temp/, same as every
#     other `--linked` command in this repo already relies on).
#   - In CI: SUPABASE_ACCESS_TOKEN (a secret) plus SUPABASE_PROJECT_ID (not
#     secret -- it's the same ref embedded in NEXT_PUBLIC_SUPABASE_URL,
#     https://<ref>.supabase.co). Passed as --project-ref so no `supabase
#     link` state is needed on a fresh checkout.
#
# Neither configured (a PR from a fork, a fresh clone with no CLI session)?
# This SKIPS with a warning, not a failure -- a check that can't reach
# production must never be the thing that blocks an unrelated PR.
#
# Usage: npm run check:migrations
set -euo pipefail
cd "$(dirname "$0")/.."

RAW="$(mktemp)"
trap 'rm -f "$RAW"' EXIT

if [[ -n "${SUPABASE_PROJECT_ID:-}" ]]; then
  REF_ARGS=(--project-ref "$SUPABASE_PROJECT_ID")
else
  REF_ARGS=(--linked)
fi

if ! npx supabase migration list "${REF_ARGS[@]}" >"$RAW" 2>/dev/null; then
  echo "==> could not reach the linked Supabase project (no CLI session and no SUPABASE_ACCESS_TOKEN/SUPABASE_PROJECT_ID) -- skipping"
  exit 0
fi

DRIFT="$(node -e '
  const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const missing = (data.migrations || []).filter((m) => m.local && !m.remote).map((m) => m.local);
  process.stdout.write(missing.join("\n"));
' "$RAW")"

if [[ -n "$DRIFT" ]]; then
  echo "==> migration(s) merged to main but NOT applied to production:"
  echo "$DRIFT" | sed 's/^/    /'
  echo "==> apply with: npx supabase db push --linked"
  exit 1
fi

echo "==> local and production migrations are in sync"
