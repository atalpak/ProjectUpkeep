# Reliability and performance review

> Historical (2026-09-16). Findings about the Flutter original still stand as written; statements about this app's scanner ("Recognition runs once per capture", manual still capture, 40 MB download cap) predate the 2026-09-18 live scanner and the 80 MB download cap. See `.claude/rules/mobile.md`.

Reviewed 2026-09-16. Severity reflects implications for mobile collection writes, not an assertion that all legacy defects were reproduced on hardware. The original Flutter code remains unchanged for comparison.

## Original scanner findings

| Priority | Evidence | Impact / rebuild treatment |
| --- | --- | --- |
| High | Android `MainActivity.kt` only handles `detectCard` | OCR and artwork are effectively iOS-only despite the cross-platform UI. New Android OCR implementation is provided. |
| High | iOS `cachedFeaturePrint` uses synchronous `Data(contentsOf:)`; Dart `.timeout()` wraps the caller | A timed-out request keeps native work running. New native comparator only accepts local references, has a 16-file bound, and does no networking. It is not yet enabled in the UI. |
| High | iOS artwork winner uses only `best < runnerUp * 0.90` | Similar artwork or border variants can give false printing certainty. Rebuild treats visual ranking as a hint; every printing is explicitly reviewed. |
| Medium | `findPaperPrintings` returns only first Scryfall page; scanner compares a limited subset | A correct printing may be omitted. Rebuild searches a supplied local catalog; UI still caps suggestions at 50, so catalog completeness and explicit set filtering need follow-up. |
| Medium | Static `_memoryCache` / artwork feature cache have no eviction | Long sessions can grow memory. New matching index is fixed per bundle; there is no unbounded network artwork cache. |
| Medium | Cache and history files are rewritten as JSON; errors mostly swallowed | Disk-full and interrupted writes can lose state without a clear user signal. New catalog retains two slots; an uncertain collection save is retained and surfaced. |
| Medium | `OfflineCardIndex.download` relies on `jsonl_download_uri`, gzip decoding, no total deadline, and does not close its local HTTP client | Remote format/transport assumptions and unbounded waits are fragile. Rebuild uses a versioned first-party bundle with streaming byte cap and deadline. This review does not assert that Scryfall's present API format differs. |
| Medium | Price/history presentation and some fallbacks choose a card before an exact printing is confirmed | A name match is insufficient for inventory value/finish. Rebuild has no inferred pricing and no unreviewed collection writes. |
| Low | `DEVELOPMENT.md` describes an earlier milestone despite later OCR/artwork code | Handoff is stale. New docs identify actual completed work and remaining gates. |

Legacy baseline: 17 tests pass; static analyzer reports two informational `use_null_aware_elements` lints in `card_text_reader.dart`. Tests do not establish real-world camera accuracy.

## New design checks

- Pure unit tests cover Unicode aliases, ambiguous printings, fuzzy matching, invalid catalog data, field validation, cancellation, duplicate taps, fallback failures, untrusted model IDs, lost write responses, and cross-account replay rejection.
- Lookup uses normalized-name maps and inverted trigram postings. Exact lookup does not scan all records. Fuzzy matching gathers posting overlaps and limits detailed scoring to 256 names. Very common trigrams still touch many entries; do not describe it as constant-time.
- Recognition runs once per capture, not on every preview frame. Native work stays off the UI thread, and only text crosses into JavaScript.
- Only three required font files are imported, avoiding bundling every font weight through package index exports.
- Catalog size is capped at 40 MB in the builder and streamed download. Object/index memory is larger than serialized size. Parsing/index construction still occurs on the JS thread; large catalogs can briefly stall UI. Sharding/SQLite or native indexing is the next performance step if device measurements require it.
- Supabase requests have a connection/response-header deadline. Request-body consumption after headers is managed by the Supabase client, so this is not a full streaming-body deadline. Do not auto-retry writes under a new ID.
- Staging writes before sending protects app-restart recovery. The user's explicit confirmation remains necessary, and no background queue sends data unexpectedly.
- The collection adapter validates UI inputs and relies on the existing database for security. Client validation is never a replacement for RLS and database constraints.

## Open limitations, in priority order

1. Test live auth/RLS and collection round-trip in a development backend. No production database was touched.
2. Validate real camera accuracy and latency on physical iOS and Android hardware. Android ships only Latin OCR. iOS auto-language detection is platform dependent.
3. Merge web/mobile write logic transactionally before claiming web-equivalent stacking. The current append-row behavior is intentionally documented.
4. Build and publish a real daily catalog bundle; the included three records are synthetic demo data.
5. Integrate and calibrate optional artwork comparison with bounded reference downloads/cache; global image-only identification remains unimplemented.
6. Add explicit set/collector-number filtering for names with more than 50 printings. Currently these are ranking hints from OCR plus a limited review list.
7. Complete password reset/OAuth, collection browsing/deck screens, and accessibility/device UI QA. This phase supplies scanner UI and session history only. (Persistent auth shipped in phase 1b.)
8. Decide recovery UX when a pending row was edited/deleted elsewhere or its location is no longer permitted. Never silently drop the pending operation and re-add.

## Dependency audit

`npm audit` reports nine moderate findings, all along Expo's build-tool dependency chain to `xcode` → `uuid` 7 (GHSA-w5hq-g745-h8pq); no high or critical findings were reported. The inspected `xcode` path calls UUID v4, while the advisory concerns the buffer APIs for v3/v5/v6. This does not prove the dependency is universally safe. No forced SDK downgrade or unverified override is retained. Track an upstream compatible fix and re-run the audit before release. The scanner itself uses Expo Crypto for operation IDs.

The React Native 0.83 / Gradle 9 Foojay compatibility issue is handled by a narrow, repeatable postinstall patch, documented in `HANDOFF.md`. The patch changes the upstream plugin pin from 0.5.0 to 1.0.0; remove it once the upstream backport is included.
