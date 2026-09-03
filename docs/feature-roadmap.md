# Project Upkeep — Full Feature Roadmap

**Purpose:** the complete feature landscape, not just what's currently in build. Use this to sequence work after Phase 1/2 and to keep scope-creep conversations grounded — anything not in Tier 1-2 needs a deliberate decision to add, not a drift.

**Status legend:** ✅ shipped · 🟡 partial (see the note) · ⬜ not started

Statuses last verified against the code on **2026-09-03** (refreshed after PRs #1–#3 merged). They are a reading of what is actually in `src/` and `supabase/migrations/`, not of what a brief once asked for — if you change the code, change the marker.

**Verify against `HEAD`, not the working tree.** As of PR #3 the deck wish list, commander picker (migration 18), split-face pips / real mana symbols, CSV + decklist export, and migrations 17–19 are all landed and live.

For why the order below is what it is — and for the competitive evidence behind it — see [`docs/competitive-analysis.md`](competitive-analysis.md).

---

## Tier 1 — Already scoped (Phase 1 + Phase 2, per the charter)

**All shipped.**

- ✅ Card search/add via Scryfall, instance tracking (condition/finish/language/quantity)
- ✅ Location management: create/rename/delete containers, assign/reassign instances
- ✅ Trading: propose/accept/decline/counter, atomic transfer on completion, trade history
- ✅ Auth, basic collection view

*(Not repeating detail here — see `/docs/phase1-brief.md` and `/docs/data-model-v1.md`.)*

---

## Tier 2 — High-value, should follow close behind Phase 1/2

These aren't differentiators, but the app feels broken without them once real users show up.

- ✅ **Bulk import (CSV)** — from ManaBox/Deckbox exports or a spreadsheet. This is the #1 adoption blocker if missing: nobody re-enters a 2,000-card collection by hand.
- ✅ **Bulk export (CSV + decklist)** — landed in PR #1. `src/lib/collection/export.ts` + the Export dropdown, on the collection and each deck; CSV round-trips through this app's own importer.
- ✅ **Bulk actions** — move multiple instances to a new location at once, bulk-edit condition/finish. Manual one-at-a-time editing doesn't scale past a small collection.
- ✅ **Collection search/filter/sort** — by name, set, color, type, location, condition. Table-stakes once a collection has any real size.
- ✅ **"Where is my card" quick lookup** — search your own collection and jump straight to its location. This is the payoff moment for the whole location-tracking premise — don't let it be an afterthought.
- 🟡 **Trade notifications** — in-app at minimum, email ideally. A trade system nobody gets notified about doesn't get used.
  - **In-app is done:** a `notifications` table (migration 14) covering proposed / accepted / declined / cancelled / countered, written by a DB trigger rather than by app code so no path can forget, plus the alerts menu.
  - **Email is not started.** No mail provider exists anywhere in the codebase. This one needs a spend decision against the $200 charter budget before it becomes a brief.
- ✅ **Trade proposal expiration/cancellation** — proposals need a way to die, or stale offers pile up.
- ✅ **Basic collection stats** — total cards, value, location count, unsorted, recent additions, container tree, and (PR #3) the breakdown by colour and by set on the dashboard.
- ✅ **Reference pricing (Scryfall-sourced)** — display per-card price and a simple estimated total collection value, refreshed on the existing sync job. Read-only, no price history, clearly labeled as an estimate.

---

## Tier 3 — Differentiating, worth prioritizing after Tier 2 is solid

- ✅ **Want-list / wishlist matching** — user marks cards they want; system surfaces when someone in their trade circle has it. Renamed **Wish List** in the UI (PR #1). Want-list entries can be tagged to a deck (migration 17) and show as a collapsible section on that deck's page.
- ⬜ **Trade circles / groups** — model a playgroup or LGS group as a unit, not just 1:1 connections. Matches how your target user actually trades (per the charter's ICP).
  - Nothing exists. Friendship is strictly 1:1 pairs (migration 9).
  - **Sequencing note:** this is a bigger build than its tier placement implies — it touches friendships, RLS on tradable locations, want-list matching, and the trade proposal flow at once. Worth waiting for beta feedback on whether 1:1 friendships are the actual pain point before starting it.
- 🟡 **Public/private collection visibility controls** — needed before want-list matching is useful across a group, and a basic trust/privacy expectation regardless.
  - **The enforcement exists and is solid:** `locations.is_tradable` gates what friends can see, trade binders are friends-only, want lists are readable only by friends — all at the RLS layer.
  - **The controls do not.** There is no privacy section in Settings and no public/private profile toggle. Users cannot see or change their own exposure, which is most of the trust value.
- ✅ **Multi-card trades** — several cards each direction in a single trade. `TradeBuilder` handles quantities in both directions; the UI has caught up with `trade_items`.
- ✅ **Deck-as-location refinement** — the deck workspace, per-entry sleeved/available/missing state, type sections, a per-row ⋯ menu, opt-in multi-select bulk sleeve/unsleeve, printing switching, and (PR #3) an "in Box 3" tag on available rows. The commander designation now works: migration 18 re-pointed `commander_card_id` at `cards.scryfall_id`, migration 19 made the deck list reconcile by oracle id, and the picker is exercised.
  - *Audit note kept for the record:* the commander button was briefed, built, reviewed and marked shipped in an earlier phase without anyone clicking it — it never worked until PR #1. This is the failure mode the status legend exists to catch.

---

## Tier 4 — Trust & safety (don't skip — matters more than it looks like it does)

Directly informed by interview question 12 in the discovery script ("what would make you not trust auto-transfer").

**This is now the largest open gap, and the gate on Phase 3 beta.** Three of the four items are untouched.

- ⬜ **Block/report users** — no tables, no UI.
- ⬜ **Manual dispute path** — since there's no escrow or payment, a trade gone wrong (one side backs out after physical exchange) needs *some* resolution path, even if it's just a flag-for-review, not automated resolution. The terms page currently *states* that disputes are between the two users; there is no mechanism behind that.
- ⬜ **Rate limiting** — prevent spam trade proposals. **This is a live abuse vector, not a hypothetical:** trade proposals are currently unbounded, so one account can spam every friend indefinitely. Cheap to fix now, awkward to retrofit once there are users.
- ✅ **ToS acceptance flow** — you are not a party to any trade or liable for it; explicit and accepted, not buried.

---

## Tier 5 — Nice-to-have / long-term, explicitly not urgent

- ✅ **Outbound marketplace links** — "Buy on TCGplayer" (Scryfall's synced `purchase_uri`) and "Buy on Card Kingdom" (name search) in the card panel and the collection row menu (PR #3). Deep links, not an API integration.
- ⬜ Location labels (printable QR/barcode stickers for physical boxes, scan to jump to that location in-app)
- ⬜ Photo attachments on locations (snapshot of the actual binder page)
- ⬜ Activity feed / profile pages — public profiles at `/u/[username]` exist; an activity feed does not.
- ⬜ Camera scan-to-add (OCR/image recognition) — genuinely valuable but nontrivial to build well; revisit once core is stable and only if budget allows a real solution
- ⬜ Admin dashboard (user count, trade volume, moderation queue) — needed eventually since you're solo-operating this, but not before there are users to monitor
- ⬜ Native mobile app (already Phase 5+ per the charter)

---

## Permanently out of scope

Repeating from the charter so it doesn't drift back in during a roadmap conversation. Note this narrowed slightly — lightweight Scryfall-sourced reference pricing is now in scope (Tier 2), but the following remain out:

- TCGPlayer/Cardmarket API integration, cross-listing, or automated repricing
- Active buy/sell transactions or any marketplace functionality beyond simple peer trades
- Price history/tracking or a full valuation engine
- Deck legality/format validation

---

## What to build next

*Revised 2026-09-03 against the competitive read in [`docs/competitive-analysis.md`](competitive-analysis.md). The prior recommendation — Tier 4 in full before beta — stands, and the competitive evidence strengthens it: Deckbox, the only incumbent actually running peer-to-peer trading, treats dispute, reputation and blocking as minimum viable, refined over eighteen years of live abuse. Shipping a trade engine without them is not an unhardened feature, it is an unshipped one.*

**Done since this was written (PRs #1–#3):** the in-flight work landed (wish list, commander picker + migrations 18–19, real symbols, export); the cheap trio is all shipped (CSV/decklist export, the set/colour dashboard breakdown, the marketplace deep links); and "where is it" from the deck view shipped as an "in Box 3" tag on available rows. Plus import printing-match fixes and a deck-row UX pass.

**Remaining before beta — safety, and only safety:**

1. **Rate limiting.** The only live abuse vector today — trade proposals are unbounded. Do it first and alone. Enforce in the database, not in app code, so no route can forget — the discipline migration 14 already uses for notifications.
2. **Block/report + privacy controls as one brief.** They share the RLS surface and the Settings surface; splitting them doubles the work. The enforcement for visibility already exists (`locations.is_tradable`, friends-only trade binders and wish lists) — this is the user-facing control surface over it.
3. **Dispute flag.** Last of the safety set — a flag plus a visible record, explicitly not arbitration or reversal. **This is the gate: beta does not open until 1–3 are in.**
4. **Beta**, instrumented from day one against the KPIs in the competitive analysis (all SQL over existing tables; no analytics stack, no spend).
5. **Post-beta:** trade → location assignment on acceptance, then physical pick-list mode.
6. **Trade circles** only if beta says 1:1 friendship is the wrong unit.

Still open but not blocking: **email trade notifications** (needs a mail-provider spend decision against the $200 budget) and **trade-circles/groups** (bigger than its tier; wait for beta signal).

---

## How to use this with Claude Code

Don't hand this whole doc over as a single build brief — it'll try to build too much at once. Instead:
1. Pick a small set of related items — ideally one tier's worth, or one theme like "Tier 4 trust & safety".
2. Write a scoped brief for those, and hand it to the Dev agent; hand the result to QA before reviewing it yourself.
3. Keep this file in `/docs` as the reference map, and update the status markers when work lands. Each individual brief should stay narrow.
