# Mobile app backlog

What is not built yet, or is built but needs a follow-up. Newest thinking first
within each group. Kept out of the historical handoff docs on purpose: this file
is the live list.

## Pages that are still placeholders

- **Dashboard** — built (value, totals, needs-attention, deck status, recently added). Missing: trade rows once Trades exists, and the "expiring offers" line.
- **Trades** — proposals in both directions, accept/decline.
- **Notifications** — friend requests, trade activity.
- **Import** — paste or CSV, collection and deck.
- **Find** ("where is my card?") — deliberately left out of the menu for now.

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
- Quick scan capture feel (2026-09-19 owner feedback, changes unverified on a device):
  no outline while searching, green outline on capture held 0.35s, must settle 0.3s
  (`SettleTracker` in `UpkeepCardVision.swift`), box 320x440. Tune settle
  tolerance/duration, `minimumSharpness` and the full-card area minimum (0.18) from
  real use. The frame is detected whole, so a card can lock while partly outside the
  visible (cropped) box.
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

## App shell and polish

- Settings: change password, delete account, notification preferences.
- Search: filter results by what you own, and a "recent searches" list.
- Dark mode: audit every screen for contrast on real hardware.
- Automated tests over the screens (none exist; only the shared logic in
  `packages/*` is tested).
- Web app: fold its own copies of the search, collection-filter and deck-grouping
  rules onto `packages/upkeep-domain`, which the mobile app already uses.
