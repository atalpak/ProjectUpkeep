# Project Upkeep value propositions

2026-09-27 · Content working document. Onboarding remains deferred.
These are capabilities verified in the code, not measured outcomes or user demand.
Priority below is a recommendation based on the product's physical-location model.

| Priority | User value | Plain landing copy | Product evidence |
|---|---|---|---|
| Lead | Find the physical copy you own | Know what you own. Know where to find it. | `/find` groups copies by binder, box, deck, and unsorted location; `src/app/(app)/find/page.tsx`, `src/lib/collection/locate.ts` |
| Lead | Distinguish spare copies from copies already in use | See which copies are available and which are sleeved in a deck. | Shared physical-copy and deck-location availability rules; `src/lib/collection/availability.ts`, `packages/upkeep-domain` |
| Primary | Evaluate a decklist before assembling it | Paste a decklist. See what you own, what is in another deck, and what you still need. | `/decks/check`, `src/components/decks/ListCheck.tsx`; nothing saved unless requested |
| Primary | Find missing cards within your playgroup | See which friends have tradable copies of the cards you want. | `/wants`, `/find`, `src/lib/social/wants.ts`; depends on friendships and explicitly tradable locations |
| Supporting | Keep an accurate inventory of specific copies | Track printing, finish, quantity, and location—not just the card name. | Collection entry types and add/import controls; `src/lib/types.ts`, `src/app/(app)/collection/add` |
| Supporting | Maintain a shared record when trading | Propose trades with friends and keep your collections up to date when they accept. | Friend trade actions and transactional ownership transfer; `src/app/(app)/trades/actions.ts` |
| Supporting | Get an existing collection into the app and retain access to the data | Import a collection or card list. Export it when you need it. | `/collection/import`, `/api/collection/export`; supported formats are CSV and card/deck lists, not every third-party service |
| Supporting | Try a deck before a physical game | Explore opening hands and playtest your deck. | `/decks/[id]/test` consistency simulations and `/decks/[id]/play` manual playtester; no claim to competitive win-rate prediction |
| Supporting | Reduce typing when cataloging physical cards | Scan cards with the iPhone app, then confirm the printing and location. | Native iOS scanner; tested owner Book #116 reads. Not a web camera scanner or an automatic bulk scanner |
| Supporting | Get price context for the collection | See Scryfall price estimates for your cards. | `src/lib/collection/pricing.ts`; missing prices are unpriced and foil/nonfoil prices differ. Not sale proceeds or guaranteed valuation |

## Proposed landing hierarchy

1. **Hero:** “Know what you own. Know where to find it.”
   Supporting sentence: “Track your Magic cards by binder, box, and deck. Find
   available copies, check what a decklist needs, and see what friends have to trade.”
   Primary action: Create an account. Secondary action: See an example.
2. **Show the differentiator:** one card, six copies, three physical locations;
   five available and one sleeved. Label the data as an example.
3. **Player payoff:** explain a decklist check using owned/in-use/missing states.
   No promise to avoid every purchase or assemble a competitive deck.
4. **Playgroup payoff:** wishes matched to friends' tradable copies and accepted
   trades updating ownership. Explain the prerequisite without burying the benefit.
5. **Getting started:** short import/manual-add sentence and signup action.
   Exact printing records, export, scanning, playtesting, and estimates can have
   a compact supporting line or live on feature pages. They should not compete
   equally with the central reason to use Upkeep.

## Copy constraints

Use concrete verbs: find, track, check, import, trade. Avoid “all-in-one,” “magic,”
“unlock,” “effortless,” “seamless,” invented savings, user counts, and testimonials.
Do not imply every feature is automatic or that the catalog is the user's actual
inventory. Locations only stay accurate when users record physical movements.
No marketplace, sales/pricing engine, or competitive opponent simulation promise.
No onboarding claim while onboarding is deferred.

## Owner direction update

Owner requested broad feature coverage and more artistic character. Revised
prototype includes twelve benefit entries, retaining the physical-copy example
near the top and adding binder-page details, paper colors, serif headings, and
forest-green controls. Copy remains concrete; onboarding remains deferred.
Primary benefits still lead, but supporting capabilities are now visible rather
than omitted. Final web implementation should use existing brand assets and
light/dark theme tokens while preserving this composition.
