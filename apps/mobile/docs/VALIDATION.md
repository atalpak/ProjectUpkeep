# Validation record — 2026-09-16

> Historical (2026-09-16). This record predates the live scanner; nothing here validates it. See `.claude/rules/mobile.md`.

This record separates executed checks from release gates. No live Supabase credentials, production writes, or physical-card image corpus were used.

## Executed

| Check | Result |
| --- | --- |
| Original Flutter unit/widget tests | 17 passed |
| Original Flutter static analysis | Two informational `use_null_aware_elements` lints; no analyzer errors |
| New scan-core tests | 12 passed: normalization, ambiguity, fuzzy matching, catalog validation, copy-field validation, cancellation/single flight, fallback behavior, telemetry isolation, duplicate taps, lost-response verification, account isolation |
| TypeScript `tsc --noEmit` | Passed |
| Metro export for iOS and Android | Both platform bundles exported successfully; this validates JS bundling, not native runtime behavior |
| Expo native module autolinking | Custom UpkeepVision module resolved for iOS; Android Gradle reached its compile task after the toolchain patch |
| iOS CocoaPods install | Completed, 98 pods |
| iOS simulator native build | `xcodebuild` succeeded, including UpkeepVision Swift source |
| iOS interactive startup | Development client installed/launched. Initial localhost IPv4/IPv6 mismatch was diagnosed; full review-flow visual smoke test remains unverified at handoff |
| Android native compile | See latest result below; initial RN/Foojay/Gradle incompatibility was fixed with the repeatable postinstall patch |
| Dependency audit | Nine moderate findings in Expo build-tool dependency chain; no high/critical reported. See QUALITY_REVIEW.md |
| Live Supabase / RLS round-trip | Not run |
| Physical camera accuracy / speed | Not run |

## Synthetic performance measurement

`npm run bench`, 50,000 synthetic printings on the development Mac under Node 25:

- Index build: 241 ms.
- Mixed exact/fuzzy search median: 14.85 ms; P95: 45.81 ms.
- Heap delta after construction and 200 searches: approximately 187 MB, including transient allocations (not retained heap after forced GC).

The generated names deliberately share common trigrams. This is a stress case, not a representative real catalog. These are desktop measurements, not phone OCR timings or proof of battery performance. Measure the actual exported catalog on the minimum supported device before selecting the final cache/index design.

## Device and integration acceptance checklist — not completed

- [ ] Physical iPhone: permission grant/deny, camera interruption/background/resume, capture, OCR, temporary file cleanup, review and next card.
- [ ] Physical Android: same lifecycle checks; bundled Latin ML Kit OCR works on first launch without a model download.
- [ ] Ordinary, foil, etched, sleeved, full-art, showcase, split/double-face, damaged and non-English cards have separately reported outcomes.
- [ ] Similar names and same-art border variants never bypass exact-printing review.
- [ ] All physical-copy fields are visible and accessible on a small phone with large text.
- [ ] Real-catalog load/search/refresh meet measured memory and latency budgets; corrupt/partial refresh retains a previous usable bundle.
- [ ] Same test account sees the saved printing, finish, condition, language, quantity and location in web and mobile.
- [ ] Foreign-account locations and rows are blocked by actual RLS/triggers.
- [ ] Duplicate taps, response lost after commit, kill/relaunch, sign-out/sign-in and retry do not add duplicate rows.
- [ ] Pending-save conflict caused by a web edit/delete has a deliberate recovery procedure.
- [ ] Web/mobile stack policy has been unified transactionally before claiming identical stacking behavior.
- [ ] Full Android app build and on-device UI smoke test completed.
- [ ] Release signing, identifiers, icon, privacy disclosures and store submission completed.
