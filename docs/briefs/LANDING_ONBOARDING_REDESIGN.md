# Landing and web onboarding redesign

Draft for owner review · 2026-09-27. This is a work brief, not a second roadmap.

## Current status

Owner approved the binder-inspired composition with twelve concrete benefits and
requested deployment. The redesigned landing page is live at projectupkeep.app
as of 2026-09-27. It uses paper surfaces, serif headings, forest-green accents,
a physical-copy example, and light/dark theme support. Onboarding is deferred.
The current implementation adds no onboarding storage, launch logic, or tour UI.

The standalone `docs/prototypes/landing-onboarding.html` records the approved
visual concept. Its signup/login links are illustrative; use the live site for
working account links. See `LANDING_VALUE_PROPOSITIONS.md` for content evidence
and `../handoffs/LANDING_REDESIGN_HANDOFF.md` for release validation.

## Archived initial proposal

Everything below records the earlier tour proposal for future reference. It is
superseded by the current status above and is not an implementation requirement.

## Approved preferences

- Speak equally to collectors and players.
- First web login introduces a guided tour, rather than mandatory setup tasks.
- Refined fantasy styling with restrained card-inspired details.
- The full tour can be replayed from web Settings.

## Concrete preview

`docs/prototypes/landing-onboarding.html` is a standalone interactive concept.
It uses example data only and does not implement authentication or persistence.
The production app remains unchanged. Prototype signup buttons preview the tour;
production signup links will use the existing signup route. Sign-in, privacy,
terms, the existing wordmark, theme switching, and reduced-motion support remain
part of the production design even where simplified in the concept.

## Landing experience

Lead with “Your cards. Your decks. All accounted for.” Explain ownership,
physical locations, and readiness for a game in one short supporting paragraph.
An example “Where is my Sol Ring?” result demonstrates the central product idea
before asking the visitor to understand all its features.

Page sequence:
1. Quiet navigation with wordmark, How it works, Sign in, Create an account.
2. Hero with primary signup action and secondary scroll-to-demo action.
3. Three connected benefits: Collect (copies and locations), Play (deck readiness
   and playtesting), Connect (wish lists and friends' tradable copies).
4. A short explanation of guided first-login exploration and replay from Settings.
5. Closing signup action and clear privacy/terms/Scryfall attribution.

Use warm parchment surfaces, readable dark ink, deep green primary actions,
restrained gold rules, editorial serif headings, and system/body fonts. Retain
existing brand assets and Mort in a supporting role; avoid competing decorative
scenes around every feature. Example counts must be labelled; no invented user
numbers, testimonials, or promises about availability/pricing.

## Guided onboarding

Six steps with a persistent progress indicator, Back/Next, optional step navigation,
and a visible Skip tour control. First screen explains that examples are separate
from the user's data. Steps use responsive in-page panels rather than fragile
arrows attached to live dashboard controls.

1. Welcome: what Upkeep answers (what I own, where it is, what is ready to play).
2. Collection: printing, finish, quantities, catalog search versus owned cards.
   Interactive example expands a card into the copies across three locations.
3. Locations: binder/box/deck; deck copies are in use, spare copies remain available.
   Explain that tradability is explicitly chosen, not assumed.
4. Decks: decklist versus physical copies; sleeved/available/missing states and
   where to find analysis and playtesting.
5. Your circle: optional wish lists, friend matches, and trading. No invitations,
   sharing changes, or terms acceptance happen inside the example tour.
6. Ready: choose Add a card, Import a collection, or Explore dashboard. An optional
   tip can introduce iPhone scanning without implying browser camera scanning exists.
   Save completion before leaving; an import is not required to finish onboarding.

Users may skip without filling forms. Saving progress on forward/back navigation
lets an interrupted first tour resume at its last saved step. A failed save shows
Retry with an explicit temporary dismissal option; onboarding must not lock users
out of the application. Focus moves to each step's heading and keyboard users can
reach all controls. No autoplay, timed dismissal, or required motion.

## First login, returning users, and Settings

Launch the tour on the first authenticated web application visit for new accounts,
including accounts initially created on mobile. Existing accounts are backfilled
as skipped at rollout and can explicitly opt into the tour from Settings. A future
content-version update must not forcibly reopen it for completed/skipped users.

Use the authenticated app shell to show the first-run experience, preserving the
requested page URL and keeping password recovery and API behavior intact. A
returning user who has completed or skipped sees their app normally.

Settings gains “Getting started” with “Replay welcome tour.” Replay starts at
Welcome but preserves the account's completed/skipped state, so interrupting a
replay doesn't trigger forced onboarding at a later login. Replay creates no
locations/cards/decks and never erases the collection. The same reusable tour
component serves first-run and replay; examples are local temporary state.

## Architect impact map

Read-only architect review inspected current auth, shell, settings, schema, and
import paths. Recommended private `onboarding_progress` table keyed to auth user,
with version, stable step, status (active/completed/skipped), updated_at, and
finished_at; own-user SELECT/INSERT/UPDATE RLS and auth-user cascade deletion.
Do not put this state in profiles: migration 9 grants profile read access to all
authenticated users. Migration 49 provides an existing private-preferences pattern.

Touch points:
- `src/app/page.tsx`: replace marketing composition, preserve signed-in redirect
  and the development-only playtest fixture.
- `src/components/onboarding/*`: reusable accessible tour and example panels.
- `src/lib/onboarding/*`: validated state/progress rules and persistence.
- `src/app/(app)/layout.tsx`: first-run lookup alongside existing shell queries.
- `src/app/(app)/settings/page.tsx`: replay entry, no destructive reset.
- New migration and `supabase/tests/schema_test.sql`: private progress and isolation.
- Authentication signup/confirmation/recovery actions retain their existing semantics.

Imports add quantities when repeated, so the tour must never invoke real import
commits merely to demonstrate the product. No privileged server client is needed.

## Validation and release

- Unit checks for valid steps/statuses, completion/skip, version handling, and replay.
- Schema checks for two-user isolation, defaults, and account deletion.
- First login, refresh/resume, skip, completion, replay interruption, and direct links.
- Signup both with and without email confirmation; password recovery stays intact.
- Collection/location/deck counts remain unchanged after tour and replay.
- Desktop/narrow web layouts, light/dark themes, keyboard navigation, focus, and
  reduced motion. Ensure the main app remains usable if progress saving fails.
- Existing lint/typecheck/tests and production build; reviewer before commit.
- Local implementation and review first; production migration/deployment follows
  the user's approval for that concrete release.

## Decision before implementation

Approve the visual/flow concept and existing-user policy (optional invitation,
no forced tour). Repository `.claude/ORGANIZATION.md` requires architect impact-map
signoff before structural schema/data-access changes. The preview and this brief
make that approval concrete; no production changes have been made.
