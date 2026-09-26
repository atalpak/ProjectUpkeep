# Scryfall search — handoff / progress log

Spec: `SCRYFALL_SEARCH_DEVELOPMENT_GUIDE.md` (do not edit). Branch: `feat/scryfall-search`.
Update this file after every milestone step. A new agent should read this, then the guide sections it names.

## Decisions made (defaults from guide §14)
- External execution (Scryfall API) for submitted searches; local DB for suggestions/ownership.
- Feature flag: `SCRYFALL_SEARCH_ENABLED` (default on in code path; legacy path kept for rollback).
- No claim of "identical Scryfall website"; claim is "supports Scryfall search syntax".

## Status
| Milestone | State | Notes |
|---|---|---|
| A. Spike | partial | Live probes done 2026-09-26 (below). Website fallbacks / price-printing policy / spelling NOT characterized -> no "identical to Scryfall website" claim. |
| B. Shared service | DONE | contracts, core service, gate migration 48 (schema test, test:db green), unit tests |
| C. Entry-point migration | DONE (untested in a browser) | header submits every nonempty query to `/search?q=`; syntax never previewed locally; old `/api/cards/search` -> `/api/cards/suggestions` (6 callers repointed); legacy `raw=`/facet URLs normalise |
| D. Rendering + integration | mostly done | 4 views, controls edit directives, pagination, ownership badges (exact vs other printing), panel opens upstream-only printings via `catalogCardToPanelCard`. NOT done: friend availability annotation, ensure-printing (see decisions), set gallery |
| E. Visual builder | DONE | `CatalogSearchForm` (raw is source of truth; builder only generates, Replace/Add buttons; never parses raw) |
| F. Website conveniences/release | not started | fallbacks, set gallery, spelling, price policy, a11y/manual pass, load check |

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
