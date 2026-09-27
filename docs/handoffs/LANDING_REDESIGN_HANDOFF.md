# Landing redesign

2026-09-27. Owner approved the binder-inspired prototype and requested live deployment.
The landing page now leads with physical-copy location and availability, then decklist
checks, friend matches, and twelve concrete benefits. Existing wordmark, theme toggle,
account links, Scryfall attribution, privacy/terms links, signed-in dashboard redirect,
and development-only playtest fixture are retained. No onboarding is implemented.

`src/app/landing.module.css` scopes the visual changes to the public landing page;
light/dark colors use existing app tokens and local accents. Public previews use only
labelled example data. Deployment snapshot is HEAD plus the landing TSX and CSS module,
excluding the pre-existing playtester layout/test/handoff edits.

Validation: 1,040 web tests pass; lint has zero errors and two existing mobile hook
warnings; typecheck passes. Read-only review found no blockers. Production build and
post-deploy visual checks are recorded below after completion.

Production deployment `7pEiM2Bj4V1NGpndDPYtC3UwSBFd` completed with a successful
Next production build and was aliased to https://projectupkeep.app. Live browser
checks verified all twelve benefit panels and the hero/example table, light/dark
theme controls, and a 390px narrow layout with no page-level horizontal overflow.
No authenticated account was used for these visual checks; the existing signed-in
redirect is preserved in code and confirmed by review.
