# docs/

Long-form planning and handoff material. Application facts live in
[`../CLAUDE.md`](../CLAUDE.md); how the agent team works is in
[`../.claude/ORGANIZATION.md`](../.claude/ORGANIZATION.md); mobile specifics are in
[`../.claude/rules/mobile.md`](../.claude/rules/mobile.md) and `../apps/mobile/docs/`.

| Folder | What belongs here | Files |
|---|---|---|
| `guides/` | Historical specs and implementation plans written before/during a feature. Evidence, not current behavior. | `SCRYFALL_SEARCH_DEVELOPMENT_GUIDE` (built), `ARCHIDEKT_PLAYTESTER_DEVELOPMENT_GUIDE` and `PLAYTESTER_IMPLEMENTATION_PLAN` (implementation merged; see handoff for verification gaps), `FITS_THIS_DECK_DEVELOPMENT_GUIDE` (not built) |
| `handoffs/` | Current status and verification notes; update with evidence. | `SEARCH_HANDOFF` (shipped), `PLAYTESTER_BUILD_HANDOFF` (implementation merged; verification/release evidence remains; CI run 36267379039 succeeded, migration-drift found no local migrations missing after PR #102), `PLAYTESTER_ARCHITECT_MAP` (historical decisions) |
| `briefs/` | Work briefs for a specific pass, not roadmaps. | `MOBILE_UI_REFINEMENT_BRIEF`, `MORT_ASSET_BRIEF` |

Pre-rebuild planning is in `../archive/`.
