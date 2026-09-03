# MTGManager — Frontend brief: mobile support, theme, layout

**For:** a fresh coding-agent session (any capable model) working in this repo.
**Goal:** make the app pleasant to use in a mobile browser, keep the eye-comfortable
colour palette, and tighten the desktop layout. The colour work is mostly done
(see §3); the rest is planned in §5 as resumable phases.

Paste this whole file as the opening message of the new chat. It is written to be
self-contained — you should not need the conversation it came from.

---

## 1. How to use this brief

- Work the phases in §5 **in order**. Each phase is a coherent unit with its own
  checkpoint; stop and report at each checkpoint so a context reset can resume
  from the phase list.
- Do **Phase 0** (orientation) first — it is a single batched set of reads.
- Follow the token-efficiency rules in §2. They are not optional; this repo is
  large and most of the work touches a handful of files.
- Respect the guardrails in §7.

---

## 2. Token-efficiency working agreement

1. **One orientation pass.** Read the Phase 0 file list in a single batch of
   parallel reads. Do not read anything else until a later step names it. Never
   re-read a file you have already read — the harness tracks file state and
   `Edit` will error if your copy is stale.
2. **Change the primitive, not the call sites.** Every colour flows through the
   design tokens in `src/app/globals.css`; every button/input/card flows through
   `src/components/ui.tsx`. ~80% of the visual change lives in <5 files. Before
   editing a call site, `grep` for the class or pattern to see the true scope —
   often the fix belongs upstream.
3. **Batch.** Independent `Edit`s go in one message. Independent tool calls go in
   one message.
4. **Check at phase boundaries only.** Run the full suite
   (`npx tsc --noEmit && npm run lint && npm test && npm run build`) at each
   checkpoint, not after every file. Between edits, reason about types from what
   you already know.
5. **Prefer `Edit` over `Write`.** Never rewrite a whole file for a small change.
   No reformatting, no drive-by refactors, no dependency bumps, no config
   changes.
6. **New pure logic → `scripts/<name>.test.ts`** using `node:test` (see any
   existing `scripts/*.test.ts`). Do not add a test runner or libraries.
7. **Screenshot sparingly** — only at checkpoints, only at 375px and 1440px, both
   themes.
8. **Don't explore the whole `src/` tree.** The manifest in §4 is enough.

---

## 3. What is already done — the colour palette

The palette was reworked for eye comfort (no full-screen pure white in light
mode; text dimmed off near-black / near-white to cut glare and halation). A new
`--canvas` token was introduced for the page background, separate from
`--surface` (cards / header / inputs) — before, one value did both, so a soft
page also greyed out the cards.

**Do not redo this.** It is in `src/app/globals.css`. Current values:

| role | token | light | dark |
|---|---|---|---|
| page background | `--canvas` *(new)* | `#edeef1` | `#131519` |
| paper: cards, header, fields | `--surface` | `#fbfbfc` | `#191c22` |
| recessed: hovers, table headers, insets | `--surface-muted` | `#e3e5ea` | `#262b34` |
| elevated: menus, popovers, stat tiles | `--surface-raised` | `#ffffff` | `#22272f` |
| border | `--border` | `#dbdee4` | `#313742` |
| body text | `--ink` | `#242830` | `#dee1e7` |
| muted text | `--ink-muted` | `#616a76` | `#98a1ad` |
| accent | `--accent` | `#4f5ecb` | `#828ff2` |
| accent text-on-accent | `--accent-ink` | `#ffffff` | `#12141c` |
| accent tint | `--accent-soft` | `#e9ecfb` | `#232a3f` |
| danger | `--danger` | `#bb2d2d` | `#ee9090` |

- `@theme inline` maps each to a Tailwind utility: `bg-canvas`, `bg-surface`,
  `bg-surface-muted`, `bg-surface-raised`, `border-border`, `text-ink`,
  `text-ink-muted`, `bg-accent` / `text-accent` / `text-accent-ink` /
  `bg-accent-soft`, `text-danger`.
- Dark mode is a **class** on `<html>` (`.dark`), applied before first paint by
  `src/components/ThemeScript.tsx`, driven by
  `@custom-variant dark (&:where(.dark, .dark *))`.
- `html, body` background is `var(--canvas)`.

**Remaining palette work (small, fold into Phase 1):** click through every route
in both themes and confirm nothing regressed. `grep` the codebase for `#`,
`rgb(`, `bg-white`, `bg-black`, `bg-gray`, `bg-slate`, `bg-zinc`, `text-white`,
`text-black` — there should be **zero** hardcoded colours (there were none before;
keep it that way). Only the `.foil-mark` gradient in `globals.css` is
intentionally fixed-colour.

---

## 4. Project snapshot

**Stack:** Next.js 16 (App Router, `proxy.ts` not `middleware.ts`), React 19,
TypeScript, Tailwind CSS v4 (config-less: `@import "tailwindcss"` +
`@theme inline` in `globals.css`; `postcss.config.mjs` loads
`@tailwindcss/postcss`; **there is no `tailwind.config`**). Supabase for
data/auth. `AGENTS.md` at the repo root warns that this Next.js has breaking
changes vs training data — when you need an unfamiliar App Router API, read the
matching guide under `node_modules/next/dist/docs/01-app/**` first.

**Commands:** `npx tsc --noEmit` · `npm run lint` · `npm test`
(`tsx --test scripts/*.test.ts`) · `npm run build` · `npm run dev` (port 3000;
the user may already have it running — a launch config exists at
`.claude/launch.json`).

**Conventions:**
- Server Components by default; `"use client"` only where interaction needs it.
- Server actions live in `"use server"` files; forms use `useActionState`; the
  action's state shape lives in a **non-`"use server"`** sibling
  (`*-state.ts` / `*-action-state.ts`).
- Pure logic goes in `src/lib/**` and is unit-tested in `scripts/*.test.ts`.
- Colours only via tokens (see §3). Spacing/typography via Tailwind utilities.
- **Per-browser preferences** (theme, show-prices, visible columns) use the same
  pattern: a `localStorage` key + `useSyncExternalStore` with a server snapshot
  of the default and a `try/catch` in-memory fallback. See
  `src/components/PriceToggle.tsx` and `src/components/collection/columns.ts` —
  copy this shape for any new setting (Phase 3 adds one).
- Existing responsive usage is patchy — `sm:`/`lg:`/`xl:` appear in places, but
  the shell and several pages assume a wide viewport.

**Key files (the manifest — read these in Phase 0):**

| file | what it is |
|---|---|
| `src/app/globals.css` | design tokens, `@theme inline`, dark variant, base + `.foil-mark` |
| `src/app/layout.tsx` | root layout: `<html>`, `ThemeScript`, `<body class="min-h-screen antialiased">` |
| `src/app/(app)/layout.tsx` | **signed-in shell**: sticky header + nav + content flex row + the card-preview `<aside>` |
| `src/components/ui.tsx` | primitives: `cx`, `Button` (variants), `Input`/`Select`/`Field` (`FIELD_BASE`), `Card`, `Banner`, `EmptyState`, `Stat`, `Badge` |
| `src/components/NavLink.tsx` | active-aware nav link (client, uses `usePathname`) |
| `src/components/CardPanel.tsx` | `CardPanelProvider`, `CardPanelOutlet` (`<aside class="… w-1/5 hidden xl:block">`), `useCardPreview`, `CardPreviewTarget`, `CardPreviewLink`, the `CardPanel` body |
| `src/components/ThemeToggle.tsx`, `ThemeScript.tsx` | theme switch + pre-paint applier |
| `src/components/collection/CollectionTable.tsx` | the big table (already `overflow-x-auto` + `min-w-[40rem]`), row-action menu, `ColumnsMenu` |
| `src/components/collection/CollectionFilters.tsx` | toggle-open advanced filter panel |
| `src/components/collection/BulkBar.tsx` | floating bulk-action bar |
| `src/lib/collection/queries.ts` | server reads incl. `locateInCollection` (card locator) |
| pages under `src/app/(app)/` | `dashboard` `collection` `collection/add` `collection/import` `decks` `decks/[id]` `find` `wants` `friends` `trades` `u/[username]` `locations` `notifications` `terms` |

**Design intent (from the project charter):** a functional inventory tool —
legible and fast, restrained, not branded. Web-first, mobile "to follow" (this
brief *is* that follow). Keep the visual language calm; don't introduce a new
component system.

---

## 5. Work plan

Screens to test at every checkpoint: **375px** (phone) and **1440px** (desktop),
**both themes**. Use the browser tools' `resize_window` presets `mobile`
(375×812, emulates touch) / `desktop` (reset); reload after switching. Everything
under `/(app)` needs a signed-in session — ask the user for test credentials or
to keep their dev server logged in.

---

### Phase 0 — Orientation (no edits)

Batch-read the manifest files in §4. Also read: `src/app/(app)/collection/page.tsx`,
`src/app/(app)/dashboard/page.tsx`, `src/app/(app)/find/page.tsx`,
`src/components/collection/columns.ts`. Then write a 5–10 line note of what you
found that changes the plan below, and proceed. **Do not read the rest of `src/`.**

---

### Phase 1 — Responsive shell & spacing

**Goal:** page content shares the same left/right edges as the top nav at every
width; sane gutters/rhythm on mobile; no horizontal scroll on `<body>` at 375;
inputs don't trigger iOS focus-zoom.

**Files:** `src/app/(app)/layout.tsx`, `src/components/ui.tsx`,
`src/app/globals.css`, `src/app/layout.tsx`.

**Steps:**
1. `(app)/layout.tsx`: the header nav is `mx-auto max-w-5xl` but the content row
   (`<div class="flex w-full px-6 py-8">`) is full-bleed. Wrap the content row in
   a matching centred container. Recommend **`mx-auto w-full max-w-6xl`** for
   both nav and content (bump the nav from `5xl` to `6xl`). Gutters:
   `px-4 py-6 sm:px-6 sm:py-8`.
2. Reading/form pages (`find`, `wants`, `terms`, `notifications`) already use
   `mx-auto max-w-2xl` — leave their width, just make sure they sit inside the
   same outer gutter (no double padding). Data pages (collection, dashboard,
   decks, friends) should drop any ad-hoc width and inherit the `max-w-6xl`
   container.
3. `ui.tsx` `FIELD_BASE` and `Select`: `text-sm` → **`text-base sm:text-sm`**
   (16px on mobile stops iOS Safari zooming on focus; 14px keeps desktop
   density).
4. `src/app/layout.tsx`: Next 16 emits a sensible default viewport. If you want
   it explicit, add `export const viewport = { width: "device-width",
   initialScale: 1 }`. **Do not** set `maximumScale`/`userScalable: false`.
5. Sweep any element that can cause horizontal overflow at 375 (fixed pixel
   widths, `min-w-[…]` on non-scroll containers, wide `grid-cols-*` without a
   `sm:` base of 1–2).

**Checkpoint:** `tsc && lint && build`; screenshot `/` and `/login` at 375 + 1440
in both themes; confirm no body-level horizontal scroll.

---

### Phase 2 — Mobile navigation

**Goal:** every destination reachable on a phone in ≤2 taps; the top bar never
overflows.

**Files:** `src/app/(app)/layout.tsx`; new `src/components/AppNav.tsx` (client).

**Steps:**
1. Define the destination list once (`{ label, href }[]`): Dashboard, Collection,
   Decks, Find, Wants, Friends, Locations (add Locations — see Phase 6.1),
   Alerts.
2. **Desktop (`md:` up):** the current inline `NavLink` row.
3. **Mobile (`< md`):** hide the inline links; show a hamburger button in the top
   bar (keep logo + hamburger + Alerts-with-badge visible). It opens a drawer —
   a native `<dialog>` or a small client component: full-height panel,
   `bg-surface`, slide-in from the side, dimmed backdrop. List every destination
   + the theme toggle + Sign out. Close on backdrop tap, on `Esc`, and on route
   change (`usePathname` effect).
4. Focus management: trap focus in the open drawer, return focus to the hamburger
   on close (`<dialog>` gives most of this for free).

**Checkpoint:** build; screenshot the drawer open and closed at 375; keyboard-tab
through it.

---

### Phase 3 — Card preview: three modes (sidebar / tooltip / touch sheet)

**Goal:** the card preview works on every device *and* the user can turn the
desktop sidebar off in favour of a lighter hover tooltip.

Three delivery modes, one shared data source:
- **`sidebar`** (default, desktop `xl+`) — the current `<aside>` panel.
- **`tooltip`** (desktop, when the user has switched the sidebar off) — hovering a
  card name for a beat pops a floating card-detail tooltip that vanishes on
  mouse-leave; the `<aside>` is not rendered at all, so `main` is full width.
- **touch sheet** (any device with a coarse pointer / below `xl`) — tapping a
  card opens a bottom sheet / dialog. This is the mobile answer regardless of the
  sidebar/tooltip setting (there is no hover on touch).

Today the preview is hover-only and `hidden` below `xl`, so mobile users can't
see card details at all, and there is no way to dismiss the sidebar.

**Files:** `src/components/CardPanel.tsx`, `src/app/(app)/layout.tsx`, a new
preference module (mirror `src/components/PriceToggle.tsx` /
`src/components/collection/columns.ts`), and the pages that call
`CardPreviewLink` / `CardPreviewTarget` (no change expected there — they keep
using `useCardPreview`).

**Steps:**

1. **Shared card-detail renderer.** Extract the visual body of `CardPanel` into a
   presentational `CardDetails({ card, state })` so the `<aside>`, the tooltip,
   and the touch sheet all render byte-identical content. Keep the existing
   fetch-by-id + cache in `CardPanelProvider`; the three renderers only consume
   `{ card, state }` from context.

2. **The preference.** New per-browser setting, same `useSyncExternalStore` +
   `localStorage` pattern as the price and column preferences (no flash risk — it
   only gates an `xl`-only element; server snapshot = default).
   - Key: `mtgmanager-card-preview`. Values: `"sidebar"` (default) | `"tooltip"`.
   - Expose `useCardPreviewMode()` returning the current value, and a setter.
   - Wrap read/write in `try/catch` (private mode) with an in-memory fallback,
     exactly like the existing preference modules.

3. **The control.** Two ways to reach it, both light:
   - A small **collapse/"×" affordance on the `<aside>` header** that sets the
     preference to `"tooltip"`.
   - A toggle to bring it back — put it next to `ThemeToggle` in the header
     cluster (icon + `aria-pressed`), or in a tiny settings popover if the header
     is too tight after Phase 2. Label it clearly ("Card sidebar" / "Show card
     panel").

4. **`useCardPreview` — mode-aware handlers.** It already returns
   `{ onMouseEnter, onFocus, "data-card-preview" }`. Extend it:
   - **coarse pointer OR `< xl`:** return an `onClick` that opens the **touch
     sheet** (reusing `CardDetails`). Suppress hover handlers here.
   - **`sidebar` mode, fine pointer, `xl+`:** unchanged — hover/focus populate the
     `<aside>` immediately.
   - **`tooltip` mode, fine pointer, `xl+`:** `onMouseEnter`/`onFocus` start a
     **delay timer**; on fire, show `<CardTooltip>` anchored to that element.
     `onMouseLeave`/`onBlur`/`Esc`/`scroll` clear the timer and hide it.
     - Delay: deliberate — start around **600–800ms** so it never fires while
       scanning a list. (The user described it as "a few seconds"; tune toward
       the longer end but keep it responsive.)
     - Hide immediately on mouse-leave — no lingering.

5. **`<CardTooltip>`** — a portal component (`createPortal` to `document.body`),
   `position: fixed`, rendering `CardDetails`. Hand-rolled positioning (no new
   deps): measure the trigger's `getBoundingClientRect()`, prefer right-of / then
   left-of / then below, and **clamp to the viewport** so it never causes
   horizontal page scroll on a narrow desktop window. `role="tooltip"`. It is
   non-interactive (pointer-events: none is fine) — it's a preview, not a menu.
   Respect `prefers-reduced-motion` for any fade.

6. **Layout wiring.** In `(app)/layout.tsx`:
   - Render the `<aside>` column **only** when `mode === "sidebar"` AND the route
     has card targets (`/collection`, `/collection/add`, `/collection/import`,
     `/decks/[id]`, `/u/[username]`). Otherwise render `children` full width and
     drop `xl:w-4/5` / the sibling column.
   - `<CardTooltip>` and the touch sheet mount from the provider regardless of
     route, but only actually render when there is an active card.
   - Net: in `tooltip` mode, no width is ever reserved anywhere.

7. **Keyboard + a11y.** Focusing a card name shows the sidebar (sidebar mode) or,
   after the same delay, the tooltip (tooltip mode); `Esc`/blur dismiss. Don't
   trap focus. The touch sheet is a real dialog (focus trap, `Esc`, backdrop
   dismiss).

**Checkpoint:** build. Verify:
- desktop `/collection`, sidebar mode: hover → `<aside>`; `/friends` content is
  full width (no reserved rail).
- switch to tooltip mode: `<aside>` gone on `/collection`, `main` full width;
  hover a card name ~0.7s → tooltip; move mouse away → gone; no horizontal page
  scroll with the tooltip near the right edge.
- switch back to sidebar mode via the header toggle.
- mobile `/collection`: tap a card name → sheet opens, dismissable (works in both
  preference states).

---

### Phase 4 — Responsive data views

**Goal:** the collection table and its controls are usable on a phone.

**Files:** `src/components/collection/CollectionTable.tsx`, `CollectionFilters.tsx`,
`BulkBar.tsx`; check `src/components/decks/DeckWorkspace.tsx`.

**Steps:**
1. `CollectionTable` already scrolls horizontally (`overflow-x-auto`,
   `min-w-[40rem]`). Make the **name column sticky** (`sticky left-0 bg-surface
   z-10`, plus a subtle right-edge shadow) so it stays put while scrolling wide
   rows.
2. Only if horizontal scroll tests badly: add a `sm:hidden` stacked card list
   (name, set, qty, availability, price) alongside the `hidden sm:block` table.
   Don't build this speculatively.
3. `CollectionFilters`: on `< sm`, render the advanced panel as a bottom
   sheet / full-screen dialog rather than an inline expand (it currently shoves
   the table far down the page). Same fields, same submit-navigates behaviour.
4. `BulkBar`: on mobile, pin it as `fixed inset-x-0 bottom-0` action bar.
5. `ColumnsMenu` dropdown: sheet on mobile.
6. `DeckWorkspace`: apply the same `overflow-x-auto` wrapper to any wide
   section/table.

**Checkpoint:** build; screenshot `/collection` at 375 with (a) filters open,
(b) a row selected so the bulk bar shows, (c) the column menu open.

---

### Phase 5 — `PageHeader` primitive

**Goal:** one consistent page header; kill the per-page bespoke title/description/
back-link/actions blocks.

**Files:** add `PageHeader` to `src/components/ui.tsx` (or its own file); adopt
across `src/app/(app)/**/page.tsx`.

**Steps:**
1. `PageHeader({ title, subtitle?, backHref?, backLabel?, actions? })`: renders
   an optional back-link, `<h1>` (`text-xl font-semibold tracking-tight`),
   optional subtitle (`text-sm text-ink-muted`), and a right-aligned `actions`
   slot that wraps **below** the title on mobile (`flex flex-wrap`).
2. Replace the hand-rolled header in each page: dashboard, collection, decks,
   decks/[id], find, wants, friends, trades, u/[username], locations,
   notifications, terms. One page at a time; run `tsc` every ~3 pages. Purely
   mechanical — don't redesign the pages.

**Checkpoint:** build; eyeball 3–4 pages at both widths for consistent rhythm.

---

### Phase 6 — Information architecture

**Goal:** structure matches usage.

**Files:** `src/app/(app)/layout.tsx`; new `src/components/HeaderSearch.tsx`;
`src/app/(app)/dashboard/page.tsx`; `src/lib/collection/queries.ts` (has
`locateInCollection` already) / `src/lib/social/queries.ts`.

**Steps:**
1. **Locations in the nav.** It's a core concept currently reachable only via
   "Manage storage" text links. Add it as a nav destination (already accounted
   for in Phase 2.1).
2. **Header search.** "Where is my card" is the product thesis but lives behind a
   nav tab. Add a compact search input to the top bar on desktop / a search-icon
   that opens a search sheet on mobile, calling `locateInCollection` and showing
   results with jump links (to `/collection?location=…&q=…`). Optionally bind
   `⌘K` / `Ctrl+K` to focus it. Keep `/find` as the full page.
3. **Dashboard attention strip.** A row of links at the top of the dashboard:
   *trades waiting on you*, *offers expiring soon*, *unread alerts*, *unsorted
   count*, *wants available from friends* (generalise the existing wants
   callout). Source counts from existing queries (`getMyTrades`,
   `getUnreadNotificationCount`, `getDashboardSummary`, `getWantListView`); add a
   single `getAttentionSummary()` if it cuts round-trips.

**Checkpoint:** build; screenshot dashboard + the header search (desktop input,
mobile sheet) at both widths.

---

### Phase 7 — Touch targets & polish

**Goal:** nothing important smaller than ~40px on touch; final consistency sweep.

**Steps:**
1. Bump icon buttons / steppers currently `size-6`/`size-7` to `size-9` on coarse
   pointers (or expand hit area with `p-2 -m-2`). Affected: quantity steppers in
   `AddCardForm`, `TradeBuilder`, `WantListManager`, the deck `QuantityStepper`;
   the row-action menu button; theme toggle; filter chips.
2. Inline `text-xs` action links (Counter / Dismiss / Remove / "change"): more
   spacing (`gap-3`) and larger tap area on mobile.
3. Sticky `<thead>` on scroll in `CollectionTable` (offset by the header height).
4. If the preview rail survived Phase 3 as a desktop column, give it contextual
   content instead of blank space: active-filter summary + counts on
   `/collection`, mana-curve / colour breakdown on `/decks/[id]`, the attention
   items on `/dashboard`.
5. Final `grep` sweep for hardcoded colours (§3) and stray fixed widths.

**Checkpoint:** full `tsc && lint && test && build`; run the §6 checklist end to
end.

---

## 6. Acceptance checklist

Verify at **375 / 768 / 1440**, **both themes**:

- [ ] No `<body>` horizontal scroll at 375 on every route in §5's test list
- [ ] Every nav destination reachable on mobile in ≤2 taps; top bar never wraps
- [ ] Tapping a card anywhere opens its full details on mobile (in both preview
      preference states)
- [ ] Card preview `sidebar` mode (default): hover populates the `<aside>` on
      card-target routes; no rail reserved on other routes
- [ ] Card preview `tooltip` mode: `<aside>` never renders, `main` is full width
      everywhere; hovering a card name for ~0.7s shows a floating tooltip with
      the same details; it disappears on mouse-leave; it never causes horizontal
      page scroll near the viewport edge
- [ ] The preview preference persists across reloads and has a visible control to
      switch back and forth
- [ ] Form inputs do not zoom the viewport on focus (mobile Safari / Chrome)
- [ ] Collection: name column stays visible while scrolling; filters, bulk bar,
      and column menu all usable on a phone
- [ ] Every `(app)` page uses `PageHeader`; consistent title/spacing rhythm
- [ ] Page content and the top nav share the same left/right edges at all widths
- [ ] Primary tap targets ≥ ~40px
- [ ] Light mode has no full-screen pure white; dark mode text isn't near-white
      glare (palette from §3 intact)
- [ ] No hardcoded colours anywhere (`grep` clean per §3)
- [ ] `npx tsc --noEmit` clean · `npm run lint` clean · `npm test` green ·
      `npm run build` passes

---

## 7. Guardrails — do not touch

- `supabase/**` (schema, migrations, functions), `.env*`
- `node_modules/**`, `.next/**`
- `package.json` / `package-lock.json` — **no new dependencies without asking**
- The test runner setup (add new `scripts/*.test.ts`; don't change how tests run)
- `eslint.config.mjs`, `postcss.config.mjs`, `tsconfig.json`, `next.config.ts`
- `AGENTS.md`, `CLAUDE.md`, `docs/**`
- No Prettier / formatting passes, no unrelated refactors, no renames

If a change seems to require touching any of the above, stop and ask.
