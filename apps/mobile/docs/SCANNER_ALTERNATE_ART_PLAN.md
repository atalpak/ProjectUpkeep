# Scanner accuracy for alternate-art cards — plan (deferred)

Written 2026-09-18. **Status update 2026-09-19:** steps 2 and 4 are implemented for *quick scan* only (footer parsing and printing ranking in `packages/scan-core/src/printing.ts`, picture comparison via native `rankCardImage`, a "Which printing is this?" picker in CardDetails); not yet run on a device. Steps 1 (logging real OCR), 3 (sharper capture), 5 (catalog flags) and 6 (real test set) are not done. The rest of this file is the original plan.

## The problem
Alternate-art printings (full art, extended art, borderless, showcase, promos) often scan as the wrong
printing. Worked example: the owner's **Gigantosaurus, Foundations #718** (full-art, foil-only Starter
Collection promo) scanned as a different printing. (The owner wrote "Giganotosaurus"; the card is
"Gigantosaurus", and it *is* in the catalog: the catalog is not the problem.)

## Why it picks the wrong printing (grounded in the code and the real catalog)
- **Name ties are broken arbitrarily.** The catalog has 9 Gigantosaurus printings (M19 #185, two `plst`
  variants, `pm19` 185p/185s, FDN #718, SLZ 76/197/318). A name-only match scores all 9 equally, and
  `CardIndex.rank` (`packages/scan-core/src/catalog.ts`) then sorts by name and finally by internal
  UUID, so the winner is effectively random.
- **The printing evidence is almost never found.** `printingHints` (same file) only matches `SET NUMBER`
  on a single OCR line. Modern cards print the collector number and the set code on separate lines
  (e.g. `M 0236` above `SOC • EN`), so exact-printing evidence is rarely produced. *Not yet confirmed
  against raw phone OCR output; step 1 below is to log it.*
- **The footer text is tiny.** The live scanner reads it from a 1080p preview frame, where the line is
  roughly 20 px tall. Full-art cards overlay it on artwork, which is harder still.
- **Art comparison exists but is switched off.** `compareArtwork` in `packages/upkeep-vision`
  (Apple Vision feature prints; ported from the Flutter scanner's `compareCardArtwork` in
  `/Users/anthonytalpak/MTGCardScanner/ios/Runner/AppDelegate.swift`) is not used by the scanner.
- **The catalog doesn't know printing types.** No `full_art`, `border_color`, `frame_effects` or
  `promo_types` are stored in the `cards` table, the sync mapping (`src/lib/scryfall.ts`) or the
  exported catalog (`scripts/export-catalog.ts`).

## Plan, in order
| Step | What it does | Effort |
|---|---|---|
| 1. Log what the phone actually reads | Confirms the footer diagnosis with real OCR output before fixing anything | Small |
| 2. Fix printing-text reading | Read number and set on separate lines; tolerate `0718` and the rarity letter; use the number alone if the set is unreadable; replace the UUID tiebreaker with sensible ordering (e.g. finish match). Ambiguous scans present "choose printing" instead of a silent guess. Pure TS, unit-testable | Small |
| 3. Sharper footer reading | Read the footer from a 4K or full-resolution capture rather than the 1080p preview | Small to medium |
| 4. Compare card picture to candidates' pictures | Re-enable native art comparison among the 2-10 name-matched printings, using cached catalog images; the sheet updates when the result arrives. Distinguishes full-art from framed | Medium |
| 5. Add printing-type flags to the catalog | Store full_art / border_color / frame_effects / promo_types (needs a **migration**, so architect review first) and add a cheap border-class check on the straightened card to prune candidates | Medium |
| 6. Test set | 20-30 of the owner's hardest cards with known set + number, to measure accuracy instead of guessing | Small, needs the owner's cards |

## Caveats
- Reprints with identical art cannot be separated by picture; only the collector number distinguishes
  them, so step 2 stays essential even after step 4.
- Foundations #718 is foil-only, so once the right printing is chosen, finish resolves automatically.
- Optional later idea: log the printing a player corrects to in the sheet, as free ground truth.

## What is needed from the owner to start
Photos of 20-30 tricky cards (full-art, extended-art, borderless, showcase, promos, plus a few normal
ones) with each card's set and collector number.

## Recommended start
Steps 1, 2 and 3 (small, fix most cases), then measure with the owner's cards and decide on 4 and 5.
