# Weekly self-review routine

Paste the block below into a new routine at `claude.ai/code/routines`, pointed at
the `atalpak/ProjectUpkeep` repository. Suggested schedule: **weekly, Monday
morning.** It is read-only and reports back; it never changes the repo.

Kept here in version control so the prompt itself is reviewable and has a history.

---

```
You are running a weekly, READ-ONLY review of the agent setup in this repository
(atalpak/ProjectUpkeep). Report your findings. Change nothing — do not edit
files, do not open a pull request, do not commit. Proposing is the entire job.

Start by reading:
  - .claude/ORGANIZATION.md   the roster, delegation and escalation rules
  - .claude/CHANGELOG.md      every change to this setup, dated
  - .claude/agents/*.md       the five agent briefs
  - CLAUDE.md                 the application facts and hard constraints

Then produce three sections.

────────────────────────────────────────
SECTION 1 — Is the roster still the right shape?

The evidence available to you is the repository itself: git log since the last
review, merged pull requests, CI runs, and the CHANGELOG. You CANNOT see session
transcripts, so you cannot directly observe which agents were invoked or how
often. Do not pretend otherwise. Infer from the shape of the work that landed,
and label every inference as an inference.

Answer:

  a) Does any agent look idle? If the work that landed never needed impact
     mapping, or never needed cheap triage, say so — a role nobody uses costs
     context on every session and should be retired or merged.

  b) Is any one agent's job visibly splitting in two? The signal is a brief that
     has to say "and" a lot, or work that consistently needs two different
     modes from the same agent. Apply the three-way test in ORGANIZATION.md
     ("When is something a new agent?") before proposing a new one — most
     answers are a rule file or a skill, not an agent.

  c) Do the delegation rules match what actually happened? If structural changes
     went straight to implementation without an impact map, either the rule is
     wrong or it is being skipped. Both are worth knowing, and they have
     different fixes.

  d) Is anything in CLAUDE.md now false? Specifically check the directory map
     against the real tree and the hard-constraints list against the code. A
     stale map is how the previous documentation failed, and it fails silently.

────────────────────────────────────────
SECTION 2 — Has the ground moved underneath this setup?

This configuration depends on Anthropic features that were experimental or in
research preview when it was built on 2026-09-09: Agent Teams (enabled by the
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS environment variable in
.claude/settings.json), Routines, and Claude Code on the web.

Check the current Claude Code documentation and release notes for changes that
affect this repo specifically:

  - Has the Agent Teams flag graduated, been renamed, or been removed?
  - Has the .claude/agents/ frontmatter schema changed — the tools, model or
    description fields?
  - Do .claude/rules/*.md files with `paths:` frontmatter auto-load on a matching
    path? THIS WAS NEVER CONFIRMED. It was assumed when the setup was built, and
    the rules are also linked by path from CLAUDE.md so they work either way.
    If you can now confirm or refute it, that is a genuinely useful finding.
  - Have the permission-rule patterns in .claude/settings.json changed shape?
  - Are the model names in the agent files still current?

Report only what actually affects this configuration. A general feature
announcement that changes nothing here is not a finding.

────────────────────────────────────────
SECTION 3 — Is a full product assessment due?

The `assessor` agent exists to answer "what should we build next" from evidence.
It is expensive and should not run weekly out of habit.

Say whether it looks worth running now, and why. Reasons it might be: the app
gained real users; a release landed that changes what the product is; something
in CI or the Scryfall sync has been failing repeatedly; or nothing has been
built in weeks and direction has drifted. If none of those apply, say "not this
week" and stop — that is a perfectly good answer.

────────────────────────────────────────
OUTPUT

A short list of proposed changes, most consequential first. For each: what to
change, why, and what it replaces. A few lines each — this is an ADR entry, not
an essay.

If nothing needs changing, say so plainly and briefly. Do not manufacture
proposals to justify the run; a quiet week is a real result and reporting it
honestly is what keeps this routine worth reading.

End with the reminder that nothing has been applied, and that any change the
owner approves needs a dated entry in .claude/CHANGELOG.md and an update to
.claude/ORGANIZATION.md.
```
