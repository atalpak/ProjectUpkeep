# MTGManager — Claude Code Brief: Phase 1 (Core Build)

**Before starting:** read `/docs/CHARTER.md` and `/docs/data-model-v1.md` in this repo for full context. This brief is the scoped instruction set for this build phase — don't re-derive strategy, it's already decided.

**Note on the data model:** Phase 0 user validation was skipped at the client's direction, so a few schema decisions (location nesting depth, whether identical cards stack via `quantity` or get one row each) are best guesses, not validated. Build migrations that are easy to amend — don't hardcode assumptions deep into business logic.

---

## Scope for this session — build ONLY:

1. **Project scaffolding**
   - Next.js + TypeScript + Tailwind
   - Supabase client wired up (Postgres + Auth)
   - Repo structure sensible for a solo dev to navigate later

2. **Database schema/migrations**
   - `cards`, `locations`, `card_instances` from `/docs/data-model-v1.md`
   - `users` via Supabase Auth (don't hand-roll auth tables)
   - You may create `trades` / `trade_items` / `ownership_history` tables now for forward-compatibility, but **do not build any logic or UI against them yet** — that's Phase 2

3. **Scryfall sync**
   - Script that pulls Scryfall's bulk `default_cards` data and upserts into `cards`
   - Repeatable/schedulable, not a one-off manual script

4. **Collection CRUD**
   - Search the card database (autocomplete on name)
   - Add a printing to personal collection as a `card_instance` (condition, finish, language, quantity)
   - Edit / delete instances

5. **Location management**
   - Create / rename / delete locations
   - Assign and reassign card instances to a location (including "unsorted" = null)

6. **Auth**
   - Sign up / log in via Supabase Auth

7. **Minimal web UI**
   - Collection view (list or grid)
   - Location view
   - Add-card flow

---

## Explicitly NOT in this session
- Trading system of any kind (separate brief, Phase 2)
- Any pricing/valuation (TCGPlayer, Cardmarket, etc.) — permanently out of scope for this product, not just deferred
- Mobile app
- Payments/subscriptions

---

## Assumed stack (flag if you'd choose differently)
- Frontend: Next.js + TypeScript + Tailwind
- DB/Auth: Supabase, free tier
- Hosting: Vercel, free tier
- Card data: Scryfall bulk API, no key required

## Acceptance criteria
- [ ] Can create an account and log in
- [ ] Can search Scryfall-backed cards and add a printing to your collection with condition/foil/language
- [ ] Can create locations and assign/reassign instances between them
- [ ] Collection view reflects state accurately after add/edit/move
- [ ] Scryfall sync is a real repeatable job, not a hack

## A note on the hard part later
`card_instances` should be designed so the Phase 2 atomic trade-transfer transaction (described in `/docs/data-model-v1.md`) isn't awkward to bolt on — e.g., don't couple ownership and location so tightly that reassigning an owner requires touching unrelated fields.
