# Mobile Interface Refinement Brief

## Objective

Refine the Project Upkeep mobile interface so it feels polished, cohesive, and intentionally branded without redesigning the product from scratch.

The existing visual direction is strong. Preserve the parchment-and-ink palette, Cinzel display type, Plus Jakarta Sans body type, ochre accent, card artwork, dark theme, and prominent Scan action. The work should focus on navigation consistency, hierarchy, density, and interaction polish.

## Priority 1: Create one unified Mort-centered header

Replace the current mixture of the branded app header and React Navigation's native detail headers with a single header system used throughout the signed-in application.

### Layout

Use three fixed regions:

```text
[ Back / reserved space ]       [ Mort ]       [ Menu ]
```

- The left and right regions must each be 44 points wide so Mort remains geometrically centered.
- On root screens, leave the left region empty but preserve its width.
- On nested/detail screens, show a standard back chevron in the left region.
- Keep the menu button and unread-notification badge in the right region.
- Use a total header height of approximately 56–60 points, excluding the safe-area inset.
- Keep every interactive target at least 44 × 44 points.
- The header should normally use the page canvas color. A subtle divider may appear once content scrolls beneath it.
- The full-screen live scanner may retain its purpose-built dark camera header.

### Mort treatment

- Display a tightly cropped head-and-shoulders Mort at approximately 40–44 points.
- Use the existing idle asset and crop it at runtime unless a dedicated semantic Mort asset is later produced.
- Mort must remain readable in both light and dark themes. A restrained `accent.soft` medallion or halo is acceptable if needed for contrast.
- Do not show most of Mort's body at this size. The current 36-point crop reads as a small speck, particularly in dark mode.
- Treat Mort as a decorative brand anchor by default. Do not add an obscure navigation action to him. If Mort becomes interactive, give him a clear accessibility label and a predictable action.
- Continue hiding decorative Mort artwork from screen readers.

### Page titles

Mort replaces the current title in the center of the header.

- Move root-page titles into the content area immediately below the header.
- Use the existing display typography at approximately 26–28 points.
- Detail screens may use their existing hero/banner title when it already supplies sufficient hierarchy.
- Avoid displaying the same title both in the header and again immediately below it.

### Navigation integration

- Disable the native headers currently enabled for deck, location, friend, and trade detail routes.
- Make the unified header aware of the active nested route and whether it can navigate back.
- Preserve native back gestures even though the visible header is custom.
- Remove the current double-header condition in which the branded page header appears above a second native back bar.
- Verify the system on Deck Detail, Location Detail, Friend Profile, Trade Detail, and Trade Builder.

Relevant files:

- `apps/mobile/src/components/AppHeader.tsx`
- `apps/mobile/App.tsx`
- `apps/mobile/src/navigation.ts`

### Acceptance criteria

- Mort is visually centered regardless of whether the back button is present.
- Every signed-in non-camera screen uses the same header language.
- No screen shows both the branded header and a native navigation header.
- Back buttons and swipe-back gestures work on every nested route.
- Page titles remain immediately understandable after being moved into the content area.
- Mort remains legible in light and dark modes at supported phone widths.

## Priority 2: Simplify the Settings screen

The Navigation Bar section currently repeats all available destinations four times. It dominates the page and creates unnecessary visual and cognitive load.

### Recommended interaction

- Show a compact preview of the five navigation positions.
- Keep Scan fixed in the middle.
- Let the user tap one of the four configurable positions to open a concise picker or bottom sheet.
- Show the currently selected destination directly in each position.
- Prevent duplicate selections or explain how duplicates are handled.
- Replace labels such as “First tab,” “Second tab,” “Fourth tab,” and “Fifth tab” with spatial names or the visual preview itself. If labels are needed, prefer “Left 1,” “Left 2,” “Right 1,” and “Right 2.”
- Keep “Reset to default” available but visually secondary.

Continue grouping Appearance, Welcome, Account, account deletion, and Card Database into clear sections. Destructive controls must remain visually separated from routine settings.

Relevant file:

- `apps/mobile/src/screens/SettingsScreen.tsx`

### Acceptance criteria

- The full navigation configuration no longer consumes several screens of repeated chips.
- A user can understand and change any tab position without reading explanatory copy first.
- Appearance and account controls are visible without excessive scrolling.

## Priority 3: Move collection filters into a bottom sheet

The current fixed-height inline filter panel clips the visible options and does not clearly communicate that it scrolls.

### Recommended behavior

- Open filters in a large bottom sheet or modal sheet.
- Keep the sheet title, close action, and result action visible while the filter controls scroll.
- Group filters into Color, Location, Rarity, Finish, Condition, Type, and Set.
- Preserve the current active-filter badge on the toolbar button.
- Provide a clear “Reset” action.
- Use a primary sticky action such as “Show 463 entries,” updated as filters change.
- Preserve the current sort and list/grid controls in the collection toolbar.

Relevant file:

- `apps/mobile/src/screens/CollectionScreen.tsx`

### Acceptance criteria

- No filter group is partially cut off without an obvious scroll affordance.
- The sheet works on the smallest supported phone height and with larger text settings.
- Applying or resetting filters requires no more taps than the existing design.
- Returning to the collection retains the selected filters.

## Priority 4: Consolidate spacing, typography, and components

The token foundation in `apps/mobile/src/theme.ts` is good, but screens still contain a number of one-off font sizes, weights, radii, gaps, and margins.

### Standardize

- Choose one default horizontal page inset, preferably 20 points, and use it consistently.
- Define shared styles for page title, section heading, row title, row metadata, caption, button label, input, icon button, and status badge.
- Use the existing radius tokens consistently:
  - Small for compact controls and thumbnails.
  - Medium for inputs and buttons.
  - Large for cards and grouped panels.
  - Extra large only for major artwork/hero surfaces.
- Ensure every text style specifies the intended custom font family rather than falling back to the system font because only `fontWeight` was set.
- Add shared pressed, focused, disabled, and loading treatments to reusable controls.
- Prefer a small set of deliberate component variants over local per-screen adjustments.

Relevant files:

- `apps/mobile/src/theme.ts`
- `apps/mobile/src/components/ui.tsx`
- `apps/mobile/src/components/ListRow.tsx`
- All files under `apps/mobile/src/screens/`

### Acceptance criteria

- Comparable pages align to the same horizontal grid.
- Equivalent rows and controls use the same type scale and vertical rhythm.
- Primary and secondary buttons behave consistently when pressed, disabled, or busy.
- New screen code rarely needs raw font sizes, radii, or spacing values.

## Priority 5: Reduce unnecessary bordered containers

Use raised, bordered cards for summaries, hero content, and controls that genuinely need separation. Avoid wrapping every row or section in an independent card.

- Prefer grouped list surfaces with internal dividers for routine lists.
- Keep dashboard metric cards, deck artwork tiles, and important forms as cards.
- Use whitespace and headings before adding another border.
- Preserve the collection's compact list rows; their light dividers are effective.
- Review Locations, Friends, Trades, Notifications, and Settings for excessive card repetition.

### Acceptance criteria

- Dense screens have a clear visual hierarchy instead of appearing as stacks of equivalent boxes.
- Important cards remain visually prominent because routine content is quieter.

## Priority 6: Improve menu organization

The side menu is clean but presents twelve destinations as one flat list.

Add subtle grouping without making the panel heavier. A suggested structure is:

- Primary: Scan, Dashboard
- Library: Collection, Locations, Decks, Search, Wish List
- Social: Friends, Trades, Notifications
- Tools: Import, Settings

Use small, low-contrast section labels or restrained separators. Preserve the selected-page highlight and unread badge.

Relevant file:

- `apps/mobile/src/components/MenuSheet.tsx`

## Priority 7: Finish interaction and loading polish

- Add visible pressed feedback to every tappable row, tile, button, icon button, and menu item.
- Prefer skeletons or stable placeholders for content-heavy loading states such as Dashboard and Decks so layouts do not jump after loading.
- Retain reduced-motion support.
- Keep animation durations short and purposeful.
- Review the long-press Scan fan interaction. It is useful but not discoverable; introduce it with a one-time coach mark or another subtle hint rather than expecting users to find it accidentally.
- Verify that the prominent gold Scan button does not falsely communicate that Scan is the selected tab on every screen. If necessary, distinguish its permanent primary-action styling from its selected state with a ring, icon treatment, or subtle motion.

Relevant files:

- `apps/mobile/src/components/TabBar.tsx`
- `apps/mobile/src/components/ui.tsx`
- `apps/mobile/src/components/WelcomeWalkthrough.tsx`

## Preserve these successful patterns

Do not dilute the parts of the interface that are already working well:

- The parchment, ink, leather, and ochre palette.
- The current dark-mode palette and its restrained contrast.
- Cinzel for display moments and Plus Jakarta Sans for functional copy.
- Deck artwork tiles with dark scrims and progress indicators.
- Collection list/grid switching.
- Large card artwork and clear price hierarchy in Card Details.
- Mort in onboarding, empty states, and meaningful reactions.
- The raised central Scan action.
- Clear 44-point touch targets, safe-area behavior, and existing accessibility labels.

Mort should remain purposeful. The centered header presence, onboarding, empty states, and scanner reactions are enough; avoid adding him as decorative wallpaper throughout routine screens.

## Suggested implementation order

1. Build the unified Mort-centered header and remove native nested headers.
2. Verify all nested navigation, back gestures, safe areas, and dark mode.
3. Replace the Settings navigation matrix with a compact slot editor.
4. Move collection filters into a bottom sheet.
5. Consolidate shared typography, spacing, radii, pressed states, and loading treatments.
6. Reduce unnecessary bordered cards and group the side menu.
7. Complete device QA at small widths, large text sizes, light mode, and dark mode.

## Visual QA checklist

- Test at the smallest supported iPhone width and a current large iPhone.
- Test light, dark, and system appearance.
- Test larger text/accessibility sizes for clipping and touch-target overlap.
- Confirm that Mort remains centered when back-button labels vary in length.
- Confirm no detail route renders duplicate headers.
- Confirm collection filters remain usable with many locations.
- Confirm the tab bar does not cover the final list row or primary action.
- Confirm selected, pressed, disabled, loading, success, and error states for shared controls.
- Ignore the floating Expo developer-tools gear during visual evaluation; it is not production UI.
