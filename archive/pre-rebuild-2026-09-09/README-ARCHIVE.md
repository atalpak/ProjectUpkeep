# Pre-rebuild archive — 2026-09-09

Everything here was the project's instruction and planning material before the
agent-infrastructure rebuild on 2026-09-09. **Nothing here is current. Nothing
here is a to-do list.** It is kept as evidence, not as direction.

Read it the way a new owner reads the previous owner's filing cabinet: useful
for understanding what was tried, what was measured, and what was decided on
purpose — but with no authority over what happens next.

| File | What it was | Why it was archived |
|---|---|---|
| `CLAUDE.md` | 11 bytes, containing only `@AGENTS.md` | Carried no project information at all. Replaced by a real `CLAUDE.md` at the repo root. |
| `PRIORITIES.md` | 685-line working roadmap, last edited 2026-09-08 | The owner asked for a fresh, evidence-led assessment instead of continuing from his own prioritisation. Archived on 2026-09-09 at his direction. |
| `README.md` | Snapshot taken before the directory map was corrected | Kept so the correction is auditable. The live `README.md` at the repo root supersedes it. |

## What is genuinely worth mining from `PRIORITIES.md`

The roadmap opinions are superseded. The **findings** are not — these are facts
about the system that were paid for with real debugging time:

- A 100-card deck silently grew to 114 rows. `deck_cards` is both the intended
  list and the record of what is physically filed, and the two sync
  asymmetrically (automatic on add, manual on remove). See migration 20's header.
  The invariant test for this was still unwritten as of archiving.
- Collection export silently truncated to 50 rows, because the export route
  never passed `paginate: false`. Fixed 2026-09-07.
- Bulk actions failed above ~500 selected rows: Supabase encodes `.in()` filters
  into the request URL and it exceeded the gateway length limit. Now chunked
  into batches of 200.
- `trade_items.card_instance_id` was `ON DELETE RESTRICT`, so any card that had
  ever appeared in any trade could never be deleted or moved. Fixed by
  migration 25.
- Moving collection filtering and pagination into SQL cut page weight on a
  688-entry collection from 1,743KB to 340KB. `getCollection` still fetches up
  to `MAX_ROWS` and filters the remainder in memory — a hard ceiling on
  serviceable collection size.
- Standing product decisions that were deliberate, not accidental: trading stays
  free; no deck editor; no marketplace or valuation engine; prices are a
  display-only Scryfall estimate.

## Restoring anything

```bash
git log --follow -- archive/pre-rebuild-2026-09-09/PRIORITIES.md
```

Full history follows the file through the move; `git mv` was used.
