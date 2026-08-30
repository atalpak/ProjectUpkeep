# MTGManager — Data Model (First Pass)

**Status:** Draft for review. Treat as a starting point for Phase 0 conversations, not a final schema — location granularity in particular (Locations section) should flex based on interview findings before Claude Code builds against this.

---

## Entities

### `users`
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| username | text, unique | |
| email | text, unique | |
| created_at | timestamp | |

### `cards`
Synced from Scryfall's bulk data (not user-editable). One row per *printing* (a specific set/collector-number combo), not per card name — "Lightning Bolt" from three different sets is three rows.

| field | type | notes |
|---|---|---|
| scryfall_id | uuid, PK | Scryfall's own ID — use directly, don't invent your own |
| name | text | |
| set_code | text | |
| collector_number | text | |
| image_uri | text | from Scryfall, cached/served, not re-hosted |
| available_finishes | text[] | e.g. `{nonfoil, foil, etched}` — from Scryfall's data |
| lang | text | Scryfall tracks language per printing |
| last_synced_at | timestamp | for your sync job's own bookkeeping |

### `locations`
User-defined containers. This is the part Phase 0 should sharpen — below is a flexible starting shape.

| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| user_id | uuid, FK → users | |
| name | text | e.g. "Commander Binder", "Box 3" |
| type | enum | `deck`, `binder`, `box`, `other` — keep it loose, don't over-model prematurely |
| parent_location_id | uuid, FK → locations, nullable | allows one level of nesting (e.g. "Page 4" inside "Binder A") — don't build deep nesting until interviews confirm people want it |

### `card_instances`
The actual owned copies. This is the table that makes the app an *inventory* system, not just a checklist.

| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| owner_user_id | uuid, FK → users | |
| card_id | uuid, FK → cards.scryfall_id | which printing |
| location_id | uuid, FK → locations, nullable | nullable = "unsorted," a real and expected state |
| condition | enum | `NM`, `LP`, `MP`, `HP`, `DMG` |
| finish | enum | `nonfoil`, `foil`, `etched`, etc. — constrained by `cards.available_finishes` |
| quantity | integer | for stacks of identical copies (same card/condition/finish/location) — avoids row-per-card bloat for bulk commons |
| acquired_at | timestamp | |

### `trades`
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| proposer_id | uuid, FK → users | |
| recipient_id | uuid, FK → users | |
| status | enum | `proposed`, `countered`, `accepted`, `declined`, `completed`, `cancelled` |
| created_at | timestamp | |
| updated_at | timestamp | |

### `trade_items`
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| trade_id | uuid, FK → trades | |
| card_instance_id | uuid, FK → card_instances | |
| direction | enum | `from_proposer`, `from_recipient` |
| quantity | integer | supports trading part of a stacked instance |

### `ownership_history` (audit log)
Immutable log, never updated after insert. This is what makes the transfer trustworthy and debuggable — every question 12 answer in the interview script ("what would make you not trust this") likely traces back to needing this table.

| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| card_instance_id | uuid | |
| from_user_id | uuid, nullable | null = newly created instance |
| to_user_id | uuid | |
| trade_id | uuid, FK → trades, nullable | null = manual add/edit, not a trade |
| transferred_at | timestamp | |

---

## The critical transaction: trade completion

This is the piece flagged in the charter as the hardest engineering work — it needs to be its own focused Claude Code session, not an afterthought bolted onto general CRUD.

On `trades.status → completed`, in a single database transaction:
1. For every `trade_item`, flip the corresponding `card_instances.owner_user_id` to the receiving party.
2. Set `card_instances.location_id` to `null` on the receiving side (received cards land "unsorted" — the recipient files them away, we don't guess where they'll put them).
3. Insert one `ownership_history` row per transferred instance.
4. If *any* step fails, the whole transaction rolls back — no partial trades, ever.

Open question for Claude Code to resolve technically: how to handle a `card_instances` row with `quantity > 1` where only part of the stack trades (e.g. trading 3 of 5 copies) — likely needs a split-then-transfer approach rather than transferring the row directly.

---

## What Phase 0 should sharpen before this gets built

- Does `locations.parent_location_id` (one level of nesting) match what people actually do, or do they want flat locations, or deeper nesting?
- Is "unsorted" on trade receipt the right default, or do people want to pre-assign a "where new trades land" location?
- Does `quantity` on `card_instances` (stacking identical copies) match how people think about bulk commons, or does everyone want true 1-row-per-physical-card even for commons?
