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

## Startup preparation follow-up (2026-09-26)

### Scanner footer regression follow-up (2026-09-26)

Owner reports Book of Mazarbul working, Mouth of Sauron selecting a wrong
printing, and Oliphaunt failing automatic capture but succeeding at manual
capture with a wrong printing. Fixed a reproduced OCR parser collision where
creature power/toughness (for example `4/4`) hid the real collector number.
Footer rarity/set context now outranks unrelated bare numbers. Global default
printing order and native automatic detection are unchanged.

118 scanner tests and 133 mobile tests pass; mobile/scanner typechecks and
the signed Release iOS build pass. The updated build was installed over the
existing iPhone 13 mini app, preserving its container. Regression fixtures
cover Mouth #216, Oliphaunt #426 and Book #116 through both footer ranking and
the full scan pipeline. Actual device correctness remains pending; scan logs
were requested to confirm whether this collision caused the owner's failures.

### Inner-frame footer capture follow-up (2026-09-26)

Owner's Book of Mazarbul log at `2026-09-27T03:42:46.722Z` again selected LTR
#567: no footer evidence, picture distances #116=0.712 vs #567=0.787,
ratio0.905 below the required decisiveness. Copied only the corresponding app
temporary snapshot for diagnosis. Its orange inner-frame crop completely excludes
the black footer containing the collector number. Native OCR reproduces the log
on that snapshot; clear reference images read all three known cards correctly.

Native correction captures a bounded supplemental quad (4% sides, 2% top, 10%
bottom) from the same camera frame. It is used only for footer OCR after both
existing OCR passes fail. Detection gates, original title/art image, picture
thresholds and default printing order stay unchanged. Out-of-frame expansion is
refused. Supplementary crops follow the burst-selected frame and clear on reset.
The synthetic inner-frame Book image regression recovers `U 0116` and `LTR`,
while the original crop misses them. Geometry checks cover tilted cards and
frame-edge refusal. Physical-device acceptance remains pending.
All 91 native geometry checks and the image regression passed, including
unchanged full-card recognition. Signed Release build succeeded; installed
over the existing iPhone app on 2026-09-26. No picture confidence threshold
was relaxed. The new fallback needs pixels outside the detected quad; it is
skipped when expansion would cross the camera frame boundary.

Owner-provided device logs after installation (2026-09-27 UTC):

- `03:53:58.864Z`, quick/outline Mouth of Sauron: exact `LTR 0216`, final #216.
- `03:54:09.950Z`, quick/outline Book of Mazarbul: exact `LTR 0116`, final #116.
- `03:54:19.735Z`, scan/guide Oliphaunt: exact `LTR 0426`, suggested #426
  in continuous mode (the log does not record subsequent sheet edits/commit).
- `03:54:08.992Z`: an unreadable quick read was rejected and retried.
- `03:53:35.332Z`: Book still had no usable footer and selected default #567.
  Image comparison preferred #116 with ratio0.944, insufficient for an override.
  This is an unresolved ambiguous-read fallback; do not call every scan fixed.

These logs establish successful exact reads on the device for all three cards,
not repeatability or automatic borderless Oliphaunt capture. Remaining work:
avoid presenting an unreadable-footer default as reliable printing evidence,
and verify/fix the separate automatic borderless capture failure.

### Ambiguous printing and borderless automatic capture (2026-09-27)

Quick-scan ambiguous printings now require deliberate selection/confirmation
before Add or Wish. A decisive complete artwork match may still confirm the
printing. Confirmation belongs to one scan, not every later scan of that name.
The main scanner holds ambiguous cards out of continuous staging; Choose opens
the picker, and the camera pauses during selection. Number-only footer matches
use the resolved ranking target rather than the old name-only default. Set-lock
conflicts still require a choice. Diagnostics report the actual suggested
printing and label unconfirmed quick previews.

Automatic capture adds Vision document segmentation only after the existing
rectangle passes fail. The same confidence, aspect, size, convexity, margin,
movement and sharpness gates apply. Cold failures stay rate-limited; successful
segmentation continues at detection cadence for the tracked card, avoiding the
retry interval exceeding the burst's maximum gap.

Validation: 120 scanner tests, 133 mobile tests, mobile/scanner typechecks,
lint (zero errors, two existing AppProvider hook warnings). Native still-image
regression accepts padded Oliphaunt through segmentation where both rectangle
passes fail, rejects partial/distant/noncard/blank scenes, and verifies fallback
continuation and cold retry throttling. These are synthetic scene checks, not
physical capture evidence. The phone regression checklist covers both changes.

### Startup preparation measurements

Implemented locally: asynchronous saved-file reads, deferred startup, shared single-flight
preparation, and batched catalog validation/indexing. The shell and auth/location loads
can start before scanner readiness. JSON parsing and catalog writes still use the JS thread.

Automated checks cover asynchronous reads, newest/older-slot recovery, missing/corrupt
bundled fallback, repeated startup calls, rejection before replacing a valid catalog, and
sync/async index equivalence for exact/fuzzy/alias/footer/Oracle lookups.

Physical-device checks still required:

- [ ] Cold start with the same real catalog/build: record first usable screen, catalog-ready
      time, and dev log file/JSON/index timings. Repeat at least five times before/after.
- [ ] Open collection, Settings and online search while “Preparing card database” is shown.
- [ ] Full and quick scanning stay gated until catalog readiness; no premature download ask.
- [ ] Start offline with a valid saved catalog, and on first launch with the bundled snapshot.
- [ ] Confirm a pending scan save recovers after preparation, without writing automatically.
- [ ] Sign out or leave the app during preparation; return/relaunch without duplicate startup.

Desktop Node measurements on the bundled 99,830-printing snapshot are supporting evidence,
not iPhone startup times. Baseline: read 79 ms, JSON 155 ms, synchronous validation/index
726 ms, total 960 ms. Batched preparation trades some catalog-ready latency for responsiveness;
A final batched run measured read 77 ms, JSON 166 ms, validation/index 933 ms, total
1,176 ms; a 10 ms heartbeat fired 76 times during indexing, with a largest gap of
18 ms. These are single desktop runs, not controlled phone comparisons. Use the dev
phase logs to measure the actual effect on the phone.

### Book #116 follow-up — 2026-09-27

Owner's 04:08–04:09 UTC logs still showed unreadable collector text, `0118`,
and corrupted copyright numbers `6`/`3023`. Inspected only the corresponding
saved card snapshots. Four failing Book crops scored 84.57, 154.82, 162.25,
278.20 with the shipped 256px Laplacian sharpness calculation; three successful
Book/Mouth/Oliphaunt crops scored 723.02, 524.48, 663.87. Calibrated burst sharpness
to 400 (early-window acceptance 80%, or 320). Existing bounded retry/fallback
remains; this limited seven-photo sample does not prove performance on all cards.

Added a bounded bottom-10% full-width, 3x Lanczos, unsharpened OCR pass after
missing footer evidence. It recovers `U OI16` on the owner's 04:09:01 failed
snapshot; scan-core maps mixed O/I/L collector tokens to digits only on compact
lines, with at least one actual digit and a digit at the end. Real `0118` remains
118; valid suffixes remain unchanged. Long corrupted copyright prose and the
`C MEE` logo no longer supply number/rarity hints. No fuzzy 118-to-116 correction.
Other failed photos remain unreadable or omit the footer and still require choice.

Validation: 122 scan-core tests, 133 mobile tests, both package typechecks,
modified TypeScript lint, native gate checks including seven measured crop scores,
existing inner-frame footer and borderless image regressions. Read-only review
confirmed the actual-photo recovery after fixing the optional pass to force 3x.
Optional private-photo reproduction: `scripts/check-book-focus.swift` in the
vision package; the owner's snapshot is intentionally not stored in the repo.
Physical acceptance: owner confirmed all three Book #116 scans worked after installing this build (2026-09-27).
