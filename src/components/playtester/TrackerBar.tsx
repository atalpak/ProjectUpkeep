"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { usePlayEnv, useUi } from "./context";
import { useExternal, useGame, usePlayStore } from "./hooks/useStore";
import { useWidth } from "./hooks/useWidth";
import { UndoRedo } from "./UndoRedo";
import { BoltIcon, HeartFillIcon, HeartIcon, KebabIcon, MenuIcon, NextIcon, SkullIcon, SparkIcon } from "./icons";
import { FloatingMenu } from "@/components/FloatingMenu";
import { ManaSymbol } from "@/components/ManaCost";
import { cx } from "@/lib/cx";
import { MANA_KEYS } from "@/lib/playtest/board/types";

/**
 * The top toolbar, under which the play area starts. It is ALWAYS one row.
 *
 * Left to right: the brand mark (back to the deck), the game menu, undo and redo,
 * life with a minus and a plus either side, the mana pool, then the save status,
 * the turn, Next turn and More. Right-click on life (or the context-menu key, or the dots button on
 * a touch screen) opens the other trackers: poison, experience, energy, the
 * second life total, damage and commander damage.
 *
 * The bar measures itself. Under `MANA_COLLAPSE_PX` the six mana counters fold
 * into one button that opens them in a panel below the bar; under
 * `LABELS_HIDE_PX` the words go and the icons stay. Nothing wraps.
 */

const MANA_COLLAPSE_PX = 900;
const LABELS_HIDE_PX = 640;
const STATUS_HIDE_PX = 1100;

const stepButton = "flex size-7 shrink-0 items-center justify-center rounded text-ink hover:bg-white/15 coarse:size-11";

/** A labelled row with minus, the value, plus and a way to type a number. */
function StepRow({ label, value, path, icon }: { label: string; value: number; path: string; icon: React.ReactNode }) {
  const store = usePlayStore();
  const set = (n: number) => store.dispatch({ type: "SET_TRACKER", path, value: n });
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{icon}{label}</span>
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => set(value - 1)} className={stepButton}>−</button>
      <button
        type="button"
        aria-label={`${label} ${value}. Set to a number`}
        onClick={() => {
          const n = prompt(`Set ${label}`, String(value));
          if (n !== null && n.trim() !== "" && Number.isFinite(Number(n))) set(Number(n));
        }}
        className="min-w-8 rounded px-1 text-center font-medium tabular-nums hover:bg-white/10 coarse:min-h-11"
      >
        {value}
      </button>
      <button type="button" aria-label={`Increase ${label}`} onClick={() => set(value + 1)} className={stepButton}>+</button>
    </div>
  );
}

const PANEL = "absolute top-full z-40 mt-2 w-72 space-y-2 rounded-lg border border-border bg-surface-raised p-3 text-ink shadow-[var(--shadow-raised)]";

function ManaPip({ letter }: { letter: string }) {
  return <ManaSymbol code={letter} className="size-5" />;
}

/** Life: minus, the value, plus. Right-click opens the other trackers. */
function Life({ onMore }: { onMore: () => void }) {
  const game = useGame();
  const store = usePlayStore();
  const value = game?.trackers.life ?? 0;
  const previous = useRef(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (previous.current === value) return;
    const direction = value > previous.current ? "up" : "down";
    previous.current = value;
    const show = window.setTimeout(() => setFlash(direction), 0);
    const hide = window.setTimeout(() => setFlash(null), 550);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [value]);
  const set = (n: number) => store.dispatch({ type: "SET_TRACKER", path: "life", value: n });
  return (
    <div
      className={cx("flex shrink-0 items-center rounded-lg", flash === "up" && "bg-success/30", flash === "down" && "bg-danger/30")}
      onContextMenu={(e) => {
        e.preventDefault();
        onMore();
      }}
    >
      <button type="button" aria-label="Decrease life" onClick={() => set(value - 1)} className={stepButton}>−</button>
      <button
        type="button"
        aria-label={`Life ${value}. Click to set a number, right-click for the other trackers`}
        title="Right-click for the other trackers"
        onClick={() => {
          const n = prompt("Set life", String(value));
          if (n !== null && n.trim() !== "" && Number.isFinite(Number(n))) set(Number(n));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            set(value + (e.key === "ArrowUp" ? 1 : -1));
          }
        }}
        className="flex items-center rounded-lg px-0.5 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus-ring coarse:min-h-11"
      >
        {/* The heart sits softly BEHIND the number: it costs no width of its own. */}
        <span className="relative inline-flex min-w-9 items-center justify-center">
          <HeartFillIcon className="pointer-events-none absolute size-9 text-[#e88fab] opacity-35" />
          <span key={value} className="pt-pop relative inline-block font-semibold tabular-nums">{value}</span>
        </span>
      </button>
      <button type="button" aria-label="Increase life" onClick={() => set(value + 1)} className={stepButton}>+</button>
      <button type="button" aria-label="Other trackers" onClick={onMore} className="hidden size-11 items-center justify-center rounded text-ink-muted hover:text-ink coarse:flex">
        <KebabIcon />
      </button>
    </div>
  );
}

/** One mana counter in the open bar: the pip and a count; press for its stepper. */
function ManaCounter({ letter, value, open, setOpen }: { letter: string; value: number; open: boolean; setOpen: (open: boolean) => void }) {
  const store = usePlayStore();
  const path = `manaPool.${letter}`;
  const set = (n: number) => store.dispatch({ type: "SET_TRACKER", path, value: n });
  return (
    <div data-counter={letter} className={cx("flex shrink-0 items-center rounded-lg text-sm", open ? "bg-surface-raised ring-1 ring-border-strong" : "hover:bg-white/10")}>
      {open ? <button type="button" aria-label={`Decrease ${letter} mana`} onClick={() => set(value - 1)} className={stepButton}>−</button> : null}
      <button
        type="button"
        aria-label={`${letter} mana ${value}. ${open ? "Close the stepper" : "Adjust"}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            set(value + (e.key === "ArrowUp" ? 1 : -1));
          }
        }}
        className="flex items-center gap-1 rounded-lg px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring coarse:min-h-11"
      >
        <ManaPip letter={letter} />
        <span key={value} className="pt-pop inline-block min-w-3 text-left font-medium tabular-nums">{value}</span>
      </button>
      {open ? <button type="button" aria-label={`Increase ${letter} mana`} onClick={() => set(value + 1)} className={stepButton}>+</button> : null}
    </div>
  );
}

function GameMenu({ iconOnly }: { iconOnly: boolean }) {
  const env = usePlayEnv();
  const items: Array<[string, string]> = [
    ["new-game", "New game"],
    ["saves", "Save and load"],
    ["share", "Share this table"],
    ["log", "Game log"],
    ["metrics", "Charts"],
    ["export", "Export the log"],
    ["settings", "Settings"],
    ["keybinds", "Keyboard shortcuts"],
  ];
  return (
    <FloatingMenu
      align="left"
      trigger={({ toggle, setTriggerRef, open }) => (
        <button
          ref={setTriggerRef}
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Game menu"
          className="flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-white/10 coarse:min-h-11"
        >
          <MenuIcon />
          {iconOnly ? null : "Game menu"}
        </button>
      )}
      panelClassName="w-56 rounded-xl border border-border bg-surface-raised p-1.5 text-ink shadow-[var(--shadow-raised)]"
    >
      {({ close }) => (
        <div role="menu" aria-label="Game menu">
          {items.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              onClick={() => {
                env.perform(id);
                close();
              }}
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-muted coarse:min-h-11"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </FloatingMenu>
  );
}

export function TrackerBar() {
  const game = useGame();
  const env = usePlayEnv();
  const store = usePlayStore();
  const status = useExternal(env.recovery, (s) => s);
  const paletteOpen = useUi((s) => s.dialog === "palette");
  const bar = useRef<HTMLDivElement>(null);
  const width = useWidth(bar);
  const [panel, setPanel] = useState<"trackers" | "mana" | null>(null);
  const [openMana, setOpenMana] = useState<string | null>(null);

  const measured = width > 0;
  const collapseMana = measured && width < MANA_COLLAPSE_PX;
  const iconOnly = measured && width < LABELS_HIDE_PX;
  const showStatus = !measured || width >= STATUS_HIDE_PX;

  // Escape or a press outside closes whatever is open above the bar.
  useEffect(() => {
    if (panel === null && openMana === null) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-tracker-panel]")) return;
      if (openMana !== null && target?.closest(`[data-counter="${openMana}"]`)) return;
      setPanel(null);
      setOpenMana(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPanel(null);
      setOpenMana(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [panel, openMana]);

  const manaTotal = game ? MANA_KEYS.reduce((sum, key) => sum + game.trackers.manaPool[key], 0) : 0;
  return (
    <div ref={bar} className="relative flex flex-nowrap items-center gap-x-2 overflow-visible border-b border-border bg-canvas px-3 py-1.5">
      <Link href={`/decks/${env.deckId}`} aria-label="Back to the deck" title="Back to the deck" className="flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-white/10 coarse:size-11">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="size-6" />
      </Link>
      <GameMenu iconOnly={iconOnly} />
      <UndoRedo />

      {game ? (
        <>
          <div className="relative shrink-0" data-tracker-panel>
            <Life onMore={() => setPanel(panel === "trackers" ? null : "trackers")} />
            {panel === "trackers" ? (
              <div className={cx(PANEL, "left-0")} role="group" aria-label="Other trackers">
                <StepRow label="Poison" value={game.trackers.poison} path="poison" icon={<SkullIcon />} />
                <StepRow label="Experience" value={game.trackers.experience} path="experience" icon={<SparkIcon />} />
                <StepRow label="Energy" value={game.trackers.energy} path="energy" icon={<BoltIcon />} />
                <StepRow label="Life 2" value={game.trackers.life2} path="life2" icon={<HeartIcon />} />
                <StepRow label="Damage" value={game.trackers.genericDamage} path="genericDamage" icon={<SkullIcon />} />
                {Object.entries(game.trackers.commanderDamage).map(([name, value]) => (
                  <StepRow key={name} label={`Damage from ${name}`} value={value} path={`commanderDamage.${name}`} icon={<SkullIcon />} />
                ))}
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1 text-sm hover:bg-white/10 coarse:min-h-11"
                  onClick={() => {
                    const name = prompt("Opposing commander name");
                    if (name?.trim()) store.dispatch({ type: "SET_TRACKER", path: `commanderDamage.${name.trim()}`, value: 1 });
                  }}
                >
                  Add commander damage
                </button>
              </div>
            ) : null}
          </div>

          <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />

          {collapseMana ? (
            <div className="relative shrink-0" data-tracker-panel>
              <button
                type="button"
                aria-expanded={panel === "mana"}
                aria-label={`Mana pool, ${manaTotal} in total`}
                onClick={() => setPanel(panel === "mana" ? null : "mana")}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm hover:bg-white/10 coarse:min-h-11"
              >
                <ManaPip letter="C" />
                <span className="tabular-nums">{manaTotal}</span>
                {iconOnly ? null : <span className="text-ink-muted">Mana</span>}
              </button>
              {panel === "mana" ? (
                <div className={cx(PANEL, "left-0")} role="group" aria-label="Mana pool">
                  {MANA_KEYS.map((key) => (
                    <StepRow key={key} label={`${key} mana`} value={game.trackers.manaPool[key]} path={`manaPool.${key}`} icon={<ManaPip letter={key} />} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-x-1">
              {MANA_KEYS.map((key) => (
                <ManaCounter key={key} letter={key} value={game.trackers.manaPool[key]} open={openMana === key} setOpen={(open) => setOpenMana(open ? key : null)} />
              ))}
            </div>
          )}
        </>
      ) : null}

      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2">
        {showStatus ? (
          <span className="max-w-64 truncate text-xs text-ink-muted" role="status">
            {status.state === "saved" ? "Saved locally" : status.state === "off" ? "Crash recovery is off in this browser — save to your account to keep this game." : ""}
          </span>
        ) : null}
        {game && !iconOnly ? <span className="text-xs text-ink-muted tabular-nums">Turn {game.turn}</span> : null}
        <button
          type="button"
          onClick={() => env.perform("next-turn")}
          disabled={!game || game.opening.status !== "kept"}
          aria-label="Next turn"
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-50 coarse:min-h-11"
        >
          <NextIcon /> {iconOnly ? null : "Next turn"}
        </button>
        <button
          type="button"
          onClick={() => env.perform("palette")}
          aria-expanded={paletteOpen}
          aria-label="More"
          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-white/10 coarse:min-h-11"
        >
          <KebabIcon /> {iconOnly ? null : "More"}
        </button>
      </div>
    </div>
  );
}
