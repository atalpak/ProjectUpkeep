# Mort Animation Asset Brief

Instructions for producing Mort mascot art/animation with an external AI
animation tool, so the output drops into Project Upkeep's existing mascot
architecture with no code changes on the receiving end.

Companion references: `project_upkeep_brand_mort_developer_handoff.md` and
`Brand Bible v0.2.png` (the full character/brand spec this brief distills).

---

## 1. Why filenames matter

Both platforms already have a semantic reaction API wired up:
- `apps/mobile/src/mort/controller.ts` (mobile scanner)
- `src/components/mort/controller.ts` (web)

`loadPoseAsset(reaction)` currently returns `null` on both, and `MortStage`
renders a placeholder circle in the meantime. Once real files exist, someone
wires `loadPoseAsset` to load them — **the state names below must match
exactly** so that wiring is a drop-in swap, not a rename exercise.

## 2. The state list

Union of both platforms' states (mobile's scanner uses a subset; web uses the
fuller set from the brand doc's suggested state model, §20):

| State name | Used on | What it depicts |
|---|---|---|
| `idle` | both | Neutral, suspicious-irritated default. Breathing/blink. |
| `look` | both | Eyes snap toward something (a card entering frame). |
| `scan` | mobile only | Inspecting a card — no fixed duration, loops until a result lands. |
| `scan_success` | mobile | Recognition → smug. |
| `scan_uncertain` | mobile | Squint → confused/annoyed. |
| `file` | both | Card placed into the stack, small satisfied beat. |
| `annoyed` | both | Generic irritation (reserved — not yet wired to a trigger). |
| `duplicate` | web | Sees a repeat, unimpressed. |
| `missing` | web | Checks a box/stack, finds nothing. |
| `deck_complete` | web | Final card placed, arms-crossed satisfaction. |
| `trade_match` | web | Eyes light up at an opportunity. |
| `trade_complete` | web | Reluctantly hands a card over. |
| `celebrate` | web | Rare, bigger payoff — milestone. |
| `sleep` | web | AFK/empty-state idle. |

### Priority order

Build in this order — matches the brand doc's own phasing (§35 "Phase 1 —
Foundation"), so nothing is blocked waiting on the full set:

1. `idle`, `scan`, `scan_success`, `scan_uncertain`, `file` (mobile's Phase 1 — ship this batch first)
2. Everything else, any order

## 3. Keeping Mort on-model

Feed the animation tool these constraints — a generative tool drifts fast
without them:

- **Proportions:** oversized head, relatively short pointed ears, compact
  body, slight hunch, large hands, short legs, slightly oversized feet. Head
  stays the dominant part of the silhouette.
- **Face:** heavy brow, deep-set yellow/amber eyes, large nose, pronounced
  lower jaw, uneven lower teeth. Strong eye/brow expression.
- **Default expression:** suspicious irritation, even when "happy" — happy
  reads as smug, not cute. See the brand doc's emotion-interpretation table
  (§5 "Positive emotion rule") for the full mapping (excited → greedy grin,
  proud → arms crossed, curious → suspicious squint, etc.).
- **Style descriptor:** "Modern Goblin" — Japanese mascot simplicity, modern
  indie-game character design, light vintage-fantasy influence. Simple
  shapes, minimal shading, no fine texture (no clothing seams, buckles,
  wrinkles, realistic rendering) — legible at small sizes.
- **Explicitly NOT:** cute, kawaii, chibi, anime, childish, hyperactive, a
  generic fantasy NPC, or a direct imitation of Magic: The Gathering artwork.
- **Palette — character only:** Mort Green `#BB9B5A`, Deep Moss `#5A6B3F`.
  These are the *only* colors Mort himself should carry. Nothing in his art
  should reach for the app's chrome colors (Ochre `#C9A34A`, Ink `#1F1F1F`,
  Parchment `#F5EDE0`, Leather `#6B4E3D`) — those belong to the product UI,
  not the character.

## 4. Technical specs

- **Canvas:** square 1:1, generate at a large master size (1024×1024). Both
  platforms' `MortStage` components downscale from one source — no need to
  produce multiple resolutions.
- **Background:** transparent, if the tool supports it. If it doesn't (most
  generative video tools don't do alpha well), generate on a **flat magenta
  `#FF00FF`** background instead — not green, since that's Mort's own color
  and would get chroma-keyed along with him. This can be keyed out losslessly
  afterward.
- **Minimum deliverable per state (Phase 1): one static pose**, transparent
  PNG. This alone replaces every placeholder circle today — no motion
  required to be useful.
- **Stretch deliverable per state: a short loop.**
  - `idle`: a 2-frame blink (open/closed eye). The interval between blinks is
    randomized in code (brand doc §15A: "avoid a conspicuous perfectly
    repeating loop") — just provide the two frames.
  - Reaction states: a 1–3 second animated clip. Durations already coded:
    - `look` / `scan_success` / `annoyed` ≈ 0.7–0.9s
    - `scan_uncertain` / `duplicate` / `trade_match` ≈ 0.9s
    - `file` ≈ 0.8–0.9s
    - `celebrate` ≈ 2.4s
  - If the tool exports video, MP4/WebM is fine — it gets converted on
    receipt to whatever the embed needs (PNG sequence or a short muted loop).
- **Naming:** `mort_<state>.png` for stills (e.g. `mort_scan_success.png`),
  `mort_<state>.mp4` or a numbered `mort_idle_01.png` / `mort_idle_02.png`
  frame pair for the blink. **Never name an asset after a screen location**
  (brand doc §32 explicitly warns against names like `dashboard_goblin_2` —
  the point of the semantic system is that one `mort_file` asset gets reused
  everywhere a "filed" event fires, not duplicated per screen).

## 5. Handoff

Send the files once even the Phase-1 static set exists (`idle`, `scan`,
`scan_success`, `scan_uncertain`, `file`) — don't wait for the full list.
They get dropped into:

- `apps/mobile/src/mort/assets/` (mobile — bundled via `require()`)
- `public/mort/` (web — served as static files, referenced by path since
  `next/image` needs a public-relative string src, not a component import)

...and `loadPoseAsset` (in each platform's `src/**/mort/controller.ts`) gets
wired to load them. No further code changes should be needed on the
receiving end.
