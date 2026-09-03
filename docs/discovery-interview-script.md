# Project Upkeep — Phase 0 Discovery Interview Script

**Goal:** Talk to 5-10 people who trade Magic cards semi-regularly. Confirm two things before we lock the data model:
1. "My digital inventory drifts from reality after trades" is a real, felt pain — not just a theoretical one.
2. Find the actual granularity people want for location tracking, so we don't over- or under-build it.

**Format:** ~15-20 min, casual, in person or call. Record if they're OK with it — you want their exact phrasing, not your paraphrase, for the spec.

---

## Warm-up (sets context, don't skip)

1. How do you currently keep track of your Magic collection? Walk me through it like I'm watching over your shoulder.
2. Roughly how many cards are we talking about, and how has that changed — growing fast, stable, downsizing?

## Trading behavior & pain (the core hypothesis)

3. How often do you trade cards, and with who — LGS regulars, a playgroup, online/Discord trade groups, all of the above?
4. Walk me through what happens *right after* a trade completes. What do you update, where, and how long does it actually take?
5. Have you ever had your digital inventory or decklist be wrong because you forgot to update it after a trade? What happened — did it cause a real problem, or was it just annoying?
6. If a trade could just... happen — cards move between your account and theirs automatically the moment you both confirm — how much would that actually change your day-to-day? (Watch for a shrug here — a shrug is useful data too.)

## Location tracking granularity (the second hypothesis)

7. How do you organize where your cards physically live — boxes, binders, decks, some system, no system?
8. If you were tracking that digitally, how far would you actually go? "It's somewhere in Box 3" vs. "Binder A, page 4, slot 12"? Where's the line between useful and busywork?
9. Do you ever *not* know where a specific card is right now, physically? How often?

## Tool history (competitive reality check)

10. What have you tried before — ManaBox, Deckbox, Moxfield, a spreadsheet, nothing? What made you stick with it or quit?
11. What's the one thing that would make you drop what you're using now for something new?

## Trust & willingness to pay

12. What would make you *not* trust an app to automatically move cards between your inventory and someone else's? (This one matters a lot for the trade-transaction design — don't rush past it.)
13. Would you pay for something that solved this well? What would feel fair — one-time, monthly, free-with-limits?

---

## After each interview

Write down, in the person's own words:
- The exact moment their current process breaks down (this is your positioning copy, later)
- Whatever location-granularity answer they gave, verbatim
- Any trust/safety concern about auto-transfer — this feeds directly into the trade UX (e.g., do we need a "confirm both sides" step, an undo window, a dispute path?)

**Decision rule:** if 7+ of 10 people describe the same drift-after-trading pain unprompted, the core hypothesis holds — proceed to Phase 1 as scoped. If most shrug at Q6, that's a signal to revisit before writing any code.
