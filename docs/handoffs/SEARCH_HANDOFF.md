# Scryfall search — handoff / progress log

Spec: `docs/guides/SCRYFALL_SEARCH_DEVELOPMENT_GUIDE.md` (do not edit). Branch: `feat/scryfall-search`.
Update this file after every milestone step. A new agent should read this, then the guide sections it names.

## Decisions made (defaults from guide §14)
- External execution (Scryfall API) for submitted searches; local DB for suggestions/ownership.
- Feature flag: `SCRYFALL_SEARCH_ENABLED` (default on in code path; legacy path kept for rollback).
- No claim of "identical Scryfall website"; claim is "supports Scryfall search syntax".

## Status: SHIPPED to main 2026-09-26 (commit 2ab14fb), migration 48 applied
All milestones A-F are built except the named limitations below. The tables and blockers further down are the historical log and some lines (e.g. "untested in a browser", "migration not applied") are superseded by this banner.

Still open: set `SCRYFALL_SEARCH_CONTACT` in Vercel; manual a11y/IME/mobile checks; website's automatic no-result widening and price-search printing swap are NOT copied (offered as links / documented policy); friend availability and set gallery ARE built.

## Live probe findings (Milestone A, 2026-09-26)
- Syntax error: HTTP 400 JSON `{code:bad_request, details, warnings[]}` (e.g. `foo:bar` -> "All of your terms were ignored", warnings name the keyword).
- No match: HTTP 404 JSON `{code:not_found}` -> treated as normal empty result.
- Inline `order:released direction:asc` beats `order=name&dir=desc` params (confirmed, 155 results, oldest first).
- Regex + `unique:art` accepted; page size 175.
- A malformed request (I hit it via `curl -G --data-urlencode`) returns an HTML 400 page; service maps non-JSON to `bad_payload`.

## Files added/changed so far (all uncommitted, on branch feat/scryfall-search)
- `packages/upkeep-domain/src/catalog-search.ts` (+ test/catalog-search.test.ts): SearchSpec, URL round trip, legacy adapter, directive lexer (`readPresentation`, `setDirective`), builder, result types.
- `src/lib/cards/scryfall-search-core.ts` (pure, injected deps, tested by `scripts/scryfall-search.test.ts`) and `scryfall-search.ts` (server-only wiring).
- `src/app/api/cards/search/route.ts` (new canonical), `src/app/api/cards/suggestions/route.ts` (old behavior).
- `supabase/migrations/00000000000048_scryfall_api_gate.sql` — MUST be applied to prod (`supabase migration list --linked`) BEFORE enabling the feature, or search returns "unavailable" (gate RPC missing).

## Open decisions for the owner
- **ensure-printing (guide §10.3-5)** conflicts with CLAUDE.md constraint 4: users can't write `cards`, and no service-role client may live under src/. A user-callable SECURITY DEFINER import RPC would accept forged payloads. Interim: results absent locally are viewable, add actions disabled with an explanation. Needs owner/architect decision (e.g. RPC that takes only a scryfall id + a server-side verified fetch is impossible in SQL; alternative = accept only ids and let the nightly sync pick them up).
- Cache is per-instance in memory (shared cache written by users could be poisoned). Fine for now; revisit with owner.

## Verification state
- `npm run typecheck`, `npm test` (961), `npm test -w @upkeep/domain` (60), `npm run test:db` all green.
- NOT run: `npm run build`, browser check of /search and header (needs migration 48 applied to the DB `.env.local` points at; do NOT apply to prod without owner OK), reviewer agent pass.

## Next steps (in order)
1. `npm run build`; run `reviewer` agent on the diff.
2. Owner: apply migration 48 (`supabase db push`/linked) then test /search live; set SCRYFALL_SEARCH_CONTACT in Vercel.
3. Milestone F: characterize no-result fallback (extras, languages), set-only gallery, price-printing behavior, spelling; then implement or list as named limitations (UI already states they are not included).
4. Friend-availability annotation (batch, existing permission rules); recent-search storage versioning (currently stores query string only, options not replayed).
5. Update mobile? Not touched; `apps/mobile/src/cardSearch.ts` keeps its own local search.
6. Delete legacy path (`src/lib/cards/search.ts` usage in /search page, AdvancedSearchForm) once flag has soaked.

## Migration 48: APPLIED by the owner (confirmed via `supabase migration list --linked`).
Still to do: set SCRYFALL_SEARCH_CONTACT in Vercel. Live browser check of /search pending: dev server on :3000 redirects to /login; needs the owner to sign in in the browser pane (agent must not enter credentials).

## Policies decided (guide §8 research gates)
- Spelling help: BUILT. Zero-result plain-name query -> Scryfall fuzzy name lookup (gated) -> "Did you mean X?" link; original query never replaced.
- Price-printing: POLICY = a price filter (`usd<5`) never changes which printing is shown; use `prefer:usd-low` / `cheapest:usd` (Printing control). Website's own price-search printing swap was NOT characterized and is not copied; named limitation.
- No-result widening: offered as links (extras, lang:any, all prints), never automatic; the website's exact automatic sequence was not characterized.
- Upstream-only add actions: DECIDED by owner 2026-09-26 = view-only. Results with no local `cards` row (`localPrintingIds`) open in the panel with add buttons replaced by an explanation (convention: empty `last_synced_at`). No new privileged code.
- Nothing committed; owner said 'Not yet' to commit/PR (wants to check in browser first).

## Website characterization probes (2026-09-26, read-only)
- `t:emblem chandra`: website and API both return the same 6 emblem cards, so extras that a query itself asks for come back on both without any extra flag. Website pages by 60 ("Next 60"), API by 175 (documented difference; Upkeep uses 175 per page).
- Not probed (no reliable fixture found): website's automatic no-result widening sequence and price-search printing swap. Still named limitations; empty results offer the widening as links.

## Browser verification (2026-09-26, dev server, signed in by owner)
- `/search?q=t:legendary t:elf` -> 155 results matching the API probe; grid renders with real images.
- Syntax error (`foo:bar`) -> upstream message + warning shown, query preserved.
- `lightnin bolt&display=checklist` -> checklist view works.
- Local printing opens the panel by id (full row: finishes, prices); upstream-only opens from payload view-only (fixed after first check showed blank finishes).
- Header Enter with `t:goblin c<=r unique:art` -> `/search?q=t%3Agoblin+c%3C%3Dr+unique%3Aart`, no local preview.
- Not manually tested: IME, screen reader, mobile sheet, slow/offline upstream, builder UI clicks, upstream-only card panel note.
- After the panel fix: `npm test` 963 pass, domain 61 pass, eslint clean. Builder UI checked live: elf+bird with "match any" generates `(t:elf or t:bird)`; existing raw text untouched.
- Nothing committed (owner: "Not yet").

## Also done later
- Friend availability on results (`getFriendAvailabilityForResults`, one batched read, annotation only).
- Set-only gallery (`setOnlyCode`): lone `e:xxx` applies unique:prints order:set with a visible note.
- Remaining: spelling help, price-printing policy, no-result auto-widening (offered as links instead), upstream-only add actions (owner decision), commit/PR.

## Also done after review
- ownershipFor chunks `.in()` at 60 ids.
- Empty results offer (never auto-apply) include extras / lang:any / all prints links.

## Log
- 2026-09-26: branch created; domain contracts; service + gate migration; routes; UI (results, form, builder, header); tests green.
- 2026-09-26: reviewer pass done. Fixed: gate RPCs now treat args as untrusted (fixed 600ms gap, queue bound <=4000, cooldown fixed 30s and not re-armable while open; schema test covers abuse); header `looksLikeSyntax` no longer swallows names with "Name: Red" or quotes; aria-activedescendant reset; stale route comments. Deferred: `.in()` with 175 ids per request in ownershipFor (chunk if URL limits bite); old-bundle clients hitting new /api/cards/search during deploy is transient. test:db, npm test green after fixes.

- 2026-09-26: Query builder UI redesigned (`CatalogSearchForm.tsx`): generated query + Use/Add/Reset pinned at top, collapsible sections (Card, Color, Cost & stats, Printing; Legality & price, Art & flavor, Results collapsed), mana-pip toggles (Scryfall symbols) for colors and commander identity, chips/segmented controls. Verified in browser: R+G pips -> `c>=gr`.

- 2026-09-26: Follow-up review and deployed smoke check from main. Read-only review of `6a473ef..2ab14fb` found no owner-scope or gate-RPC defect. The reviewer noted that validation trims outer whitespace before transport; the guide explicitly permits trimming outside the query, and a test confirms the query's internal characters reach Scryfall unchanged. Migration 48 is described as applied in this handoff; it was not independently checked against production in this pass.
- Deployed checks (signed in by the owner): `/search?q=t:legendary t:elf` showed 155 results; `foo:bar` showed the upstream syntax error and warning; a deliberately unmatched name showed the empty state and widening links. The header Enter submitted `t:goblin c<=r unique:art` unchanged and showed 643 results. R+G mana pips generated `c>=rg`; **Add to search** appended it to the existing text and **Use this** replaced the text. Opening Abomination of Llanowar showed the card panel, printing details and collection/deck actions.
- Accessibility follow-up: the deployed accessibility tree named the header combobox “Search all cards Advanced Search” because the wrapping label also contained the Advanced Search link. `src/components/HeaderSearch.tsx` now gives the combobox an explicit `aria-label="Search all cards"`; this source change is not deployed yet. Builder fields, pip buttons and matching controls expose accessible names/states in the deployed accessibility tree, but no screen reader was used.
- Still not manually verified: an actual IME composition session, slow/offline upstream behavior, and the below-`lg` header icon on a physical device. The 390×844 emulated viewport check is recorded below. The handler has an `isComposing` guard and upstream requests have a bounded timeout, but those are code checks rather than manual verification. No mobile device was used.

- 2026-09-26: Search follow-up on the deployed site at desktop and an emulated 390×844 viewport. At desktop, the combobox still has the combined accessible name “Search all cards Advanced Search”; the explicit label fix above remains local and is not deployed, so its deployed effect could not be confirmed. At 390×844, the full header field is hidden and the magnifying-glass Advanced Search link is visible in the header accessibility tree and screenshot. This is viewport emulation, not a physical-device check.
- IME and upstream failure limits: a real IME composition session was not available in this browser setup; the deployed handler's `isComposing` guard was confirmed by source inspection only. The browser setup exposes no offline/network-throttling control, so slow/offline behavior could not be induced. Source inspection confirms the upstream request has a bounded timeout and the search page renders the returned error message with a Retry link when available; this is not a deployed failure-path smoke test. No source-code defect was found in these checks.
