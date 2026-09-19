#!/usr/bin/env bash
# Builds the card-database snapshot that ships INSIDE the mobile app, so a fresh
# install can scan before it has downloaded anything.
#
#   npm run catalog:snapshot
#
# Run it before making a native build (`expo run:ios` / an archive). It exports
# the current `cards` table (anon key only, same as the published catalog),
# builds the mobile bundle, and writes apps/mobile/assets/catalog-snapshot.db.
# That file is git-ignored on purpose: it is ~40 MB and changes daily. Without
# it the app still builds and runs; it just asks the user to download the
# database instead (see apps/mobile/src/catalog.ts, installBundledCatalog).
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="apps/mobile/assets/catalog-snapshot.db"
TMP_CARDS="$(mktemp -t catalog-cards).jsonl"
trap 'rm -f "$TMP_CARDS"' EXIT

mkdir -p "$(dirname "$OUT")"
npx tsx scripts/export-catalog.ts "$TMP_CARDS"
npm run catalog:build -w @upkeep/scan-core -- "$TMP_CARDS" "$PWD/$OUT" "$(date -u +%Y-%m-%dT%H%M%SZ)"
echo "[catalog-snapshot] wrote $OUT ($(du -h "$OUT" | cut -f1))"
