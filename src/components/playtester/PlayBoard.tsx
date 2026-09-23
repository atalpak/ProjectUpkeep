"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ActionLog } from "@/components/playtester/ActionLog";
import { Battlefield } from "@/components/playtester/Battlefield";
import { GameControls } from "@/components/playtester/GameControls";
import { Hand } from "@/components/playtester/Hand";
import { TokenForm } from "@/components/playtester/TokenForm";
import { SingleCardZone, ZonePile } from "@/components/playtester/ZonePile";
import { Button, Input } from "@/components/ui";
import type { DeckListEntry } from "@/lib/collection/queries";
import type { GameCommand } from "@/lib/playtest/board/commands";
import { emptyHistory, record, redo as historyRedo, undo as historyUndo, type History } from "@/lib/playtest/board/history";
import { applyCommand } from "@/lib/playtest/board/reduce";
import type { GameState } from "@/lib/playtest/board/types";
import { createGameStart } from "@/lib/playtest/game-start";

/**
 * The tactile solo tabletop's client-side owner (plan section 4.1). Holds the
 * `GameState`, the bounded undo/redo stack (`board/history.ts`), and the
 * London-mulligan opening-hand flow, and dispatches every board change
 * through `applyCommand` — nothing here mutates `GameState` directly.
 *
 * No request per draw, tap or move (plan section 4.5): this component never
 * calls Supabase. `entries`/`commanderCardId` arrive once, server-loaded, as
 * plain props; `game-start.ts` (already Phase 1, already tested) is the only
 * place a fresh `GameState` gets built from them.
 */
export function PlayBoard({
  deckId,
  deckName,
  entries,
  commanderCardId,
}: {
  deckId: string;
  deckName: string;
  entries: DeckListEntry[];
  commanderCardId: string | null;
}) {
  const [state, setState] = useState<GameState | null>(null);
  const [history, setHistory] = useState<History>(emptyHistory());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tokenFormOpen, setTokenFormOpen] = useState(false);

  // London mulligan: how many cards this session's next confirmed hand must
  // put on the bottom (one more per mulligan taken, capped at hand size —
  // the same rule PlaytestHand.tsx already implements for the analyzer), and
  // which of the current seven are selected for it. `null` outside the
  // selection step.
  const [mulliganCount, setMulliganCount] = useState(0);
  const [bottomSelected, setBottomSelected] = useState<Set<string> | null>(null);
  const [drawCountText, setDrawCountText] = useState("1");

  const startNewGame = useCallback(() => {
    const fresh = createGameStart({ deckId, commanderCardId, entries });
    const openingHandSize = Math.min(7, fresh.zones.library.length);
    const dealt = applyCommand(fresh, { type: "DRAW", count: openingHandSize });
    setState(dealt);
    setHistory(emptyHistory());
    setSelectedId(null);
    setMulliganCount(0);
    setBottomSelected(null);
  }, [deckId, commanderCardId, entries]);

  // Every user action reads `state`/`history` from the closure and writes
  // both in one go, rather than nesting a `setHistory` call inside a
  // `setState` updater — React may invoke a state updater more than once
  // per commit (Strict Mode's double-invoke), which would silently double
  // every history entry if recording it were a side effect of computing the
  // next state instead of a sibling of it.
  const dispatch = useCallback(
    (command: GameCommand) => {
      if (!state) return;
      setHistory((h) => record(h, state));
      setState(applyCommand(state, command));
    },
    [state],
  );

  const undo = useCallback(() => {
    if (!state) return;
    const result = historyUndo(history, state);
    if (!result) return;
    setHistory(result.history);
    setState(result.state);
  }, [state, history]);

  const redo = useCallback(() => {
    if (!state) return;
    const result = historyRedo(history, state);
    if (!result) return;
    setHistory(result.history);
    setState(result.state);
  }, [state, history]);

  // Mulligan: return the whole hand to the library, reshuffle with a fresh
  // seed, and deal seven again. One combined undo step (recorded once,
  // against the hand as it stood before the mulligan) rather than one per
  // card moved — an undo here should read as "cancel that mulligan", not
  // require pressing it seven times.
  const mulligan = useCallback(() => {
    if (!state) return;
    let next = state;
    for (const cardId of [...state.zones.hand]) {
      next = applyCommand(next, { type: "MOVE_CARD", cardId, to: "library", index: null });
    }
    const seed = Math.floor(Math.random() * 0x7fffffff);
    next = applyCommand(next, { type: "SHUFFLE", zone: "library", seed });
    const openingHandSize = Math.min(7, next.zones.library.length);
    next = applyCommand(next, { type: "DRAW", count: openingHandSize });
    setHistory((h) => record(h, state));
    setMulliganCount((n) => n + 1);
    setBottomSelected(new Set());
    setState(next);
  }, [state]);

  const toBottom = state ? Math.min(mulliganCount, state.zones.hand.length) : 0;

  const confirmBottom = useCallback(() => {
    if (!state || !bottomSelected) return;
    let next = state;
    for (const cardId of bottomSelected) {
      next = applyCommand(next, { type: "MOVE_CARD", cardId, to: "library", index: null });
    }
    setHistory((h) => record(h, state));
    setBottomSelected(null);
    setState(next);
  }, [state, bottomSelected]);

  // Keyboard: Escape clears selection (interaction contract, plan 3.4);
  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo/redo from anywhere on the board.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedId(null);
        return;
      }
      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const bottomSelection = useMemo(
    () =>
      bottomSelected
        ? {
            toBottom,
            selected: bottomSelected,
            onToggle: (cardId: string) => {
              setBottomSelected((prev) => {
                if (!prev) return prev;
                const next = new Set(prev);
                if (next.has(cardId)) next.delete(cardId);
                else if (next.size < toBottom) next.add(cardId);
                return next;
              });
            },
          }
        : null,
    [bottomSelected, toBottom],
  );

  if (!state) {
    return (
      <div className="rounded-2xl border border-dashed border-border-strong p-10 text-center">
        <p className="font-medium">Playing the {entries.reduce((n, e) => n + e.quantity, 0)}-card list</p>
        <p className="mt-1 text-sm text-ink-muted">
          Starts from {deckName}&apos;s full decklist, not just what&apos;s sleeved — this never changes your
          collection or deck list.
        </p>
        <Button type="button" onClick={startNewGame} className="mt-4">
          New game
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <GameControls
        state={state}
        history={history}
        dispatch={dispatch}
        onUndo={undo}
        onRedo={redo}
        onMulligan={mulligan}
        onNewGame={startNewGame}
        mulliganDisabled={bottomSelection !== null}
      />

      {bottomSelection ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent-text/40 bg-surface-muted px-3 py-2">
          <p className="text-sm">
            Mulligan to {state.zones.hand.length - bottomSelection.toBottom}: put {bottomSelection.toBottom} card
            {bottomSelection.toBottom === 1 ? "" : "s"} on the bottom of the library. Selected{" "}
            {bottomSelection.selected.size} of {bottomSelection.toBottom}.
          </p>
          <Button type="button" onClick={confirmBottom} disabled={bottomSelection.selected.size !== bottomSelection.toBottom}>
            Confirm
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[13rem_1fr_13rem]">
        <div className="space-y-3">
          <ZonePile
            zone="library"
            label="Library"
            state={state}
            dispatch={dispatch}
            onDrop={(cardId) => dispatch({ type: "MOVE_CARD", cardId, to: "library", index: 0 })}
            extraActions={
              <>
                <Button type="button" variant="secondary" onClick={() => dispatch({ type: "DRAW", count: 1 })}>
                  Draw 1
                </Button>
                <span className="inline-flex items-center gap-1">
                  <Input
                    aria-label="Number of cards to draw"
                    type="number"
                    min={1}
                    value={drawCountText}
                    onChange={(e) => setDrawCountText(e.target.value.replace(/\D/g, ""))}
                    className="!h-8 w-14 !px-1.5 text-center text-xs"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const n = Math.max(1, Number.parseInt(drawCountText, 10) || 0);
                      dispatch({ type: "DRAW", count: n });
                    }}
                  >
                    Draw N
                  </Button>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => dispatch({ type: "SHUFFLE", zone: "library", seed: Math.floor(Math.random() * 0x7fffffff) })}
                >
                  Shuffle
                </Button>
              </>
            }
          />
          <SingleCardZone zone="command" label="Command zone" state={state} dispatch={dispatch} />
        </div>

        <Battlefield state={state} dispatch={dispatch} selectedId={selectedId} onSelect={setSelectedId} />

        <div className="space-y-3">
          <ZonePile
            zone="graveyard"
            label="Graveyard"
            state={state}
            dispatch={dispatch}
            onDrop={(cardId) => dispatch({ type: "MOVE_CARD", cardId, to: "graveyard", index: null })}
          />
          <ZonePile
            zone="exile"
            label="Exile"
            state={state}
            dispatch={dispatch}
            onDrop={(cardId) => dispatch({ type: "MOVE_CARD", cardId, to: "exile", index: null })}
          />
        </div>
      </div>

      <Hand state={state} dispatch={dispatch} selectedId={selectedId} onSelect={setSelectedId} bottomSelection={bottomSelection} />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => setTokenFormOpen(true)}>
          Create token
        </Button>
      </div>

      <ActionLog state={state} />

      <TokenForm open={tokenFormOpen} onClose={() => setTokenFormOpen(false)} dispatch={dispatch} />
    </div>
  );
}
