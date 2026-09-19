# Mobile app backlog

What is not built yet, or is built but needs a follow-up. Newest thinking first
within each group. Kept out of the historical handoff docs on purpose: this file
is the live list.

## Pages that are still placeholders

Only **Find** ("where is my card?") is left; it is deliberately out of the menu
for now. Everything else in `BUILT` (`src/navigation.ts`) has a real screen.

Built since this list was first written, with what each still lacks:

- **Dashboard** — value, totals, needs-attention (including trades waiting on you), deck status, recently added. Missing: the "expiring offers" line.
- **Trades** — proposals in both directions, build and counter-offer, accept, or close.
- **Notifications** — friend requests, trade activity.
- **Import** — paste a list or a CSV into the **collection** only. Missing: importing into a deck, and picking a file rather than pasting.

## Decks

- Edit deck details: format, tags, notes.
- Share-with-friends switch (the Private / Shared pill is read-only today).
- Deck statistics and charts.
- Playtest.
- Export the list.
- The deck's own wish list, and "add to wish list" from a missing card.
- Add a card to a deck's list from the card details sheet (excluded from the
  first pass as quick-add).
- Rename and delete a deck.

## Cards and collection

- Move / edit a copy you own from the card details sheet (excluded from the
  first pass).
- Quick-add: "add another", and adding straight to a deck.
- Wish list: change the wanted quantity, not just add and remove.
- Collection: sort options (name, mana value, rarity, price).
- Card details: prices in the list rows (display-only Scryfall estimate).
- Two-sided cards: show both faces in the collection image view.

## Scanner

- Alternate-art accuracy: **quick scan** now reads the footer properly, opens on a
  footer-based best-guess printing at once and compares the card's picture with each
  candidate's in the background, switching only when confident (plan steps 2 and 4;
  the 2026-09-19 owner decision dropped the "Which printing is this?" picker; unverified on a device). Still open: the main Scan tab does not use the picture
  step; a sharper still-photo capture for the footer (step 3); printing-type flags
  in the catalog (step 5, needs a migration); the 20-30 real-card test set (step 6),
  which is what turns the accuracy script's sample numbers into evidence.
- Quick scan capture feel (2026-09-19 owner feedback, all unverified on a device): built
  for a card held in the HAND. No outline while searching; once a card has been a
  valid full card for 3 detections and is not being swept through (`BurstTracker`,
  0.05 loose movement), every frame is straightened and the first with sharpness >= 40
  is read, else the sharpest at 0.7s (if >= 20) or at 1.2s regardless; green outline
  held 0.35s; box 320x440; a live coaching line at the TOP of the box (`onScanStatus`,
  old builds keep the static hint). Tune from real use: `BurstTracker` constants,
  `minimumSharpness`, the area floor (0.18), `STATUS_MIN_MS` (400). The frame is
  detected whole, so a card can lock while partly outside the visible (cropped) box.
- Quick scan "Couldn't read that clearly" every time (2026-09-19 owner feedback, all
  unverified on a device): focus/exposure/zoom are re-applied after each preset change
  (they were probably being lost to the preset switch) and follow the tracked card;
  zoom is OFF (`quickZoomCap` 1.0) and the session is back to 1080p (the 4K + 2x zoom
  experiment was backed out after phone testing); frames are skipped while the lens hunts (<= 0.6s);
  blurry 1.2s fallbacks are retried (<= 2); a rejected read is retried on the held
  card (`retryToken`, 0.4s); the retries are silent and after 4 the line advises more
  light / less glare (the person is never told what was read). The title is now read
  from the top 23% of the card only. To
  confirm on a phone: whether the focus point orientation is right (a wrong mapping
  focuses on the wrong part of the frame, so watch for it on a card held off-centre),
  whether `focusPointOfInterest` is relative to the zoomed or the full field of view,
  the zoom the device picks, and the constants above. Read the `[quick-scan] rejected`
  log in Metro to tell OCR from matching.
- Wrong printing on quick scan (Bloodline Bidding ECL #91 opened ECL #385): the
  default is now the regular print (`regularFirst`), the picture switch needs a
  0.75 ratio (0.5 over a footer guess), the footer gets a
  footer-only second OCR pass (on the 1080p card; the "may not be the printing" note was
  removed from quick scan's hand-off). Unverified on a device: whether the footer
  now reads at 1080p, and the ratios. The web wish-list default (`wants/actions.ts`)
  has the same set-type-only tie and was left alone.
- Quick scan (hold Scan, slide to the Scan option): tune the "how sure" cutoff
  (`QUICK_MIN_SCORE` in `packages/scan-core/src/band.ts`) against real cards, and
  check the lock-on speed in poor light.
- Accuracy benchmark (offline, no phone): `npm run accuracy -w @upkeep/scan-core`
  runs the shipped matching over labelled OCR reads and sweeps `QUICK_MIN_SCORE` /
  `QUICK_AMBIGUITY_MARGIN`, reporting exact / right-card-wrong-printing / wrong card /
  abstained. Real use: `-- --catalog catalog.json --reads reads.json` (a missing catalog
  skips cleanly). The bundled sample in `scripts/fixtures/` is illustrative only; the
  cutoff stays untuned until reads are captured from a device.
- Haptics on the fan-out button (needs a native package, so a rebuild).
- Android live scanner (iOS only today).

## Card database

- `latest.json` has never been published: it appears after the next publish that
  follows the update-check change (next daily run that finds a change, or run the
  Scryfall sync workflow by hand with force). Until then the app's update check
  quietly finds nothing. Test the "New cards are available" window once it does.
- Run `npm run catalog:snapshot` before every native build, or the app ships
  without the bundled database and asks users to download it.
- If the full 40 MB update proves too heavy: a "just the changes" update.
- Measure the launch-time cost of parsing the catalog on a real phone.

## Native rebuilds waiting on the phone

- `expo-sensors` (foil tilt) was added after the last phone build. The tilt only
  works once the phone is rebuilt; until then the foil shows and responds to a
  finger drag.

## Scanner tuning on the phone

- If the phone runs hot in quick scan, straighten and score only every Nth
  sample frame instead of every one.

## App shell and polish

- Settings: change password and notification preferences (delete account is built).
- Search: filter results by what you own, and a "recent searches" list.
- Dark mode: audit every screen for contrast on real hardware.
- Automated tests over the screens (none exist; only the shared logic in
  `packages/*` is tested).
- Web app: fold its own copies of the search, collection-filter and deck-grouping
  rules onto `packages/upkeep-domain`, which the mobile app already uses.
