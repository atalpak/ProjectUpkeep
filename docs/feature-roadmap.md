# Project Upkeep — Full Feature Roadmap

**Purpose:** the complete feature landscape, not just what's currently in build. Use this to sequence work after Phase 1/2 and to keep scope-creep conversations grounded — anything not in Tier 1-2 needs a deliberate decision to add, not a drift.

---

## Tier 1 — Already scoped (Phase 1 + Phase 2, per the charter)

- Card search/add via Scryfall, instance tracking (condition/finish/language/quantity)
- Location management: create/rename/delete containers, assign/reassign instances
- Trading: propose/accept/decline/counter, atomic transfer on completion, trade history
- Auth, basic collection view

*(Not repeating detail here — see `/docs/phase1-brief.md` and `/docs/data-model-v1.md`.)*

---

## Tier 2 — High-value, should follow close behind Phase 1/2

These aren't differentiators, but the app feels broken without them once real users show up.

- **Bulk import (CSV)** — from ManaBox/Deckbox exports or a spreadsheet. This is the #1 adoption blocker if missing: nobody re-enters a 2,000-card collection by hand.
- **Bulk actions** — move multiple instances to a new location at once, bulk-edit condition/finish. Manual one-at-a-time editing doesn't scale past a small collection.
- **Collection search/filter/sort** — by name, set, color, type, location, condition. Table-stakes once a collection has any real size.
- **"Where is my card" quick lookup** — search your own collection and jump straight to its location. This is the payoff moment for the whole location-tracking premise — don't let it be an afterthought.
- **Trade notifications** — in-app at minimum, email ideally. A trade system nobody gets notified about doesn't get used.
- **Trade proposal expiration/cancellation** — proposals need a way to die, or stale offers pile up.
- **Basic collection stats** — total cards, breakdown by set/color. Cheap to build, high perceived value.
- **Reference pricing (Scryfall-sourced)** — Scryfall's bulk data already includes market price fields (USD nonfoil/foil, sourced from TCGPlayer/Cardmarket) alongside every printing. Display per-card price and a simple estimated total collection value, refreshed on the existing sync job. Zero added API cost or budget impact — it rides on data already being pulled. Read-only, no price history, clearly labeled as an estimate, not a valuation engine.

---

## Tier 3 — Differentiating, worth prioritizing after Tier 2 is solid

- **Want-list / wishlist matching** — user marks cards they want; system surfaces when someone in their trade circle has it. This is what turns the trade engine from "manual proposal tool" into something that actually surfaces opportunities — arguably closer to the core value prop than some Tier 2 items.
- **Trade circles / groups** — model a playgroup or LGS group as a unit, not just 1:1 connections. Matches how your target user actually trades (per the charter's ICP).
- **Public/private collection visibility controls** — needed before want-list matching is useful across a group, and a basic trust/privacy expectation regardless.
- **Multi-card trades** — several cards each direction in a single trade (the data model already supports this via `trade_items`; this tier is about the UI catching up).
- **Deck-as-location refinement** — decks already work as a location type; consider light deck-specific UI (e.g., a deck view distinct from a binder view) since decks get edited more often than binders.

---

## Tier 4 — Trust & safety (don't skip — matters more than it looks like it does)

Directly informed by interview question 12 in the discovery script ("what would make you not trust auto-transfer") — worth revisiting those answers if you did any interviews before starting.

- **Block/report users**
- **Manual dispute path** — since there's no escrow or payment, a trade gone wrong (one side backs out after physical exchange) needs *some* resolution path, even if it's just a flag-for-review, not automated resolution
- **Rate limiting** — prevent spam trade proposals
- **ToS acceptance flow** — you are not a party to any trade or liable for it; this needs to be explicit and accepted, not buried

---

## Tier 5 — Nice-to-have / long-term, explicitly not urgent

- **Outbound marketplace links** — link each card to its TCGPlayer and/or Card Kingdom listing page so a user who wants to actually buy or sell can jump there. This is a simple deep link (e.g. a URL built from card name/set), not an API integration, not cross-listing, not automated repricing — those remain permanently out of scope below. Natural v2 follow-on to Tier 2's reference pricing once that's shipped and used.
- Location labels (printable QR/barcode stickers for physical boxes, scan to jump to that location in-app)
- Photo attachments on locations (snapshot of the actual binder page)
- Activity feed / profile pages
- Camera scan-to-add (OCR/image recognition) — genuinely valuable but nontrivial to build well; revisit once core is stable and only if budget allows a real solution
- Admin dashboard (user count, trade volume, moderation queue) — needed eventually since you're solo-operating this, but not before there are users to monitor
- Native mobile app (already Phase 5+ per the charter)

---

## Permanently out of scope

Repeating from the charter so it doesn't drift back in during a roadmap conversation. Note this narrowed slightly — lightweight Scryfall-sourced reference pricing is now in scope (Tier 2), but the following remain out:

- TCGPlayer/Cardmarket API integration, cross-listing, or automated repricing
- Active buy/sell transactions or any marketplace functionality beyond simple peer trades
- Price history/tracking or a full valuation engine
- Deck legality/format validation

---

## How to use this with Claude Code

Don't hand this whole doc over as a single build brief — it'll try to build too much at once. Instead:
1. Confirm Phase 1 (current build) is at acceptance criteria per `/docs/phase1-brief.md`.
2. Pick items from Tier 2 for the next brief — I can write that scoped brief once Phase 1's done, the same way I did the first one.
3. Keep this file in `/docs` as the reference map; each individual brief should stay narrow.
