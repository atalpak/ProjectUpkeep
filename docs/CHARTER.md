# MTGManager — Project Charter

**Client:** Anthony
**PM:** Claude (this conversation / project)
**Status:** Scope locked (v2) — moving to detailed spec
**Target:** Live by 2027 · Web-first, mobile to follow
**Anthony's role:** Directs and reviews; Claude Code writes the software
**Founder structure:** Solo · Budget: $200 · No existing marketplace/API relationships

---

## 1. Positioning

**MVP is not a marketplace or reseller tool.** No TCGPlayer/Cardmarket API integration, no cross-listing, no active buy/sell transactions in v1. This is a deliberate scope cut to keep the build small, free-tier-hostable, and shippable solo.

**MVP does include reference pricing**, but only because it's essentially free to add: Scryfall's own bulk data already bundles market price fields (sourced from TCGPlayer/Cardmarket/Cardhoarder) alongside every card printing. Displaying that as informational reference — per card and as a rough estimated collection value — costs nothing extra in API calls or budget, since it rides on the same sync job as everything else. This is explicitly *not* a valuation engine: no editable pricing, no price history/tracking, no arbitrage tooling. Outbound links to TCGPlayer/Card Kingdom listing pages (so a user can go buy/sell elsewhere) are a planned v2 addition, not v1 — see the roadmap.

**The MVP is three things done well:**

1. **Physical location tracking** — not just "which cards do I own" but *where each copy actually is* (this specific binder, that specific box, this deck) so a collection mirrors reality.
2. **Frictionless peer-to-peer trading** — when two users complete a trade, the traded cards move automatically between their inventories (and update each card's location) with no manual delete/re-add on either side.
3. **Reference pricing, at zero marginal cost** — since Scryfall already gives it to us for free alongside card data, show it, but don't build a business around it.

**Competitive reality check (from market scan):** location tagging exists in a few apps (e.g. free-text location tags), and a couple of niche trade tools do move cards between accounts automatically on trade completion. Neither is universal — most major players (ManaBox, Deckbox, Moxfield) still treat trading as a valuation/matching tool, not a real inventory-transfer event, and location tracking is usually a single flat "binder" field, not structured containers. Reference pricing itself is table-stakes elsewhere, so it's not a differentiator — the wedge is still location tracking + real trade transfer, done **both, well, for free/cheap, without building a full pricing/marketplace engine** most users don't need for this use case.

**Target user (hypothesis, validate in Phase 0):** Players/collectors who trade semi-regularly with a known circle (LGS regulars, playgroups, local Discord/Facebook trade groups) and want their digital inventory to actually reflect physical reality without re-entering data after every trade.

---

## 2. MVP Feature Set

**Core:**
- Card database via **Scryfall API** (free, no key required for bulk data + images) — search, autocomplete, printings, foil/language variants
- User collection: individual card *instances* (not just quantities) — each instance has condition, foil/finish, language, and a **location**
- **Locations** are user-defined containers: decks, binders, boxes — flexible, nestable if reasonable (e.g. "Box 3" as a container, "Commander Binder" as another), reassignable by drag-or-select
- **Trading:** propose a trade to another user (specific instances offered/requested) → other user accepts/declines/counters → on acceptance, the system atomically transfers the specific card instances between both users' inventories and updates location on both sides → trade history log for both parties
- **Reference pricing:** display Scryfall's bundled market price (USD nonfoil/foil) per card instance, plus a simple estimated total collection value — read-only, refreshed on the regular Scryfall sync, clearly labeled as an estimate

**Explicitly out of scope for v1:**
- Marketplace integration, active buy/sell transactions, or cross-listing to TCGPlayer/Cardmarket
- Outbound purchase links to TCGPlayer/Card Kingdom (planned v2 — see roadmap)
- Price history/tracking over time, or any valuation engine beyond Scryfall's bundled snapshot
- Deck legality/format validation
- Mobile app (Phase 5+)
- Payments/subscriptions (evaluate after there's a real user base — v1 can be free to build the base)

---

## 3. Budget & Infra Reality ($200 total)

At this budget, infra has to be free-tier or near-free:
- **Hosting/DB:** Vercel (frontend) + Supabase or Neon free-tier Postgres — free tier
- **Auth:** Supabase Auth or Clerk free tier
- **Card images:** Scryfall serves/allows caching card images for free; no separate image hosting cost needed initially
- **Domain:** ~$12-15/yr — basically your only guaranteed spend
- **Everything else** (Claude Code, Claude Design, Claude Cowork) — token spend, not cash, so it doesn't hit the $200

This budget supports validation + MVP build comfortably. It does **not** support paid pricing-data APIs — which is consistent with the scope cut above, not a constraint fighting it.

---

## 4. The AI "Org Chart"

| # | Manager | Mandate | Primary Tool |
|---|---|---|---|
| 1 | **Strategy & Research** | Competitive intel, ICP validation | This chat (Claude Project) + Claude Cowork for deep dives |
| 2 | **Product** | Feature spec, MVP scope, prioritization | This chat (Claude Project) |
| 3 | **Design** | Brand, UX flows (esp. the trade flow + location assignment UX — these are the hard UX problems here) | Claude Design |
| 4 | **Engineering** | Data model, transaction-safe trade logic, actual code | Claude Code |
| 5 | **Data** | Scryfall sync pipeline, card/printing/instance schema | Claude Code |
| 6 | **QA** | Edge cases: simultaneous trade offers, partial trades, foil/language variants, concurrent location edits | Claude Code |
| 7 | **Marketing** | Positioning, community seeding (LGS/playgroups, not resellers) | Claude Cowork + Claude for Word |
| 8 | **Legal/Compliance** | ToS covering peer trades (you are not a party to the trade or liable for it), WotC IP-safe language | This chat (draft) → real review before launch |
| 9 | **Finance** | Track the $200 — mostly a formality at this budget | Claude for Excel |

---

## 5. Tool Routing Cheat Sheet

- **This chat / Claude Project** — PM hub: decisions, specs, status. Never build code or dump long research here.
- **Claude Code** — all application code, schema, the trade-transaction logic (this is the trickiest engineering piece — treat it as its own focused session).
- **Claude Design** — mockups for the collection view, location assignment, and trade flow specifically.
- **Claude Cowork** — deep research, marketing content batches.
- **Claude for Excel** — the $200 budget tracker, nothing fancier needed yet.

**Token efficiency rule:** decisions/specs live in this Project; execution tools get a tight brief pulled from spec, work in isolation, report back a summary.

---

## 6. Phased Roadmap (target: live 2027)

**Phase 0 — Validate (2-3 weeks)**
- Talk to 5-10 people who trade cards regularly (LGS/playgroup/local trade groups) — confirm "my digital inventory doesn't match reality after trades" is a real, felt pain
- Confirm the location-tracking granularity people actually want (is "Box 3" enough, or do they want per-page/per-slot?)
- Lock final data model based on findings

**Phase 1 — Core Build (Claude Code, ~6-8 weeks)**
- Scryfall sync pipeline (bulk data + images)
- Card instance model: condition/foil/language + location assignment
- Collection CRUD, container (location) management
- Basic web UI (Claude Design hands off to Code)

**Phase 2 — Trading Engine (~3-4 weeks)**
- User-to-user trade proposals, accept/decline/counter
- Atomic transfer logic (this needs careful transaction handling — don't let it be an afterthought)
- Trade history

**Phase 3 — Beta**
- Closed beta with Phase 0 interviewees
- QA hardening on trade edge cases specifically

**Phase 4 — Launch**
- Public launch, community seeding in trade-focused spaces (local Discords, r/mtgtrades-style communities)

*Mobile app is Phase 5+, post-launch.*

---

## 7. Immediate Next Actions

1. **Me (this chat):** Draft the discovery-interview script for Phase 0 + a first-pass data model (cards/instances/locations/trades) for your review.
2. **You:** Review both, then we lock Phase 0 and I write the first tight technical brief for Claude Code.

---

## Resolved / Open Questions

- ~~TCGPlayer/Cardmarket relationships?~~ **Resolved:** none, and intentionally out of MVP scope.
- ~~Budget?~~ **Resolved:** $200, infra plan above fits it.
- ~~Solo or team?~~ **Resolved:** solo.
- **Open:** How granular should location tracking be by default — freeform text tags, or structured container types (Deck / Binder / Box) with optional sub-slots? (Recommend deciding this in Phase 0 interviews, not guessing now.)
