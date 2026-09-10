---
paths:
  - "src/app/**"
  - "src/components/**"
  - "src/proxy.ts"
description: Next.js 16 App Router conventions in this codebase.
---

# App Router (Next.js 16.3.3)

**This is not the Next.js in your training data.** Before writing routing,
caching, or data-fetching code, read the relevant guide in
`node_modules/next/dist/docs/` — resolved from the repo root. Heed deprecations.

## Conventions that differ from what you may expect

- **`src/proxy.ts`, not `middleware.ts`.** Next 16 renamed the convention; the
  behaviour is unchanged. Its only job is refreshing the Supabase session cookie
  and bouncing anonymous visitors to `/login`. Do not rename it back.
- Pages that depend on who is signed in declare themselves **never prerendered**,
  and say so in a header comment. Follow the existing pattern rather than
  inventing a caching strategy — `src/app/(app)/u/[username]/page.tsx` and the
  API routes are the models.
- The `(app)` route group exists to give signed-in pages the nav shell. Public
  routes (`/login`, `/signup`, `/auth`, `/`) sit outside it, and
  `src/lib/supabase/session.ts` holds the matching `PUBLIC_PATHS` list. Adding a
  public route means editing both.

## Components

- Shared primitives live in `src/components/ui.tsx`. It is explicitly *not* a
  design system — just enough to stop every page re-inventing a button, and one
  place to restyle from. Put new shared primitives there.
- `cx` is imported from `src/lib/cx.ts` (re-exported by `ui.tsx`). It is its own
  module to avoid a circular import with `ManaCost.tsx` / `SetSymbol.tsx`.
- Tailwind v4, configured through `@tailwindcss/postcss`. There is no
  `tailwind.config.js` — theme tokens live in `src/app/globals.css`.
- This app gets used **standing at a table, phone in one hand.** Interactive
  targets grow under the `coarse:` variant rather than at a width breakpoint: a
  narrow laptop window still has a mouse, a wide tablet does not. 44px is the
  floor for anything tappable.

## Server actions and route handlers

Both run as the signed-in user through `src/lib/supabase/server.ts`. There is no
privileged path through the web app — see `.claude/rules/data-access.md`.
