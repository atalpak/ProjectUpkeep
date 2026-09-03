# Competitive Analysis & Feature Proposals

**Written:** 2026-09-03 · **Author:** PM (prod agent) · **Horizon:** through Phase 4 launch

This document tests the charter's central bet against what the incumbents actually
ship today, then proposes and ranks what to build. It does not replace
`docs/feature-roadmap.md` — the roadmap stays the tiered map and the status of
record; this is the argument for what goes next and why.

**Research caveat, stated up front.** Moxfield's help pages, its feedback board
(`moxfield.nolt.io`) and its upgrade page all return 403 to automated fetches, and
Archidekt has no pricing page at a guessable URL. Where I could not read a primary
source I say so inline rather than filling the gap from memory. Everything below
that is stated as fact was read from a page I could actually fetch, or from a
search result quoting one. Claims I could not verify are marked **[unverified]**.

---

## 1. The honest competitive read

### 1.1 The bet, restated

The charter (§1) bets on two things being simultaneously true of the incumbents:

1. They treat **location as a flat text field**, not structured containers.
2. They treat **trading as a valuation/matching problem**, not a real inventory
   transfer.

Half of that bet has decayed. The other half has gotten *stronger*. And the real
competitor is not the one the charter names.

### 1.2 Where the bet has decayed: named containers are now table stakes

**Moxfield ships binders.** Not a text field — actual named containers you assign
cards to and can share with friends. Moxfield announced it themselves: "you can
assign cards to 'Binders' and share them with your friends. There is way more for
us to do with Collections, but this is one small step to help you all get more
organized." That post dates to January 2023, so this has been live for well over
three years.

**ManaBox ships binders with the physical-storage framing explicitly.** Their own
collection FAQ: binders are "designed for cards you own. You can name them after
your physical binders, making it easier to locate specific cards when needed."
That is our pitch, in their documentation.

**Helvault ships binders** — "organize your cards into multiple binders like in
real life" — and it is free with no collection cap.

**Deckbox ships physical-box organisation**, though it is paywalled. Premium
(\$5.99/mo, or \$47.88/yr = \$3.99/mo) includes "unlimited inventory tags" for
"organizing cards into binders, physical boxes, sale lists, grading piles, loans,
or other projects."

**Only Archidekt has actively declined to build it**, and they lost a user over it
on their own forum. A user said they were switching to Moxfield specifically
because it tracks which physical box a card is in. Archidekt staff replied: "Our
intent is for users to use collection labels. Functionally they can do everything
a folder or a binder can do (actually it can do way way more since each card can
have as many labels as you want)."

**So: "we have named containers and they don't" is no longer a differentiator. It
is parity, and we are late to it.** If our marketing says "the only tool that
knows where your card is," a prospective user who has used Moxfield in the last
three years will bounce off that claim immediately, and rightly.

### 1.3 Where the bet holds — and it is a sharper edge than the charter claims

The incumbents' containers are **labels on a quantity bucket**. Ours are
**properties of an individual physical copy**. That distinction sounds academic
until you look at what their users are asking for and not getting.

Three separate open requests on Moxfield's own feedback board:

- *"Split multiples to binders"* — you cannot easily divide four copies of a card
  across four containers.
- *"Allow cards to exist in Multiple Binders, without adding them to the
  Collection again"* — the workaround inflates your collection count.
- *"Show WHICH Binder from Deck (Collection Enabled)"* — from a deck view,
  Moxfield tells you that you own the card. It does not tell you where it is.

And the workaround a user documented for the first one: to move some copies to a
different binder, you decrement the count in one binder and re-run the entire
add-card flow in the other. **[unverified]** — I could not fetch the thread body,
only the quoted excerpt in search results; treat the exact mechanics as
approximate, but the existence and repetition of the request is well attested
across at least three distinct feedback items.

These are not three feature gaps. They are three symptoms of one modelling
decision. Moxfield stores `(card, binder, quantity)`. We store `card_instance`
with condition, finish, language and a location on the row itself
(`supabase/migrations/00000000000005_card_instances.sql`). Every one of those
three requests is free for us and structurally expensive for them — a schema
migration on a live product with millions of collection rows, plus a rewrite of
every collection query and the entire collection UI. That is the kind of thing a
company ships when it has nothing else to do, which Moxfield never will.

**Additionally, nobody else has containers with a parent.** Migration 4 gives us
`parent_location_id` with a one-level depth cap — "Box 3" containing "Commander
Binder". Moxfield binders, ManaBox binders, Archidekt labels and Deckbox tags are
all flat. A collector with four longboxes and eleven binders has a real
organisational problem that a flat namespace does not solve.

**And nobody else has deck-as-location with per-copy state.** Our deck workspace
distinguishes sleeved / available / missing per entry
(`src/lib/collection/deck-state.ts`). Moxfield's equivalent is "you own this
card" — which is why "Show WHICH Binder from Deck" is an open request there. When
you physically build a deck from your collection, the card leaves the binder.
Moxfield does not model that. Deckbox gets closest, with "mark decks as built to
exclude those cards from tradelist automatically" — but that is a boolean on a
whole deck, not per-copy state, and it is behind the paywall.

### 1.4 The trading half: the bet holds against Moxfield and Archidekt entirely

**Moxfield has no trading system.** Users simulate one by creating public decks
named "Trade Binder" — there are dozens of them — and tagging cards
"Available"/"Pending" by hand. That is a spreadsheet with card art. Moxfield's
commercial model points at affiliate revenue from vendor links, not at
peer-to-peer trade, and building a trade engine would put them in a
trust-and-safety business they have shown no appetite for.

**Archidekt has no trading system either.** Their public surface is deckbuilding
plus a collection tracker; the community comparisons that list features for both
products record no trading for either.

**ManaBox, Helvault and TCGPlayer's collection tracker: no P2P trading found.**
TCGPlayer is a marketplace first — you sell into their marketplace, you do not
trade with a person. That is a categorically different product and not a
competitor for our ICP.

So against the two products the charter names as primary competitors, the trading
wedge is *uncontested*. That is a real finding and it should raise confidence.

### 1.5 The correction Anthony needs: our real competitor is Deckbox, not Moxfield

The charter's competitive section (§1) puts Deckbox in a list with ManaBox and
Moxfield as products that "still treat trading as a valuation/matching tool, not a
real inventory-transfer event." **That is wrong about Deckbox, and it is the most
consequential error in the charter.**

Deckbox has run a genuine peer-to-peer trading community since 2008. What I
verified they have that we do not:

| Deckbox has | We have |
|---|---|
| Trade disputes with defined waiting periods (2 weeks domestic, 3 to Canada/EU, 4 international) | Nothing. Terms page *says* disputes are between users. |
| A feedback/reputation system, with feedback manipulation an explicit ban offence | Nothing. |
| "Save notes on other users **or block them**" (Premium) | Nothing. |
| A 7-day response obligation once a trade is accepted, enforceable via dispute | Trade expiry only (migration 13) |
| One-active-account rule, enforced by banning | Nothing. |
| Photos/scans attached to inventory and tradelist cards (Premium) | Roadmap Tier 5, not started |
| Wishlist-to-tradelist matching across the community | Want-list matching, but friends-only |

Two things follow from this.

**First, our entire Tier 4 is Deckbox's table stakes.** The roadmap frames block /
report / dispute / rate-limiting as prudent hardening. It is not — it is the
feature set the one incumbent that actually does peer trading considers minimum
viable, refined over eighteen years of live abuse. Any user who has traded on
Deckbox and lands on us will notice the absence within one trade. This
substantially raises my confidence in the roadmap's existing sequencing call, and
I address it in §4.

**Second, and this is the good news: Deckbox is built for a different trade.**
Their rules are about the mail — tracking numbers, postal service case numbers,
mail fraud as a federal criminal matter, multi-week international dispute
windows. Deckbox is a *shipping* trade platform. Our ICP (charter §1: LGS
regulars, playgroups, local Discord groups) trades **in person, at a table**.
That user does not need a tracking number, does not wait three weeks for a
dispute window, and does not care about mail fraud. They need: does the app know
what I have on me, does it know what you want, and when we shake hands does my
inventory update without me retyping it.

**Deckbox cannot easily follow us there** — not for technical reasons but for
product-shape reasons. Their whole trust apparatus is calibrated to
strangers-at-a-distance. An in-person, known-playgroup trade flow would require
them to run a second, lighter trust model in parallel with the heavy one, and
their UI is famously frozen (the deck builder is described as pre-2012). Also
worth noting: **Deckbox paywalls the location feature.** Physical-box organisation
is a \$3.99–5.99/mo Premium feature. Ours is free and structurally better. That
is a defensible position.

### 1.6 Verdict on the bet

| Charter claim | Status | Note |
|---|---|---|
| Incumbents treat location as flat text | **Decayed** | Moxfield, ManaBox, Helvault and Deckbox all ship named containers. Only Archidekt refuses. |
| Structured containers are our wedge | **Refine it** | Containers are parity. **Instance-level** location, **nesting**, and **per-copy deck state** are the wedge, and are structurally hard for the incumbents. |
| Incumbents treat trade as valuation/matching, not transfer | **Holds vs Moxfield/Archidekt/ManaBox/Helvault** | Genuinely uncontested there. |
| ...including Deckbox | **False** | Deckbox runs a real trading community with dispute, reputation and blocking. Charter §1 should be corrected. |
| Reference pricing is table stakes, not a differentiator | **Holds** | Every product surveyed has it, several with multi-vendor comparison. Correctly scoped out. |

**One-line version:** we are not the only tool that knows *which binder*. We can
be the only tool that knows *which copy*, in *which box inside which binder*, and
can hand that specific copy to another person's inventory across a table.

---

## 2. Feature proposals, ranked

Each entry: the user problem, why it fits, rough build cost for a solo maintainer
on free-tier Supabase + Vercel, and a parity/differentiation call.

Costs are relative sizes for one person, not calendar promises: **S** ≈ a
sitting, **M** ≈ a focused week, **L** ≈ multiple weeks and a schema change.

### Tier A — build before beta

**A1. Trade proposal rate limiting** · **M** · *Parity (safety floor)*
Today one account can propose unbounded trades to every friend. This is a live
vector, not a hypothetical, and it is the cheapest thing on this list to fix
before there are users and the most awkward after. Deckbox handles the equivalent
problem with a one-account rule plus banning; we can handle it far more cheaply
with a per-user, per-window cap enforced in the database rather than in app code,
so no route can forget it — the same discipline migration 14 already applies to
notifications. Free-tier safe: a counter table and a check, no queue, no cron.

**A2. Block, and report** · **M** · *Parity (safety floor)*
Deckbox has had "save notes on other users or block them" for years. A blocked
user must not be able to propose to you, see your trade binders, or match against
your want list — which means this is an RLS change, not a UI toggle, and the
existing `is_tradable` friend gates are the right place to hook it. Report is a
row plus an email to Anthony; no moderation queue yet.

**A3. Dispute flag with a resolution log** · **M** · *Differentiation, if scoped right*
The terms page already promises disputes are between the two users, with no
mechanism behind the promise. But do **not** copy Deckbox here. Their dispute
model is calibrated to mail: multi-week windows, postal case numbers. For an
in-person playgroup trade the honest primitive is much smaller — either party can
flag a completed trade as disputed within N days, which freezes the trade in
history with a visible marker, notifies both sides, and lets Anthony see it. No
arbitration, no reversal of the transfer, no escrow. **Explicitly a non-goal:** we
do not adjudicate. The value is that a bad actor accumulates a visible record,
which is exactly the trust signal an LGS regular actually uses.

**A4. Privacy & visibility controls in Settings** · **S** · *Parity*
The enforcement is already solid and RLS-level; the *controls* do not exist, so a
user cannot see or change their own exposure. That is most of the trust value,
sitting one Settings surface away from done. Small job, disproportionate payoff,
and it is a prerequisite for A2 feeling coherent.

**A5. Collection export (CSV)** · **S** · *Parity (table stakes)*
Currently in-flight and uncommitted. Worth naming as its own item because the
roadmap never listed it: we have import but no export. Every product surveyed has
export — Helvault advertises it as a headline feature. A collection manager you
cannot get your data out of is one nobody with a 2,000-card collection will trust
with their 2,000-card collection. This is a lock-in objection, not a feature
request, and it costs a sitting.

### Tier B — the wedge, sharpened

**B1. "Where is it" from the deck view** · **S–M** · *Real differentiation*
This is the single highest-leverage item on the board, and it is nearly free.
Moxfield's "Show WHICH Binder from Deck" is an *open feature request on their own
board*. We already have per-entry deck state (`deck-state.ts`), instance-level
locations, and a locate route (`/api/collection/locate`). The job is to surface,
on each missing/available deck line, the container path of the copy that would
fill it — "Box 3 › Commander Binder". A user physically assembling a deck at the
kitchen table wants a pick list, and no competitor produces one. If Anthony wants
one screenshot that explains why this product exists, it is this screen.

**B2. Physical pick-list / put-away mode** · **M** · *Real differentiation*
The extension of B1 into a workflow: given a deck (or a completed trade), produce
an ordered walk of the collection — visit Box 3 once, pull these six cards, then
this binder, pull these two. Ordered by container, not by card name, because you
walk to boxes, not to cards. The put-away direction matters just as much: after a
trade completes, the cards you received need to physically go somewhere, and
right now the app just deposits them into inventory. Nesting (migration 4) is
what makes the ordering meaningful and is the thing no competitor can express.

**B3. Trade → location assignment on acceptance** · **M** · *Real differentiation*
Right now the atomic transfer moves ownership. Physically, the card also has to
land somewhere. Prompting the receiver to assign incoming cards to a container —
with a sensible default and a "sort later" escape hatch that feeds the existing
unsorted count — closes the loop that the whole product is named after. Without
this the trade engine quietly *creates* the drift the product exists to prevent.
Note this is the one place where our two wedge halves actually touch, which is
precisely why it is worth building.

**B4. Set and colour breakdown on the dashboard** · **S** · *Parity*
Already half-built: `getCollectionSets()` exists, `cards.colors` and
`color_identity` are already synced. Cheap perceived value. Low priority, but it
is an hour.

**B5. Outbound marketplace deep links** · **S** · *Parity*
`purchase_uri` and `tcgplayer_id` are already on the `cards` table and already
selected in the collection queries. This is a UI-only job and remains the best
effort-to-value ratio left on the board. Charter §2 lists it as a planned v2
addition, so this is in scope, not a widening of it.

### Tier C — after beta feedback, not before

**C1. Trade circles / playgroups** · **L** · *Differentiation, but unproven*
Matches the ICP on paper and touches friendships, RLS on tradable locations,
want-list matching and the proposal flow all at once. The roadmap's instinct to
wait for beta evidence that 1:1 friendship is the actual pain point is correct
and I am not overriding it. If interviews say playgroups, this becomes Tier B.

**C2. Location photos** · **M** · *Differentiation, but costs money*
"Snapshot of the actual binder page" is a genuinely wedge-deepening idea and
Deckbox paywalls its equivalent. **But it needs storage**, and Supabase's free
tier gives roughly 1 GB — call it a few thousand phone photos before it stops
being free. Do not start this without deciding what happens at the cap. Flagging
against the $200 budget as required.

**C3. Printable location labels / QR** · **S–M** · *Differentiation, cheap*
Scan a sticker on a physical box, land on that container in the app. Charming,
genuinely useful for the target user, and needs no server component beyond a URL
route we already have. Underrated for its cost; I would pull it forward if beta
users respond to B1/B2.

### Explicitly recommended against — this is chasing Moxfield

I want these on the record as *declined*, not merely unscheduled.

- **A better deck builder.** We will never beat Moxfield's editor and should stop
  partway. Our deck workspace exists because a deck is a *location*, not because
  we are a deckbuilding site. Every hour spent on drag-and-drop, playtest hands,
  goldfishing or mana-curve charts is an hour spent losing a fight we chose.
  **The line: we build deckbuilding features only where they express physical
  state.** Sleeved/available/missing is in. A mana curve chart is out.
- **Card scanning / OCR.** Roadmap Tier 5, and it should stay there. ManaBox,
  Helvault, Dragon Shield and TCGPlayer all have mature scanners; several are
  free. A worse scanner is worse than no scanner, and a good one is not a
  weekend. CSV import from those apps is the right answer — let them scan, we'll
  take the export.
- **Multi-vendor price comparison.** Charter-scoped-out and correctly so.
  Competitors compare TCGPlayer, Card Kingdom, SCG and Cardmarket. We show one
  Scryfall-bundled number. That is fine. Reference pricing is table stakes we
  meet cheaply, not a place to compete.
- **Multi-TCG support (Pokémon, Lorcana, One Piece).** Tempting because
  incumbents are expanding and it looks like growth. It is a schema fork and a
  second card-data pipeline for one maintainer. No.

### Scoped-out items I am *not* asking to reopen

Per the standing constraints, I checked each proposal against the
permanently-out-of-scope list. **Nothing above requires reopening any of it.** In
particular: A3 (dispute) is deliberately *not* escrow, arbitration or a payment
mechanism; B5 (deep links) is a hyperlink and explicitly not API integration,
which the charter already anticipated as a v2 addition. Reputation/feedback —
which Deckbox has and we do not — is the one thing I considered proposing and
decided against for now: it is a moderation burden for one person and A3's
visible dispute record gets most of the trust benefit at a fraction of the cost.
**No decision needed from Anthony on scope.**

---

## 3. What changes in the roadmap

Status corrections applied to `docs/feature-roadmap.md` today are listed there.
The substantive one: **deck-as-location was marked ✅ including "a commander
designation," and the commander designation has never worked.** Detail in the
audit note in that file.

---

## 4. Sequencing

**I agree with the roadmap's call — Tier 4 before beta — and the competitive read
makes the case stronger than the roadmap does.**

The roadmap justifies Tier 4 on the abuse vector. That is correct but undersells
it. The real argument is §1.5: the only incumbent that runs peer-to-peer trading
treats dispute, reputation and blocking as minimum viable, refined across
eighteen years of live abuse. We are proposing to point strangers-adjacent
users — LGS regulars, not close friends — at a trade engine with none of it. That
is not an unhardened feature; it is an unshipped one.

One amendment. The roadmap's order is rate limiting → block/report → dispute, with
the cheap partials alongside. I would **interleave B1 into that block**, not defer
it, for a reason that is about the beta and not about the code: a closed beta
where the only new thing since Phase 2 is safety plumbing generates no signal
about whether the wedge works. Beta users cannot tell you that instance-level
location matters if they never see it do anything. B1 is small, it is the clearest
expression of the wedge we have, and it is the thing to put in front of the Phase 0
interviewees.

**Recommended order:**

1. **A1 rate limiting** — the only live vector; do it first and alone.
2. **A5 export** (finish the in-flight work) + **B4** + **B5** — three small items,
   one sitting each, all mostly built. Clears the deck.
3. **A2 block/report** + **A4 privacy controls** — one theme, one brief. They share
   the RLS surface and the Settings surface; splitting them doubles the work.
4. **B1 where-is-it-from-deck** — the wedge, visible, before beta.
5. **A3 dispute flag** — last of the safety set, and the one most improved by
   knowing what beta trades actually look like. **This is the gate: beta does not
   open until A1–A4 and B1 are in.**
6. **Beta.** Instrument per §5 from day one.
7. **B3 trade → location assignment**, then **B2 pick-list mode** — post-beta, and
   B2 sized by whether B1 landed.
8. **C1 trade circles** only if beta says 1:1 friendship is the wrong unit.

**One thing I would cut from the pre-beta list if time presses:** B4 and B5. They
are perceived value, not wedge and not safety. Everything else in steps 1–5 is
load-bearing.

**A note on the in-flight work.** Deck wish list, commander picker, split-face
pips and export are uncommitted and incomplete, and migrations 17 and 18 are
unapplied. That work should be finished and landed before step 1 begins, not
carried alongside it — migration 18 fixes a bug that makes a shipped-marked
feature not work, and a half-applied migration set is the worst possible starting
point for schema work on rate limiting.

---

## 5. KPIs

There is **no analytics stack**, and I am not proposing one. Every metric below is
answerable with a SQL query against Supabase, because the events we care about are
already rows in our own tables. Cost: \$0. Where a metric needs a new column or
table I say so — that is the entire instrumentation budget.

A hosted product-analytics tool (PostHog, Plausible and similar) would add
funnel and retention views we cannot easily get from SQL. **Recommendation: do
not buy one before beta.** At beta scale the sample is too small for funnel
analysis to mean anything, and the free tiers that exist would cover us anyway if
we changed our mind later. Against a \$200 budget where the domain is the only
guaranteed spend, this is an easy no.

### The five that matter

**K1 — Location fidelity: what fraction of instances have a location?**
*The wedge's survival metric.* If people import 2,000 cards and leave 1,900
unsorted, structured location has not survived contact with a real collection and
the premise is wrong.
*Instrumentation:* none. `card_instances.location_id` null-rate per user; the
dashboard already computes an unsorted count.
*Failure:* median user below 60% located 30 days after import, **or** the located
fraction falling over time — the second is worse, because it means we create drift
rather than prevent it.

**K2 — Post-trade location assignment rate.**
*Does the loop actually close?* Of cards received in a completed trade, what
fraction get a real location within 7 days?
*Instrumentation:* one column — `card_instances.acquired_via_trade_id` — set by
the existing transfer function. Small, and it also gives us provenance for free.
*Failure:* below 50%. That means the trade engine is manufacturing exactly the
mess the product exists to clean up, and B3 becomes urgent rather than post-beta.

**K3 — Want-list match → proposal conversion.**
*Does matching create trades, or just a pretty list?* Of want-list matches
surfaced to a user, what fraction become a proposal within 14 days?
*Instrumentation:* one table logging match impressions (user, want row, supplier,
timestamp), written where the wants page already computes matches. A few hundred
rows a week at beta scale — trivial on free tier.
*Failure:* under 10%. Then matching is a feature people look at and don't act on,
and C1 (trade circles, which is mostly a bigger matching surface) should be cut,
not deferred.

**K4 — Trade completion rate, and time-to-completion.**
*The trade engine's honesty metric.* Proposals sent → accepted → not disputed.
*Instrumentation:* none; `trades.status` and timestamps exist, plus the A3
dispute flag once built.
*Failure:* completion under 40%, or a median time-to-accept beyond a few days.
Slow acceptance means the app is not where the trade actually happens — people
are agreeing in person or on Discord and treating us as after-the-fact
data entry, which is a different and much weaker product.

**K5 — "Where is my card" usage per active user per week.**
*The payoff-moment metric.* If nobody looks things up, nobody believes the data,
and the whole premise is decorative.
*Instrumentation:* a counter on the locate route (`/api/collection/locate`) — one
table, user + timestamp, no PII beyond the user id we already have.
*Failure:* under one lookup per active user per week. That would say people
maintain locations out of tidiness rather than utility, which is not a habit that
survives a busy month.

### Deliberately not measured

Signups, total cards tracked, page views, DAU. All of them can go up while every
metric above goes down, which is exactly the failure mode a solo founder cannot
afford to miss.

### The qualitative check the numbers can't give

One question in every beta exit interview: *"Since you started using this, has
your app ever told you a card was somewhere it wasn't?"* Every "yes" is a bug in
the premise, not in the code, and no dashboard will surface it.

---

## Sources

- [Archidekt forum — Folders/boxes for collection (staff reply on labels)](https://archidekt.com/forum/thread/17309870)
- [Moxfield on X — Binders announcement](https://x.com/moxfieldmtg/status/1614352225173704704)
- [Moxfield Feedback — Show WHICH Binder from Deck](https://moxfield.nolt.io/1250)
- [Moxfield Feedback — Split multiples to binders](https://moxfield.nolt.io/1564)
- [Moxfield Feedback — Allow cards to exist in Multiple Binders](https://moxfield.nolt.io/2287)
- [Moxfield Patreon membership tiers](https://www.patreon.com/moxfield/membership)
- [Archidekt — Support us](https://archidekt.com/support-us)
- [Deckbox Premium — pricing and feature list](https://deckbox.org/premium)
- [Deckbox — Trading rules](https://deckbox.org/help/trade_rules)
- [Deckbox — Getting started](https://deckbox.org/help/start)
- [ManaBox — Collection FAQ](https://www.manabox.app/guides/collection/faq/)
- [Draftsim — The 11 Best MTG Collection Tracker Apps and Software](https://draftsim.com/mtg-collection-tracker/)
- [GrimDeck — Best MTG Collection Builder Apps for Tracking and Decks](https://grimdeck.com/blog/best-mtg-collection-tracker-deck-builder)
- [Lotus Scan — Helvault review](https://www.scanyourmtg.com/review/helvault/)
- [TCGplayer — Collection Tracker](https://store.tcgplayer.com/collection)
