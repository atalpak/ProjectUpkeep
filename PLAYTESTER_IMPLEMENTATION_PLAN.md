# Project Upkeep tactile playtester — implementation plan

**Status:** proposed implementation plan  
**Audience:** developer implementing the web experience  
**Product decision:** Build a first-class, rules-light, single-player Magic tabletop for goldfishing. It must feel fast and tactile; it must not claim to be a comprehensive Magic rules engine.

## 1. Product thesis

Project Upkeep's advantage is not that it can replace every virtual tabletop. It knows the intended decklist for every deck a user owns, ready to goldfish without a separate deck-editor step.

The playtester should therefore answer: **“What does it feel like to play this complete deck?”** A player should not have to finish tracking their physical inventory before they can goldfish the 100-card list they are building toward.

It should be a delightful manual board for shuffling, mulliganing, drawing, playing, tapping, moving, annotating, and saving a game state. Existing statistics are valuable but solve a different job: they are a consistency lab, not a tabletop.

### Goals

- Make a solo goldfish session feel immediate, visual, forgiving, and satisfying on desktop web.
- Always start from the complete intended decklist — the deck's `deck_cards` entries — regardless of what's physically sleeved. Simplification decision, 2026-09-23: the earlier "Use sleeved copies only" mode is dropped from v1. It added a whole second data path (capped-quantity generation, a shortfall banner, a resume-time "deck changed" prompt) for a case — playtesting with less than the full list — the product doesn't need to solve at launch.
- Support the common physical actions without requiring the app to understand card-specific rules.
- Make every meaningful action reversible, and make an interesting board state saveable.
- Preserve Project Upkeep's physical-inventory identity without moving cards or changing deck contents as part of playtesting.

### Explicit non-goals for v1

- A comprehensive Magic rules engine, automatic trigger resolution, priority, layers, targeting validation, combat validation, or rules enforcement.
- Multiplayer, live collaboration, opponent boards, matchmaking, voice/video, or spectator sharing.
- A deck editor, purchase flow, marketplace, or price-based recommendations.
- Persisting changes to `card_instances`, `deck_cards`, deck locations, or ownership from the playtester.
- A shrunken desktop board as the primary phone experience. Mobile support comes after the desktop interaction model is proven.

The board may offer convenience actions such as “create a token” or “add a counter,” but the player remains the authority on whether an action is legal.

## 2. Current codebase and integration decisions

The current playtesting code already provides useful foundations:

- `src/lib/playtest/library.ts` turns a deck list into a shuffled library and distinguishes `designed` from the analyzer's list-capped `built` mode.
- `src/lib/playtest/rng.ts` supplies deterministic seeded shuffling.
- `src/lib/playtest/keep.ts` and `src/lib/playtest/simulate.ts` power the analytical goldfish / consistency experience.
- `src/components/decks/Playtest.tsx` is deliberately shell-agnostic and is mounted at both the full `/decks/[id]/test` route and the deck-page dialog.
- `getDeckList()` already provides the intended list, which is enough to form the starting game state.

Do **not** replace or overload the current analyzer. Keep it as **Analyze** / **Consistency**. Add the manual product as **Play**.

| Surface | Responsibility after this work |
| --- | --- |
| `/decks/[id]/play` | Full-page tactile solo tabletop; route is refresh-safe and shareable within the user's account. |
| `/decks/[id]/test` | Existing statistical consistency lab; preserve existing deep links. |
| Deck detail banner | Show separate `Play` and `Analyze` actions. `Play` must open the real route, not a constrained dialog. |
| `PlaytestLauncher` | Either retire it in favour of an `Analyze` launcher, or relabel it precisely. Do not present a modal as the manual board. |

### Constraints that must remain true

- A deck is a `locations` row with `type = 'deck'`; a play session is not a location and must not be modeled as one.
- `deck_cards` is the intended list; `card_instances` are physical copies. The playtester reads only `deck_cards` and never mutates either table.
- Own collection queries must keep explicit owner filters; public friend decks must not become playable in v1.
- Any new database shape requires a new numbered migration—never edit an applied migration. New RLS policies must be owner-only for v1.
- No service-role client belongs under `src/`.

## 3. First-release player experience

### 3.1 Entry and setup

1. From a deck page, choose **Play**.
2. Start with the complete intended decklist (`deck_cards`), excluding the configured commander from the library.
3. Choose a start option: `New game` (default), `Resume saved game`, or `Open saved state`.
4. `New game` shuffles using a generated seed, presents seven cards, and offers normal London-mulligan controls. The player controls what goes to the bottom.
5. Once kept, the full board appears. The commander begins in the command zone when one is configured.

### 3.2 Board layout

Desktop is the launch platform. At a typical laptop width, the board must preserve the physical mental model:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Back to deck · Deck name · undo/redo · save · menu                     │
├───────────┬──────────────────────────────────────────────┬───────────┤
│ Library   │                                              │ Graveyard │
│  92       │             Battlefield                      │ Exile     │
│ [Draw]    │       player-arranged cards/tokens           │           │
│ [Search]  │                                              │           │
│           ├──────────────────────────────────────────────┤           │
│ Command   │ Stack / temporary row (optional in v1.1)     │ Notes     │
├───────────┴──────────────────────────────────────────────┴───────────┤
│ Hand — fan / overlap, inspect, drag a card onto the board             │
├──────────────────────────────────────────────────────────────────────┤
│ Turn 4 · life · commander damage · mana notes · dice · next turn      │
└──────────────────────────────────────────────────────────────────────┘
```

- Use the existing parchment/ink/ochre visual system, card artwork, dark theme, and `coarse:min-h-11` touch-target convention.
- Keep the battlefield intentionally open. Do not force every permanent into a rules-defined lane.
- Zones are always available but visually quiet; the battlefield and hand receive the emphasis.
- Cards on the battlefield can be freely positioned and grouped. A reasonable initial implementation can use ordered lanes / stacks instead of arbitrary x/y coordinates if it still feels direct and rearrangeable. Do not begin with a physics engine.
- Card art must be readable on hover/focus, with a larger inspect treatment and full oracle text in a side sheet or popover.

### 3.3 Required actions

All required actions must be available from a card context menu, keyboard path, and touch-friendly alternative. Pointer shortcuts enhance the experience but may not be the only way to act.

| Area | v1 behaviour |
| --- | --- |
| Library | Shuffle, draw one, draw N, peek/reorder top cards, search/reveal, mill N. Search may be manual: show the library and let the player choose. |
| Opening hand | Keep, mulligan, select cards to bottom under London mulligan, restart. |
| Hand | Fan/overlap cards, inspect, reorder, drag to a zone or battlefield. |
| Battlefield | Drag/rearrange; tap/untap; flip/transform visual state; rotate; face-down state; copy; group/ungroup; add/remove named counters; notes; move to any zone. |
| Tokens | Create a token from a concise form (name, power/toughness, image optional, count). Tokens must be distinct game objects, not additions to the deck library. |
| Zones | View, reorder where relevant, move cards between zones, and return a card to hand/library without claiming rules correctness. |
| Game controls | Turn increment, turn label/note, life adjustment, commander damage tracker, generic counter/dice controls, restart, save snapshot. |
| History | Undo and redo every state-changing command in the active session. Show a readable recent-action log. |

### 3.4 Interaction contract

- A click/tap selects a card; `Enter`/`Space` opens its action menu; `Escape` clears selection or closes the topmost surface.
- Double-click / double-tap toggles tapped state. A visible button always provides the same action.
- Dragging is supported with pointer input. Keyboard users can select a card, choose `Move`, then select a destination; do not make drag-and-drop the only path.
- `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` undo/redo. The visible buttons must remain discoverable.
- Use short reduced-motion-aware transitions for draw, move, tap, and shuffle. Never make an action wait for animation before the state changes.
- There are no destructive irreversible board operations. “Delete token” is undoable.

### 3.5 Meaningful physical-inventory treatment

The session label reads **“Playing the 100-card list”** (the deck's actual size). The playtester always uses the full intended decklist — it never checks or reflects which copies are physically sleeved, and it must not move copies into the deck or prompt a user to alter their collection to playtest.

## 4. Architecture

### 4.1 Separate pure game state from React and from the database

Create a framework-free workspace package, recommended name `packages/playtest-core/`. It must not import Next.js, React, Supabase, or browser APIs.

Suggested layout:

```text
packages/playtest-core/src/
  types.ts          GameState, GameCard, Token, Zone, Counter, SessionMeta
  commands.ts       discriminated GameCommand union and command creators
  reduce.ts         applyCommand(state, command) -> state
  inverse.ts        inverse command construction / undo support
  selectors.ts      zone views, card lookup, legal UI affordances
  shuffle.ts        deterministic seeded shuffle and seed handling
  serialize.ts      versioned snapshot validation and migration
  fixtures.ts       representative 60-card / Commander starting states
```

Keep the existing `src/lib/playtest/` analytical functions in place initially. Extract only truly shared, framework-free logic after tests prove identical behaviour.

The React application layer should live under `src/components/playtester/`, with small components such as `PlayBoard`, `ZonePile`, `Hand`, `Battlefield`, `GameCard`, `CardMenu`, `GameControls`, `ActionLog`, and `SaveDialog`. Route-level loading and authorization stays in `src/app/(app)/decks/[id]/play/`.

### 4.2 State model

The persistent state should describe game objects and zones—not DOM positions or React component state.

```ts
type ZoneId =
  | "library"
  | "hand"
  | "battlefield"
  | "graveyard"
  | "exile"
  | "command"
  | "sideboard"
  | "temporary";

type GameCard = {
  id: string;                 // unique per game object, never just card_id
  kind: "deck-card" | "token" | "copy";
  cardId: string | null;      // Scryfall ID for real deck cards
  oracleId: string | null;
  name: string;
  imageUri: string | null;
  face: "front" | "back" | "face-down";
  tapped: boolean;
  rotation: 0 | 90 | 180 | 270;
  counters: Record<string, number>;
  note: string | null;
  copiedFromId: string | null;
};

type GameState = {
  schemaVersion: 1;
  deckId: string;
  seed: number;
  turn: number;
  life: number;
  commanderDamage: Record<string, number>;
  cards: Record<string, GameCard>;
  zones: Record<ZoneId, string[]>;
  battlefield: Array<{ cardId: string; groupId: string | null }>;
  log: GameLogEntry[];
};
```

Notes:

- A real deck card appears once per copy, even if many copies share a Scryfall ID. This is essential for correct shuffle, draw, and move semantics.
- A token/copy needs its own object ID and must never be inserted into the library source.
- `GameCard` stores the small display payload needed to reopen a saved board. It may refresh card details from the catalog later, but a saved state must remain viewable even if catalog data is temporarily unavailable.
- Treat on-board placement as a presentation layer at first. Add a serializable `layout` field only once the interaction prototype demonstrates that free positioning is necessary; never persist raw DOM geometry.

### 4.3 Commands and undo/redo

Every state-changing action is one discriminated command, e.g. `DRAW`, `MOVE_CARD`, `SET_TAPPED`, `SET_FACE`, `ADD_COUNTER`, `CREATE_TOKEN`, `DELETE_OBJECT`, `SHUFFLE`, `SET_LIFE`, `NEXT_TURN`, and `RESTORE_SNAPSHOT`.

Implement state changes through one reducer-like function. The UI never mutates `GameState` directly.

Use a bounded undo stack of command/state pairs (e.g. 200 operations) during an active session. The simplest correct v1 form is storing the immediately previous immutable state for each command; optimize to inverse commands only after profiling. Persist the current snapshot and concise human-readable log, not an unbounded browser history.

Shuffle must generate and store its seed or resulting order. A replayed saved session must not produce a different library from the same recorded action.

### 4.4 Starting a game

Build an adapter in the web app, e.g. `src/lib/playtest/game-start.ts`, which turns the selected deck source into `GameState`.

- Flatten `deck_cards` / `DeckListEntry[]` into one game object per listed copy — the full intended decklist, every time.
- Include a unique game object per generated copy.
- Move the configured commander out of the library and into the command zone. The tabletop is a decklist playtester, not a physical-inventory check.
- Generate a seed once per new game and use the shared seeded-shuffle primitive.
- The start adapter is pure and unit-tested. It receives all data; it does not query Supabase.

### 4.5 Client/server boundary

The route remains server-rendered for authentication and deck loading:

1. Validate that the deck belongs to the signed-in user using `getDeck()`.
2. Load `getDeckList()` once.
3. Convert only the required serializable deck data into the client `PlayBoard` props.
4. All live board interaction occurs locally in the browser. There is no request per draw, tap, or move.
5. Save/load occur through narrowly scoped server actions or route handlers authenticated as the current user.

Do not load a friend's public deck into the play board in v1. Public visibility intentionally exposes the desired list, not a player's play sessions; session access remains owner-only.

## 5. Persistence plan

### 5.1 v1 persistence requirements

- Browser-local crash recovery: serialize a dirty active session into `localStorage` or IndexedDB, namespaced by user and deck. Use IndexedDB if snapshot size or saved-state lists prove awkward.
- Account persistence: a user can deliberately save, rename, resume, overwrite, duplicate, and delete their own snapshots.
- The app must warn before discarding an unsaved dirty session and must never overwrite a remote snapshot silently.
- A saved snapshot is a game state, not a record of collection ownership at the time of every action.

### 5.2 Database migration shape

Add a new migration, not an edit to existing tables. Suggested v1 table:

```sql
create table public.playtest_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  deck_id uuid not null references public.locations(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 100),
  schema_version integer not null,
  source_fingerprint text not null,
  snapshot jsonb not null,
  preview jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Add an index on `(owner_user_id, deck_id, updated_at desc)`, the existing `set_updated_at` trigger, and owner-only select/insert/update/delete policies. `WITH CHECK` must require `owner_user_id = auth.uid()` and `deck_id` must be verified to reference a deck the same user owns. The migration must document why session state is isolated from card ownership and why a friend-readable deck does not imply session access.

`source_fingerprint` is a stable digest of the starting deck input. On resume, if the live deck changed, offer **Continue frozen state** or **Start from current deck**; never rewrite a saved board to reflect changed inventory behind the user's back.

Do not create an event-sourcing table in v1. It adds schema and privacy complexity without being necessary for undo, local recovery, or saved states. Add append-only session events later only if replay sharing or multi-user synchronization has a validated need.

### 5.3 Snapshot versioning

- `schema_version` is mandatory in both table data and serialized JSON.
- `deserializeSnapshot` must validate and migrate known old versions before the UI renders.
- Never trust arbitrary JSON from the database as `GameState` without validation.
- Add a fixture per snapshot version and a unit test for forward migration.

## 6. Delivery plan

The sequence is designed to prove tactile value before committing to real-time complexity or broad rules automation.

### Phase 0 — interaction prototype and decisions

**Outcome:** a non-persistent prototype can complete the core loop: open a sample deck, shuffle, draw/mulligan, play/tap/move cards, undo, and restart.

- Produce a clickable board layout at laptop and narrow-desktop widths.
- Decide whether the battlefield needs free positioning in v1 or whether drag-sortable rows/groups are sufficiently tactile.
- Test mouse, trackpad, keyboard, touch screen, light theme, dark theme, reduced motion, and 200% browser zoom.
- Run 3–5 observed sessions with actual decks. There is no usage data today; do not substitute opinions about imagined users for this validation.
- Exit criterion: players can finish a five-turn goldfish without instruction, and they can find undo, tap, move-to-zone, and token creation.

### Phase 1 — deterministic game core

**Outcome:** isolated, tested game state exists independently of UI.

- Create the game-state module (state types, command union, reducer, serializer, seeded shuffle, and fixtures) — see section 4.1 for where it lives.
- Add a pure web adapter from a deck's `deck_cards` list to game state.
- Implement library/hand/command zone, shuffle, draw, London mulligan, bottom selection, tap, movement, zones, life, and turn counter.
- Implement bounded undo/redo and readable action log.
- Add unit and property-style tests described in section 7.
- Exit criterion: same start input + seed + command sequence always yields the same state.

### Phase 2 — desktop tabletop

**Outcome:** the product is genuinely pleasant to goldfish in.

- Add `/decks/[id]/play` server route and `src/components/playtester/` board components.
- Add visual card rendering, hand fan, zone piles, battlefield arrangement, inspector, card menu, keyboard access, focus management, and responsive layout.
- Add common actions: counter names, face-down/transform state, copies, simple tokens, dice / generic counters, notes, reset.
- Update deck detail navigation to separate `Play` from `Analyze`; retain `/test` unchanged.
- Exit criterion: the Phase 0 user loop is polished with no modal confinement, no lost state during routine rerenders, and accessible fallback actions for every gesture.

### Phase 3 — snapshots and recovery

**Outcome:** an interesting game is durable.

- Add local dirty-session recovery and discard confirmation.
- Add the `playtest_sessions` migration, RLS tests, server actions, snapshot list, save-as, rename, duplicate, and delete.
- Add snapshot schema validation and version migration tests.
- Exit criterion: refresh/browser restart does not lose an active recovered session; saved sessions can be reopened under the same account; another account cannot read or mutate them.

### Phase 4 — quality bar

**Outcome:** the product earns its place beside established playtesters.

- Add contextual help / keyboard shortcut reference and a concise first-use coach mark.
- Improve card grouping, stack display, zone inspection, token styling, and recent-action log.
- Add performance instrumentation and error boundaries around snapshot recovery.
- Conduct another observed playtest round; prioritize interaction friction over adding mechanics.
- Exit criterion: a player can run a 20-minute goldfish without accumulating confusing UI state or needing to reload.

### Phase 5 — only after validation

Potential follow-ons, in this order:

1. Saved “puzzle” hand / board-state sharing as a read-only link with explicit privacy rules.
2. Tablet layout and a limited mobile companion (quick hand, life/turn controls, saved-state viewing).
3. Optional two-seat local board.
4. Real-time collaboration/spectating, with a dedicated authorization and synchronization design.

Do not start real-time multiplayer until single-player persistence, command replay, conflict strategy, session privacy, and the interaction model are proven.

## 7. Test and quality plan

### Core unit tests

- The deck-start adapter produces one unique object per copy and excludes the commander from the library.
- Full-decklist generation matches the deck list across duplicate quantities and commander removal.
- Every command changes only the intended cards/zones/counters.
- `apply(undo(command))` restores the immediately previous state for each supported action.
- Undo/redo round trips through a varied command sequence.
- Identical seed plus identical commands yields identical library order and game state.
- Token/copy deletion never alters deck-card counts or library contents.
- Snapshot validation rejects malformed, unknown, or cross-version state safely.

### Database tests

- A user can CRUD only their own sessions.
- A user cannot create a session against another user’s deck, including a friend-readable public deck.
- Deleting a deck cascades to its saved sessions, matching the proposed foreign key. Test that this behavior is deliberate and that it cannot affect another owner’s sessions.

### Component and end-to-end tests

- A keyboard-only player can draw, inspect, tap, move, undo, save, and restore a card.
- A pointer player can drag a hand card to the battlefield, tap it, move it to the graveyard, and undo.
- The board works in light/dark mode, reduced motion, 200% zoom, and narrow desktop viewport.
- Opening `/decks/[id]/play` never mutates `card_instances`, `deck_cards`, or locations.
- Browser reload recovers a local dirty session; a saved snapshot resumes deterministically.

### Performance budgets

- First interaction after the route is usable should not wait for pre-rendering every full-size card image.
- Draw, tap, move, and undo should feel immediate (<100 ms state response on a mid-range laptop).
- Avoid passing a full deck through a global React context that rerenders the entire board for one tapped card. Use memoized card components and selectors.
- Cap in-memory history and local recovery size; log and gracefully disable recovery if browser storage is unavailable.

## 8. Important product / technical decisions to make before coding

| Decision | Options | Recommendation |
| --- | --- | --- |
| Battlefield model | Free x/y canvas; drag-sortable rows/groups | Start with rows/groups unless prototype participants clearly need spatial freeform. It is much easier to make reliable and accessible. |
| First persistence | Local only; local plus saved account snapshots | Deliver local recovery in Phase 2/3 and account snapshots in Phase 3. Do not delay the tabletop for real-time infrastructure. |
| Public decks | Play friend lists; owner-only play | Owner-only in v1. Public deck access does not include physical contents or session rights. |
| Desktop/mobile priority | Build both; desktop first | Desktop first. Design mobile companion requirements separately after real sessions validate the table model. |
| Rules automation | Card parsing / rule engine; manual toolkit | Manual toolkit. Add only narrow convenience actions requested repeatedly in observed use. |

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Scope drifts into a full rules engine | Keep non-goals visible in planning and review; model actions, not Magic legality. |
| Board interactions are inaccessible | Define keyboard and menu equivalents alongside each pointer gesture, not after drag/drop ships. |
| Mutable UI state becomes impossible to undo | Route all changes through one serializable command system from the first prototype. |
| Saved sessions break after state changes | Version snapshots and test migrations before adding new state fields. |
| Large card images make the table sluggish | Use the existing small image fields for board cards; request full imagery only for inspection. |
| Real-time ambitions delay the useful product | Treat collaboration as a separate post-validation project with its own architecture review. |
| The tabletop feels generic | Keep deck identity and eventual packing context visible—but do not clutter play actions with inventory management. |

## 10. Definition of done for the first shippable release

A signed-in owner can open one of their decks at `/decks/[id]/play`, start a complete-decklist solo game, perform a London mulligan, and play several turns using a visual board. They can draw, shuffle, inspect, tap, move cards among the principal zones, make tokens, add counters/notes, track life/turn, undo/redo, restart, and save/resume a board state. The board is keyboard-accessible, works in dark/light mode and reduced motion, does not modify any physical collection data, and has automated coverage for deterministic start state, commands, undo/redo, snapshot validation, and session access isolation.

## 11. Suggested implementation checklist

- [ ] Validate the Phase 0 interaction prototype with real deck owners.
- [ ] Create and test `packages/playtest-core`.
- [ ] Implement tested deck-to-game-state adapter.
- [ ] Add the owner-only `/decks/[id]/play` route.
- [ ] Build library, opening hand, London mulligan, hand, battlefield, zones, and command zone.
- [ ] Implement command menus plus keyboard/pointer actions.
- [ ] Add undo/redo, action log, reset, and game controls.
- [ ] Separate `Play` and `Analyze` on deck detail without breaking `/test`.
- [ ] Implement local dirty-session recovery.
- [ ] Obtain architecture sign-off for the new session migration / RLS shape.
- [ ] Add persisted snapshots and session access tests.
- [ ] Run the full lint, typecheck, unit-test, and database-test suite before handoff.
