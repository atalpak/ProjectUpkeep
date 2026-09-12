"use client";

import { useMemo, useState } from "react";

import { PlaytestGapAnalysis } from "@/components/decks/PlaytestGapAnalysis";
import { PlaytestHand } from "@/components/decks/PlaytestHand";
import { PlaytestResults } from "@/components/decks/PlaytestResults";
import { cx, EmptyState, Field, Input } from "@/components/ui";
import type { DeckListEntry } from "@/lib/collection/queries";
import { defaultKeepRule, type KeepRule } from "@/lib/playtest/keep";
import { buildLibrary } from "@/lib/playtest/library";
import { clampInt, pluralizeCards } from "@/lib/playtest/present";

type Mode = "designed" | "built";

/**
 * The goldfishing consistency lab. Everything here runs client-side off the
 * one decklist load the server page hands over — no route, no server
 * action, so switching mode or nudging the keep rule is instant and never
 * round-trips.
 *
 * `buildLibrary` runs for *both* modes up front rather than only the active
 * one: the toggle needs both sizes to show "99 cards · 84 sleeved" and to
 * know whether the two are equal (deck fully assembled), regardless of which
 * one the user is currently looking at.
 */
export function Playtest({
  entries,
  commanderCardId,
}: {
  entries: DeckListEntry[];
  commanderCardId: string | null;
}) {
  const designed = useMemo(
    () => buildLibrary(entries, { mode: "designed", commanderCardId }),
    [entries, commanderCardId],
  );
  const built = useMemo(
    () => buildLibrary(entries, { mode: "built", commanderCardId }),
    [entries, commanderCardId],
  );

  const designedSize = designed.library.length + (designed.commander ? 1 : 0);
  const builtSize = built.library.length + (built.commander ? 1 : 0);
  const fullyAssembled = designedSize === builtSize;

  const [mode, setMode] = useState<Mode>("designed");
  const active = mode === "built" && !fullyAssembled ? built : designed;

  // A Commander deck plays a bigger library to the same seven-card hand than
  // a 60-card deck does, so both what counts as "enough lands" and how far a
  // game gets played out key off the deck's designed size — see
  // defaultKeepRule's own header. Switching mode changes what got drawn, not
  // what "consistent" means, so this stays fixed regardless of `mode`.
  const turns = designedSize >= 99 ? 12 : 8;
  const [rule, setRule] = useState<KeepRule>(() => defaultKeepRule(designedSize));

  function updateRule(patch: Partial<KeepRule>) {
    setRule((r) => ({ ...r, ...patch }));
  }

  // Which mode is actually driving the library right now (fullyAssembled
  // pins this to "designed" regardless of what the toggle shows), plus the
  // rule's own values — everything a cached simulation result depends on.
  // Used as a `key` below so a mode switch or a rule edit remounts the
  // results/gap components with a blank slate instead of an effect quietly
  // clearing state out from under them (see each component's own header).
  const activeMode = mode === "built" && !fullyAssembled ? "built" : "designed";
  const resultsKey = `${activeMode}-${rule.minLands}-${rule.maxLands}-${rule.requireCastableByTurn}`;

  if (designedSize === 0) {
    return (
      <EmptyState title="Nothing on this list yet">
        Add cards to the deck before playtesting it.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      <ModeToggle
        mode={mode}
        onChange={setMode}
        designedSize={designedSize}
        builtSize={builtSize}
        fullyAssembled={fullyAssembled}
      />

      {designed.skipped > 0 ? (
        <p className="text-xs text-ink-muted">
          {pluralizeCards(designed.skipped)} could not be simulated — no card data.
        </p>
      ) : null}

      <KeepRuleEditor rule={rule} onChange={updateRule} />

      <PlaytestHand key={activeMode} library={active.library} rule={rule} />

      <PlaytestResults
        key={resultsKey}
        library={active.library}
        commander={active.commander}
        rule={rule}
        turns={turns}
      />

      <p className="text-xs text-ink-muted">
        This goldfishes the deck alone — no opponent, no combat, nothing to interact with. It also
        can&apos;t see ramp, fetch lands, a modal double-faced card played as a land, or card
        selection (draw/dig effects) — anything it can&apos;t reason about is simply not modelled,
        which makes every number above a floor on how consistent the deck really is, never a
        ceiling.
      </p>

      {mode === "built" && !fullyAssembled && active.missing.length > 0 ? (
        <PlaytestGapAnalysis
          key={resultsKey}
          library={active.library}
          commander={active.commander}
          missing={active.missing}
          rule={rule}
          turns={turns}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

function ModeToggle({
  mode,
  onChange,
  designedSize,
  builtSize,
  fullyAssembled,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
  designedSize: number;
  builtSize: number;
  fullyAssembled: boolean;
}) {
  const options: Array<{ value: Mode; label: string }> = [
    { value: "designed", label: "As designed" },
    { value: "built", label: "As built" },
  ];

  return (
    <div className="space-y-1.5">
      <div
        className="inline-flex overflow-hidden rounded-md border border-border"
        role="group"
        aria-label="Playtest mode"
      >
        {options.map((option) => {
          const isActive = fullyAssembled ? option.value === "designed" : mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => !fullyAssembled && onChange(option.value)}
              aria-pressed={isActive}
              disabled={fullyAssembled}
              className={cx(
                "px-3.5 py-2 text-sm font-medium transition-colors coarse:min-h-11",
                isActive ? "bg-accent text-accent-ink" : "hover:bg-surface-muted",
                fullyAssembled && "cursor-not-allowed opacity-60",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs tabular-nums text-ink-muted">
        {pluralizeCards(designedSize)} · {builtSize} sleeved
      </p>

      {fullyAssembled ? (
        <p className="text-xs text-ink-muted">
          Every card on the list is sleeved, so &quot;as built&quot; would play identically — the
          toggle stays off until that changes.
        </p>
      ) : mode === "built" ? (
        <p className="text-xs text-ink-muted">
          Shuffling exactly what&apos;s physically in the box — a smaller library, so you&apos;ll
          see more of it each game. Missing cards are not swapped in for basics; they&apos;re just
          not there.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keep rule editor
// ---------------------------------------------------------------------------

function KeepRuleEditor({
  rule,
  onChange,
}: {
  rule: KeepRule;
  onChange: (patch: Partial<KeepRule>) => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold">Keep rule</h2>
        <p className="text-xs text-ink-muted">
          Keeping {rule.minLands}–{rule.maxLands} lands with something castable by turn{" "}
          {rule.requireCastableByTurn}.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Min lands">
          <Input
            type="number"
            min={0}
            max={7}
            value={rule.minLands}
            onChange={(e) => onChange({ minLands: clampInt(e.target.valueAsNumber, 0, 7) })}
          />
        </Field>
        <Field label="Max lands">
          <Input
            type="number"
            min={0}
            max={7}
            value={rule.maxLands}
            onChange={(e) => onChange({ maxLands: clampInt(e.target.valueAsNumber, 0, 7) })}
          />
        </Field>
        <Field label="Castable by turn">
          <Input
            type="number"
            min={1}
            max={7}
            value={rule.requireCastableByTurn ?? ""}
            onChange={(e) =>
              onChange({ requireCastableByTurn: clampInt(e.target.valueAsNumber, 1, 7) })
            }
          />
        </Field>
      </div>
    </div>
  );
}
