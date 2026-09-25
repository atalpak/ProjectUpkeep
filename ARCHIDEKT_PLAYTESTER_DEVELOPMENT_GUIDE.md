# Archidekt-style playtester: development guide for Project Upkeep

**Status:** requirements and delivery guide, 24 September 2026  
**Target:** the existing owner-only `/decks/[id]/play` experience  
**Interpretation of “replicate”:** reproduce the useful behavior and interaction model of Archidekt's solo playtester inside Project Upkeep. Use Project Upkeep's own visual language and data. Do not copy Archidekt's branding, interface art, or implementation.

## 1. Evidence and scope

I opened the supplied [Doom Prevails playtester](https://archidekt.com/playtester-v2/23394508) and exercised its opening hand, mulligan, hand and card menus, library search, secondary zones, counters, tokens, game log, settings, shortcut reference, dice menu, and interaction simulator. The official [Playtester 2.0 announcement](https://archidekt.com/news/3417345?page=1), [Playtester Logs announcement](https://archidekt.com/news/13186079?page=1), and [interaction simulator announcement](https://archidekt.com/news/26104256) confirm the intended behavior. Observations are from a Commander deck; format-specific extras such as Attractions and Planechase need a separate fixture. Exact hidden odds and backend behavior are not inferable from the UI, so the requirements below specify equivalent outcomes rather than Archidekt internals.

The existing [implementation plan](./PLAYTESTER_IMPLEMENTATION_PLAN.md) remains the product baseline: a manual, rules-light, single-player tabletop built from the complete intended `deck_cards` list. This guide adds a feature inventory, parity target, data/interaction contracts, and acceptance criteria. “P0” is a credible solo playtester; “P1” covers the richer controls visible in Archidekt; “P2” is full feature parity or format-specific work. A first release can ship at P0, but a claim of Archidekt-level parity requires P0–P2.

### Product boundaries

- The player decides which Magic actions are legal. The app manipulates objects and tracks state; it does not resolve oracle text, priority, combat, or triggers.
- The board starts from the intended decklist, whether or not the physical cards are sleeved. Playing never mutates `deck_cards`, `card_instances`, `locations`, or ownership.
- Every physical deck card is a distinct game object, even when multiple copies share a catalog card ID.
- Routine board interaction is local and immediate. Network requests load deck/catalog data and explicitly save/load sessions.
- Do not make pointer gestures the sole way to perform an action. Every action needs a visible/menu and keyboard-accessible path.

## 2. What the reference experience contains

| Surface | Observed behavior | Target |
| --- | --- | --- |
| Opening hand | Seven-card fan; Keep, Mulligan, drag targets for bottom of library and exile; optional draw/stack deck; simulator toggle. Official release describes London mulligans and free mulligans. | P0 for London flow; P1 for extra controls |
| Main table | Open battlefield, lower hand, library/graveyard piles, collapsible exile/command zone, bottom toolbar. | P0 |
| Hand | Click-to-play or options-click mode; scroll/fan, full-hand overlay, hide, order, random discard, move all. | P0 core; P1 advanced |
| Library | Draw/Draw X, move top/all, search, shuffle, random draw, reveal, peek top/bottom X, mill X. Search has “shuffle on close.” | P0 draw/search/shuffle; P1 remainder |
| Cards in play | Tap, move, transform/face down, rotate 180°, dim, notes, counters, power/toughness offsets, token copy, delete. | P0 move/tap/counters/copy; P1 flags/offsets |
| Battlefield selection | Free placement and drag grouping; multi-select, group arrangements, group actions, selected power/toughness totals. | P1 |
| Tokens and extras | Deck-relevant token choices, all-tokens view, broader token search, add card from global search, custom card form. | P0 custom token; P1 catalog/search |
| Trackers | Turn, two life values, poison, experience, mana pool, energy, other damage/commander damage. | P0 turn/life; P1 full tracker set |
| Utilities | Untap all, next turn = untap + draw, proliferate all counters, dice/coin, undo/redo, keyboard shortcuts. | P0 undo/turn; P1 rest |
| Logs | Turn-grouped moves and charts for mana producers, drawn/milled cards, mana value played, and power in play; filters; full/compact exports. | P1 |
| Settings | Card/hand sizes, hand behavior, labels, foil, widgets, upkeep reminder, theme, sleeve/playmat colors, save/restore. | P1 |
| Share | A public-safe mirrored/popout view with confidential hand information hidden; hand may be deliberately shown. | P2 |
| Interaction simulator | Optional Commander opponent prompts after configured turns; archetype presets and per-category chances; player resolves them manually. | P2 |

The supplied deck showed 99 library cards plus one commander before the seven-card hand; afterward it showed 92 library cards and one card in the command zone. This is the expected Commander partition, not a hard-coded deck size.

## 3. Functional requirements

### 3.1 Entry, start, and mulligan

1. The deck page offers a prominent **Play** action and preserves the existing **Analyze**/`/test` experience. Only the owner may open their play route in the initial release.
2. Load deck entries and chosen printings once, flatten quantities, place configured commanders/partners in the command zone, and shuffle the remainder with a recorded seed. Reject an empty or malformed list with an actionable message.
3. A new game starts at turn 0, with format-appropriate life (40 for Commander, 20 for ordinary constructed unless the user changes it). Offer a game format/start configuration rather than inferring every rule from deck size.
4. Draw seven or the remaining library size and present an opening-hand overlay. **Keep** ends mulliganing. **Mulligan** returns the complete hand, reshuffles, and draws seven. On keeping after *n* paid mulligans, the user chooses exactly *n* cards to bottom in their chosen order. Offer a Commander free-mulligan policy as a format option; do not silently assume all mulligans are free.
5. The overlay exposes usable card inspection and explicit bottom-selection controls for keyboard/touch users. “Draw” and “stack deck” are P1 conveniences, separate from the mulligan count.
6. Restart requires a confirmation when the current game is dirty. A saved session may be resumed without regenerating its library order.

### 3.2 Zones and library order

Required zones are **library, hand, battlefield, graveyard, exile, command**, with optional **sideboard**, **temporary/stack**, and format-specific out-of-deck zones. Each card belongs to exactly one zone. Tokens and extra cards are game objects, not mutations to the source deck.

- Library order is explicit and stable; index 0 is the top. Support top/bottom insertion, an exact insertion index, search, reorder, reveal, random draw, shuffle, draw N, mill N, and peek top/bottom N. A library search can shuffle on close by default, but the player can turn that off.
- Hidden information stays hidden until the player intentionally peeks/searches/reveals. When sharing a board, the library order and private hand must not leak through serialized public state.
- Graveyard, exile, command, and other zones show counts and searchable card overlays. Cards can move between any supported zones via the card menu. Empty zones remain discoverable.
- Every multi-card operation checks bounds and commits as one undo step. Drawing from an empty library must not duplicate cards or crash.
- Search/peek overlays can remain open while dragging cards if the user opts in. Closing a search resolves its shuffle choice once.

### 3.3 Hand and battlefield

- Hand cards are image-first, readable on hover/focus, and can be reordered. A full-hand overlay supports large hands. Offer random discard, ordered sorting by name/type/color/mana value, hide/show hand, and move-all controls. Sorting the hand must not change library order.
- A hand card can be played by the chosen click mode, dragged onto the battlefield, or moved through an action menu. Support **play tapped** and **play face down**. A played card retains its unique game-object ID and notes.
- Battlefield cards can be freely arranged or placed into stable groups/stacks. If free positioning is used, persist normalized board coordinates and z-order, not DOM pixels; account for resize and zoom. Grouping/ungrouping and at least horizontal/vertical arrangements require both pointer and menu paths.
- Support single and multi-selection, area select, tap/untap selected, move selected, and selected-card count plus total displayed power/toughness. Multi-card commands are atomic and undoable.
- Card state includes tapped, printed face/transformed face, face down, 180° orientation, dimmed/phased visual state, revealed state where relevant, named counters, power/toughness offsets, commander tax, and notes. These are **visual/manual annotations**, not automatic Magic effects.
- Card menus adapt to zone: hand has Play/Play as/Move; battlefield has Tap/Move/Card actions/Counters/P–T/Notes/Copy/Delete; zone cards have relevant move/reveal/reorder controls. A card's full printing and oracle text remain accessible without relying on hover.
- “Delete from game” is reserved for temporary extra cards or is clearly distinguished from moving an original deck card to a zone. It must be undoable. Token copies get new IDs and point to their source.

### 3.4 Tokens, extra cards, and counters

- **P0:** create a custom token with name, type, power/toughness, count, optional image, and a new object ID per copy. Add/remove named counters, including custom names.
- **P1:** derive a token palette from tokens referenced by the deck, show their official names/art when available, offer global token search, create a token copy of a permanent, add a catalog card from global search, and create a custom non-token card (name, type line, power, toughness).
- Provide common presets (+1/+1, −1/−1, loyalty, time, charge, lore, shield, generic, keyword markers) and a searchable all-counters chooser. Counter labels are display metadata; custom counters need no rules semantics.
- Distinguish counters from temporary P/T offsets. **Proliferate all** increments existing counters according to the player's chosen policy; it does not invent new counter types.

### 3.5 Turn and player utilities

- Track turn number, primary/secondary life, poison, experience, energy, mana pool by color/colorless, commander damage by opposing commander, and optional generic damage. All editable values accept direct entry as well as increment/decrement controls.
- **Next turn** increments turn, untaps appropriate battlefield cards, and draws according to selected format/first-turn policy. It does not auto-resolve upkeep triggers. An optional upkeep reminder appears before draw.
- Offer tap all, untap all, coin flip, d4/d6/d8/d10/d12/d20, and a visible random result. If random outcomes affect a saved game/log, record the result rather than only the generator seed.
- Undo/redo must cover state-changing play actions, including shuffle, mulligan, group actions, counters, life, and turn. A bounded recent action history is sufficient; redo clears after a new command. Do not make animations or network latency block state updates.

### 3.6 Logs and metrics

- Record turn-stamped, human-readable moves and state changes. Store structured event data separately from display text so metrics can be recalculated and export formats can change.
- Display turn-grouped moves; allow correction/removal of an erroneous log entry without silently changing the current board. Show a warning if the log no longer represents board state.
- Charts cover cards drawn/milled, mana-producing permanents, played mana value, and power in play. Filters include card type and deck category where data exists. A chart must state its counting convention (for example, “played mana value” is based on moves to battlefield/stack, not a claim about mana paid).
- Export a compact readable log and a versioned full JSON log, with copy and download actions. Exported logs must omit hidden information when intended for sharing.

### 3.7 Optional opponent interaction simulator (P2)

This is a **prompt generator**, not an opponent rules engine. The official announcement says it may suggest attacks, removal, counterspells, and other pressure at the end of a turn; the player chooses targets and resolves any board changes manually.

- Enable/disable in the opening-hand flow or game menu. Set the first interaction turn and a per-turn maximum (the current UI offers 1–3).
- Configure relative chance levels, including **off**, for counterspells, spot removal, mass removal, attacks, stax, discard, and no interaction. Add an optional mill-opponent mode and a game-changer toggle. Offer named archetype presets and editable custom settings.
- Use a recorded random seed/result per turn so undo, reload, and exported logs remain understandable. Present the generated prompt in an interaction log before advancing the turn. “No interaction” is a valid result.
- Never auto-target or auto-move cards from a prompt. Provide **ignore**, **resolve manually**, and **reroll** (with a recorded reason/result) controls to avoid nonsensical prompts. Keep simulator state separate from game-object state.

### 3.8 Settings, sharing, and accessibility

- Persist user preferences separately from a game snapshot: card/hand size, auto sizing, hand curve/hover/scroll behavior, max visible hand cards, labels, counter placement, reduced motion, theme, sleeve/playmat colors, and optional widgets.
- Provide a discoverable shortcut sheet. Match platform modifiers; avoid intercepting shortcuts while an editable field is focused. The reference includes draw, shuffle, search, new game, undo/redo, next turn, tap/untap, zone moves, peek top N, quick-play hand positions, inspect, and selection/group shortcuts.
- Support action-click and option-click modes, right-click/long-press context menu, touch-friendly menu buttons, drag/drop, and keyboard move. Focus returns predictably after closing menus/dialogs. Card images have names/alt text; counters and tap state are announced as text.
- Test 200% zoom, narrow desktop, touch, light/dark themes, high contrast, and reduced motion. Settings that visually hide a hand must not make it inaccessible to its owner.
- A shared/popout view needs an explicit privacy model: default to battlefield and public zones only. Hand exposure is an affirmative action. Do not expose session write access or raw hidden library order through a share URL.

## 4. Architecture for this repository

### 4.1 Reuse existing foundations

The current route at `src/app/(app)/decks/[id]/play/page.tsx` loads an owner deck and the intended list. The pure game core is already under `src/lib/playtest/board/` (not the previously proposed separate package), and the board UI is under `src/components/playtester/`. Keep this structure unless an actual cross-app consumer justifies extraction. The existing `/decks/[id]/test` analyzer remains separate.

The present board already has seeded startup, distinct game-object IDs, library/hand/command/battlefield/graveyard/exile, a basic London-bottom selection, draw/shuffle, tap/move, custom tokens, counters, notes, undo/redo, a simple action log, and life/turn controls. Its battlefield uses rows/groups rather than Archidekt's spatial canvas. There is **no evidence in the current code of account snapshot storage, local crash recovery, full library manipulation, metrics/export, the full tracker set, settings, sharing, or the interaction simulator**. Treat this guide as an extension of that implementation, not as instructions to start over.

### 4.2 State and command contracts

Extend the existing `GameState`/`GameCard` carefully instead of adding parallel sources of truth:

| Entity | Required information |
| --- | --- |
| Game session | schema version, deck ID/source fingerprint, format/start policy, starting seed, turn/phase note, players' trackers, ordered zones, objects, simulator settings/results, log |
| Game object | unique instance ID, origin (`deck-card`, `token`, `copy`, `extra`), catalog/printing IDs, display fallback, zone, visibility/face, tap/orientation/dim, counters, P/T offsets, note, copy source, group/layout |
| Ordered zone | ordered object IDs; top-of-library convention; public/private visibility; optional out-of-deck zone kind |
| Board layout | normalized position, stack/group ID, within-group order, z-order; presentation independent of DOM size |
| Event | command ID, turn, timestamp/order, actor, affected object IDs, before/after summary, random outcome if any |

Keep object IDs stable across moves. Enforce these invariants after every reducer command and after deserialization: each non-deleted object appears in exactly one zone; no zone references a missing object; no duplicate IDs in a zone; library order is deterministic; counters/trackers are finite integers within sensible bounds; token/copy creation never changes the deck source. New commands should include `MOVE_MANY`, `REORDER_ZONE`, `PEEK/REVEAL`, `SET_CARD_FLAGS`, `SET_TRACKER`, `SET_LAYOUT`, `SET_GROUP`, `CREATE_EXTRA`, `PROLIFERATE`, and `RECORD_INTERACTION` as needed. One user gesture yields one history entry.

### 4.3 Persistence and security

- Use a versioned, validated snapshot with a deck-source fingerprint. On resume after deck edits, offer **Continue saved state** or **Start with current deck**. Never mutate the saved board to match a changed list.
- Add browser-local recovery per user/deck, throttled after commands, with a storage failure path. Account saves use a new migration and owner-only RLS, as specified in the existing plan. Support save, overwrite, save as, rename, duplicate, restore, and delete.
- Server handlers authorize the owner and cap snapshot size. Validate all JSON at the boundary and migrate known old versions. Never trust a deck ID or owner ID from the client.
- Sharing is a separate, explicitly public projection. It must redact hand, private search/peek results, library order, and unrevealed face information. Do not reuse the owner snapshot as the public payload.
- Card images/oracle text come from the existing catalog/Scryfall pipeline, with a fallback display payload in the snapshot. Review image/data usage terms before shipping public sharing or cached exports.

## 5. Delivery sequence and acceptance tests

| Milestone | Work | Exit test |
| --- | --- | --- |
| M0: parity audit | Compare current board to this guide; settle format policy, spatial board versus rows, and save scope. | Decisions recorded; no duplicate state representation. |
| M1: reliable solo loop | Correct mulligan, ordered library operations, full zone movement, fast card inspect, keyboard/touch actions, clear undo semantics. | Complete five-turn Commander goldfish with mulligan, tutor, graveyard return, token, counter, undo, and restart without losing/duplicating an object. |
| M2: durable game | Local recovery, versioned account snapshots, owner-only RLS, deck fingerprint handling. | Refresh and browser restart recover state; another account cannot read/write a session. |
| M3: tactile parity | Spatial layout or validated group model, multi-select, card flags, token catalog/search, complete trackers, settings and dice. | A 20-minute session remains readable and responsive at normal laptop width and 200% zoom. |
| M4: insight and sharing | Structured log, charts, export, redacted popout/share projection. | Metrics match a known command fixture; public view reveals no private hand/library data. |
| M5: simulator and extras | Configurable manual opponent prompts and format-specific zones. | Same seed/settings/turn yields the same prompt; undo/reload does not reroll; player can ignore or resolve it manually. |

### Automated checks

- **Core:** duplicate printings remain distinct; command sequence plus seed is deterministic; draw/search/shuffle/peek preserve card count; multi-card commands undo atomically; save/load round-trips layout, counters, hidden state, and simulator results.
- **Format:** Commander/partner cards start outside the library; seven-card London flow bottoms exactly the required count; turn-zero draw respects the selected format; non-Commander decks start with correct life/library rules.
- **Security:** RLS prevents cross-owner CRUD; a public deck does not imply session access; share payloads contain no hand IDs, unrevealed card identities, or library ordering.
- **UI:** mouse, touch, and keyboard can each draw, play, tap, move, inspect, create token, add counter, undo, and save; menus trap/restore focus appropriately; long hands and large zones remain usable.
- **Performance:** common actions respond within 100 ms on a mid-range laptop, full-size images load only on inspection, and a 100-card deck does not cause whole-board rerenders for one tapped card.

## 6. Decisions that must be explicit before claiming parity

1. **Battlefield layout:** the current grouped-row board is simpler and accessible, but it does not replicate Archidekt's free placement. Validate with users whether rows are sufficient for Project Upkeep's purpose; if “replicate” means interaction parity, implement normalized free placement and grouping.
2. **Persistence:** Archidekt exposes save/restore in settings. Project Upkeep's existing plan calls for both local recovery and account snapshots. The latter is the clearer product contract for resuming across devices.
3. **Formats:** the supplied link proves Commander behavior. Determine which other formats and special decks Project Upkeep supports before generalizing starting life, commander partition, first-turn draw, sideboard, Attractions, Planechase, or similar zones.
4. **Simulated opposition:** the new feature is current and optional. Its precise weights are not public; implement documented, testable probabilities and label them as Project Upkeep's settings.
5. **Visual identity:** prioritize legibility, speed, and equivalent workflows. Reuse Project Upkeep components and catalog imagery; do not recreate Archidekt's exact visual assets.

## 7. Definition of done

**P0 complete:** an owner can open a full intended deck, perform an accurate mulligan, draw/search/shuffle, play and move distinct cards among core zones, tap, create tokens/counters, track life/turn, undo/redo, and complete a several-turn goldfish with mouse, touch, or keyboard.

**Practical Archidekt parity:** add the P1 manipulation, tracker, token, layout, settings, log, metrics, export, and persistence requirements. **Full parity:** also add P2 redacted sharing, simulator, and applicable special zones. Every tier preserves deck/collection isolation and deterministic, validated saved state.
