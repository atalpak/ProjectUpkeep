# Project Upkeep — Full Feature Roadmap

**Purpose:** the complete feature landscape, not just what's currently in build. Use this to sequence work after Phase 1/2 and to keep scope-creep conversations grounded — anything not in Tier 1-2 needs a deliberate decision to add, not a drift.

**Status legend:** ✅ shipped · 🟡 partial (see the note) · ⬜ not started

Statuses last verified against the code on **2026-09-03**. They are a reading of what is actually in `src/` and `supabase/migrations/`, not of what a brief once asked for — if you change the code, change the marker.

**Verify against `HEAD`, not the working tree.** There is uncommitted, incomplete work in flight (deck wish list, commander picker, split-face pips, CSV export) and migrations 17-18 are unapplied. None of it is shipped and none of it may be marked ✅ until it lands.

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
- 🟡 **Bulk export (CSV)** — *added 2026-09-03; this line was missing from the roadmap entirely.* Import without export is a lock-in objection, not a missing feature: every competitor surveyed ships export, and nobody hands a 2,000-card collection to a tool they can't get it back out of. Work is **in flight and uncommitted** (`src/lib/collection/export.ts`, `src/components/ExportButtons.tsx`) — not shipped.
- ✅ **Bulk actions** — move multiple instances to a new location at once, bulk-edit condition/finish. Manual one-at-a-time editing doesn't scale past a small collection.
- ✅ **Collection search/filter/sort** — by name, set, color, type, location, condition. Table-stakes once a collection has any real size.
- ✅ **"Where is my card" quick lookup** — search your own collection and jump straight to its location. This is the payoff moment for the whole location-tracking premise — don't let it be an afterthought.
- 🟡 **Trade notifications** — in-app at minimum, email ideally. A trade system nobody gets notified about doesn't get used.
  - **In-app is done:** a `notifications` table (migration 14) covering proposed / accepted / declined / cancelled / countered, written by a DB trigger rather than by app code so no path can forget, plus the alerts menu.
  - **Email is not started.** No mail provider exists anywhere in the codebase. This one needs a spend decision against the $200 charter budget before it becomes a brief.
- ✅ **Trade proposal expiration/cancellation** — proposals need a way to die, or stale offers pile up.
- 🟡 **Basic collection stats** — total cards, breakdown by set/color. Cheap to build, high perceived value.
  - **Done:** totals, entry counts, location count, unsorted count, estimated value, recent additions, container tree.
  - **Missing:** the breakdown by set and by color this line actually asks for. Small job — `getCollectionSets()` already exists for the filters, and `cards.colors` / `color_identity` are already synced.
- ✅ **Reference pricing (Scryfall-sourced)** — display per-card price and a simple estimated total collection value, refreshed on the existing sync job. Read-only, no price history, clearly labeled as an estimate.

---

## Tier 3 — Differentiating, worth prioritizing after Tier 2 is solid

- ✅ **Want-list / wishlist matching** — user marks cards they want; system surfaces when someone in their trade circle has it. This is what turns the trade engine from "manual proposal tool" into something that actually surfaces opportunities.
  - Being extended as of 2026-09-03, **in flight and uncommitted** (migration 17 unapplied): want-list entries can be tagged to a deck and shown as a collapsible wish-list section on that deck's page. The shipped, matching-against-friends' -binders behaviour is what the ✅ refers to.
- ⬜ **Trade circles / groups** — model a playgroup or LGS group as a unit, not just 1:1 connections. Matches how your target user actually trades (per the charter's ICP).
  - Nothing exists. Friendship is strictly 1:1 pairs (migration 9).
  - **Sequencing note:** this is a bigger build than its tier placement implies — it touches friendships, RLS on tradable locations, want-list matching, and the trade proposal flow at once. Worth waiting for beta feedback on whether 1:1 friendships are the actual pain point before starting it.
- 🟡 **Public/private collection visibility controls** — needed before want-list matching is useful across a group, and a basic trust/privacy expectation regardless.
  - **The enforcement exists and is solid:** `locations.is_tradable` gates what friends can see, trade binders are friends-only, want lists are readable only by friends — all at the RLS layer.
  - **The controls do not.** There is no privacy section in Settings and no public/private profile toggle. Users cannot see or change their own exposure, which is most of the trust value.
- ✅ **Multi-card trades** — several cards each direction in a single trade. `TradeBuilder` handles quantities in both directions; the UI has caught up with `trade_items`.
- 🟡 **Deck-as-location refinement** — decks have their own workspace distinct from a binder view, with sleeved/available/missing state per entry, and sections by card type. **Corrected from ✅ on 2026-09-03.**
  - **Done and solid:** the workspace, per-entry sleeved/available/missing state, type sections.
  - **The commander designation has never worked.** Migration 8 pointed `commander_instance_id` at `card_instances.id` — a specific physical copy — while `DeckWorkspace.tsx` submits `entry.card_id`, a `cards.scryfall_id`. The FK rejects it every time, and `setCommander()` in `decks/actions.ts` discards the error (`if (error) return;`) on the theory that a failure means migration 8 was never applied. So the button silently does nothing and always has. A fix is **in flight and uncommitted** (migration 18, `commander_card`, which re-points the column at `cards.scryfall_id`). Do not re-mark ✅ until that lands and the picker is exercised.
  - *Audit note:* this is exactly the failure mode the status legend exists to catch — a feature that was briefed, built, reviewed and marked shipped without anyone clicking the button.

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

- 🟡 **Outbound marketplace links** — link each card to its TCGPlayer and/or Card Kingdom listing page so a user who wants to actually buy or sell can jump there. A simple deep link, not an API integration.
  - **The data is already synced:** `purchase_uri` and `tcgplayer_id` are on the `cards` table and already selected in the collection queries. This is a UI-only job — the best effort-to-value ratio left on the board.
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

**Step 0 — land the in-flight work first.** Deck wish list, commander picker, split-face pips and export are uncommitted and incomplete; migrations 17 and 18 are unapplied. Finish and land that before starting anything below. Migration 18 fixes a feature this file wrongly marked shipped, and a half-applied migration set is the worst possible base for schema work on rate limiting.

1. **Rate limiting.** The only live abuse vector today. Do it first and alone. Enforce in the database, not in app code, so no route can forget — the discipline migration 14 already uses for notifications.
2. **The cheap, mostly-built trio, one sitting each:** finish CSV export, the set/colour dashboard breakdown, and the marketplace deep links.
3. **Block/report + privacy controls as one brief.** They share the RLS surface and the Settings surface; splitting them doubles the work. The enforcement for visibility already exists — this is the control surface over it.
4. **"Where is it" from the deck view.** Surface the container path of the copy that fills each deck line. *New, and pulled ahead of the rest of Tier 4 deliberately:* Moxfield has this as an open request on their own feedback board, we already have every piece (instance-level locations, `deck-state.ts`, `/api/collection/locate`), and a beta whose only novelty is safety plumbing generates no signal about whether the wedge works.
5. **Dispute flag.** Last of the safety set — a flag plus a visible record, explicitly not arbitration or reversal. **This is the gate: beta does not open until 1-5 are in.**
6. **Beta**, instrumented from day one against the KPIs in the competitive analysis (all SQL over existing tables; no analytics stack, no spend).
7. **Post-beta:** trade → location assignment on acceptance, then physical pick-list mode.
8. **Trade circles** only if beta says 1:1 friendship is the wrong unit.

If time presses before beta, cut the dashboard breakdown and the deep links. Everything else in steps 1-5 is load-bearing.

---

## How to use this with Claude Code

Don't hand this whole doc over as a single build brief — it'll try to build too much at once. Instead:
1. Pick a small set of related items — ideally one tier's worth, or one theme like "Tier 4 trust & safety".
2. Write a scoped brief for those, and hand it to the Dev agent; hand the result to QA before reviewing it yourself.
3. Keep this file in `/docs` as the reference map, and update the status markers when work lands. Each individual brief should stay narrow.
