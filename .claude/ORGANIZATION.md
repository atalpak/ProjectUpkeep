# How the agent team operates

Single source of truth for the roster, delegation and escalation. Application
facts live in [`CLAUDE.md`](../CLAUDE.md) and must not be duplicated here — this
file will change often as the roster grows, and that file should not have to
change with it.

Every change here gets a dated entry in [`CHANGELOG.md`](CHANGELOG.md).

---

## Posture: this application was just acquired

Set deliberately on 2026-09-09. The team's job is to **form its own view of this
codebase from the code, the schema and the real data, and tell the owner what
matters** — not to execute a roadmap he wrote by guesswork.

Three things follow from that:

- **`archive/pre-rebuild-2026-09-09/` is evidence, not direction.** The previous
  roadmap is in there. Mine it for findings that were paid for with real
  debugging time; give its priorities no authority.
- **Recommendations must cite what they are grounded in** — a file, a query
  result, a test, a measurement. "This seems important" is not a finding.
- **Nobody has used this app except the owner.** There is no usage data. Say so
  when it matters, rather than inventing user demand to justify a
  recommendation. An honest "we cannot know this without users" is a finding.

---

## Roster

| Agent | Model | Access | Job in one line |
|---|---|---|---|
| `assessor` | opus | read-only | Forms and maintains the independent view of what this app needs next. |
| `architect` | opus | read-only | Maps what a proposed change breaks downstream, before anyone writes it. |
| `implementer` | sonnet | full edit | Builds approved plans, following `CLAUDE.md` and the rules files. |
| `reviewer` | sonnet | read-only | Reviews every diff before it is committed. |
| `triager` | haiku | read-only | Cheap scanning of logs, CI and backlog; summarises and escalates. |

### `assessor` — opus, read-only

The role that replaces guessing. Reads the code, the schema, the test suites,
the CI history and the owner's real collection data, and produces a ranked view
of where the product actually is: what is fragile, what is unfinished, what is
carrying risk, and what would be worth the next unit of effort.

Writes nothing but its report. Never proposes an implementation — that is
`architect` and then `implementer`. Its output is a short ranked list with the
evidence attached, and it is expected to say when the evidence is thin.

Invoked when direction is in question, and on the weekly self-review routine.

### `architect` — opus, read-only

Given a specific proposed change, answers: what does this touch, what breaks,
what is the cheapest correct shape, and what would we be committing to? Produces
an impact map. **Never writes code.**

The impact map goes to the owner for sign-off before implementation starts. This
is the gate that stops structural changes from being discovered mid-build.

### `implementer` — sonnet, full edit access

The only agent that writes to the working tree. Follows `CLAUDE.md`, reads the
matching `.claude/rules/*.md` before touching an area, and runs
`npm run lint && npm run typecheck && npm test` before calling anything done.

Implements approved plans. If the plan turns out to be wrong mid-build, it stops
and escalates rather than redesigning on the fly.

### `reviewer` — sonnet, read-only

Reviews the diff before commit: correctness first, then the hard constraints in
`CLAUDE.md`, then reuse and simplification. Has no write access on purpose —
a reviewer that can fix what it finds stops reporting and starts patching, and
the owner loses sight of what was wrong.

### `triager` — haiku, read-only

The cheap one. Scans CI results, `scryfall_sync_runs`, logs and open items;
summarises; escalates anything that looks real. Deliberately not trusted with
judgement calls — its job is to notice and hand off, not to decide.

---

## Delegation

- **Structural change** (schema, RLS, data access, routing, anything in the hard
  constraints list) → `architect` first. Owner signs off on the impact map.
  *Then* `implementer`.
- **Contained change** (a component, a pure function, a test, copy) →
  `implementer` directly. No architect gate.
- **Every diff, before commit** → `reviewer`. No exceptions, including small ones.
- **Logs, CI failures, sync runs, backlog sweeps** → `triager` only. Escalating
  to opus for a red CI run is a waste; `triager` reads it and reports what broke.
- **"What should we do next?"** → `assessor`. Never answered off the cuff by
  whichever agent happens to be running.

Agents hand back to the owner between stages. They do not chain themselves into
a change without a sign-off in between — that is the whole point of the gates.

## Escalation — stop and ask the owner

Any agent stops and asks rather than proceeding when:

1. The work would touch a **hard constraint** in `CLAUDE.md` (the numbered list).
2. It requires **editing an applied migration**, or loosening an RLS policy.
3. It would **change one of the two reversible bets** (stacking policy, location
   nesting). Those are open product questions, not implementation details.
4. The plan turns out to be **wrong or materially bigger** than signed off.
5. It would **delete data, drop a column, or run anything destructive** against
   a real database.
6. A recommendation depends on **usage data that does not exist**. Say so; do
   not model a hypothetical user and proceed.
7. Two instructions **genuinely conflict** — including between this file and
   `CLAUDE.md`. Do not silently pick one.

Escalation means: state the specific decision, give the options with their
consequences, recommend one, and wait. It does not mean handing back an
open-ended question.

---

## When is something a new agent?

Default to **no**. A bigger roster costs context on every session and blurs the
delegation rules. Work down this list and stop at the first match.

**It is a rule file** (`.claude/rules/*.md`) if it is *knowledge about a place in
the codebase* — conventions, constraints, gotchas. No decisions, just facts that
apply when you are working there. This is the right answer most of the time.

**It is a skill** if it is a *repeatable procedure* — the same steps in the same
order, run as part of somebody else's task, with the caller's permissions and
context. "How we cut a release", "how we add a migration."

**It is a new agent** only if at least one of these is true:

- it needs **different tool permissions** than whoever would call it — above all
  read-only versus write;
- it needs a **different model tier**, because the work is either too expensive
  for opus or too subtle for haiku;
- it needs a **clean context window**, because doing the work inline would flood
  the caller's context with material it does not need afterwards;
- it is **invoked on its own**, on a schedule or by the owner directly, rather
  than as a step inside another task.

If none of those hold, it is a skill or a rule file. Write it down in
`CHANGELOG.md` either way.

Naming: single lowercase noun describing the role, not the task
(`reviewer`, not `review-the-diff`). If a name needs an "and" in it, the job is
two jobs.

## What "read-only" actually means

Four of the five agents are marked read-only. That is enforced by withholding
`Edit` and `Write` in each agent's frontmatter — they cannot modify a file
through the normal path.

**They do still have `Bash`**, because the job needs it: `git log`, `git diff`,
`npm test`, `gh run view`, read-only queries. Bash can in principle write, so
"read-only" here means *structurally discouraged and constrained*, not sealed.
What backs it up is the `deny` list in `.claude/settings.json` — destructive
database commands, force pushes, `rm -rf`, production deploys, and writes to
`archive/` — plus the permission prompt on anything not pre-allowed.

If you want a genuinely sealed reviewer, remove `Bash` from its frontmatter and
hand it the diff as text instead. The trade is that it can no longer run the
tests it is judging.

## Known tension to resolve

`.claude/settings.local.json` (personal, gitignored) allows `gh pr merge` without
a prompt. The delegation rules above say every diff goes to `reviewer` before it
is committed. Those two can disagree: a merge can happen without a review having
occurred. Nothing here enforces the review gate — it is a convention, and the
allow rule makes it easy to skip by accident. Worth deciding deliberately rather
than discovering later.

## Weekly self-review

A read-only routine reviews this file against what actually happened, once a
week. The prompt lives in [`routines/weekly-self-review.md`](routines/weekly-self-review.md)
and is scheduled by the owner at `claude.ai/code/routines`.

It proposes; it never applies. Anything approved gets a dated entry in
`CHANGELOG.md` and an edit here.

## Cost defaults

haiku for triage and scanning · sonnet for implementation and review · opus only
for `assessor` and `architect`, both read-only and both invoked deliberately
rather than per-task. If an agent is being invoked constantly at opus, that is a
signal the work belongs one tier down.
