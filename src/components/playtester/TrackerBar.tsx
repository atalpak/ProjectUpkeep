"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { usePlayEnv, useUi } from "./context";
import { useExternal, useGame, usePlayStore } from "./hooks/useStore";
import { BoltIcon, HeartIcon, KebabIcon, MenuIcon, NextIcon, SkullIcon, SparkIcon } from "./icons";
import { FloatingMenu } from "@/components/FloatingMenu";
import { ManaSymbol } from "@/components/ManaCost";
import { cx } from "@/lib/cx";
import { MANA_KEYS } from "@/lib/playtest/board/types";

/**
 * The bottom toolbar: the brand mark (back to the deck), the game menu, the
 * counters, Next turn and More.
 *
 * A counter reads as a small pill, icon and value. Pressing it opens the
 * stepper in place (minus, plus, set a number); ArrowUp and ArrowDown adjust it
 * without opening. Only one is open at a time and Escape or a press elsewhere
 * closes it. Every counter keeps a real button for each of its actions, so a
 * keyboard or a finger can do everything a mouse can.
 */

/** The real mana symbol (the same Scryfall art the rest of the app draws). */
function ManaDot({ letter }: { letter: string }) {
  return <ManaSymbol code={letter} className="size-5" />;
}

type CounterProps = {
  id: string;
  label: string;
  value: number;
  path: string;
  icon: React.ReactNode;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  flash?: boolean;
};

function Counter({ id, label, value, path, icon, openId, setOpenId, flash }: CounterProps) {
  const store = usePlayStore();
  const previous = useRef(value);
  const [direction, setDirection] = useState<"up" | "down" | null>(null);
  const open = openId === id;
  useEffect(() => {
    if (previous.current === value) return;
    const dir = value > previous.current ? "up" : "down";
    previous.current = value;
    if (!flash) return;
    const show = window.setTimeout(() => setDirection(dir), 0);
    const hide = window.setTimeout(() => setDirection(null), 550);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [value, flash]);
  const set = (n: number) => store.dispatch({ type: "SET_TRACKER", path, value: n });
  const step = "flex size-7 items-center justify-center rounded text-ink hover:bg-white/15 coarse:size-11";

  return (
    <div
      data-counter={id}
      className={cx(
        "flex items-center rounded-lg text-sm",
        open ? "bg-surface-raised ring-1 ring-border-strong" : "hover:bg-white/10",
        direction === "up" && "bg-success/30",
        direction === "down" && "bg-danger/30",
      )}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpenId(null);
        }
      }}
    >
      {open ? (
        <button type="button" aria-label={`Decrease ${label}`} onClick={() => set(value - 1)} className={step}>
          −
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`${label} ${value}. ${open ? "Close the stepper" : "Adjust"}`}
        aria-expanded={open}
        onClick={() => setOpenId(open ? null : id)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            set(value + (e.key === "ArrowUp" ? 1 : -1));
          }
        }}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus-ring coarse:min-h-11"
      >
        {icon}
        <span key={value} className="pt-pop inline-block min-w-4 text-left font-medium tabular-nums">
          :{value}
        </span>
      </button>
      {open ? (
        <>
          <button type="button" aria-label={`Increase ${label}`} onClick={() => set(value + 1)} className={step}>
            +
          </button>
          <button
            type="button"
            aria-label={`Set ${label} to a number`}
            onClick={() => {
              const n = prompt(`Set ${label}`, String(value));
              if (n !== null && n.trim() !== "" && Number.isFinite(Number(n))) set(Number(n));
            }}
            className="rounded px-2 text-xs text-ink-muted hover:text-ink coarse:min-h-11"
          >
            Set…
          </button>
        </>
      ) : null}
    </div>
  );
}

function GameMenu() {
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
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-white/10 coarse:min-h-11"
        >
          <MenuIcon />
          Game menu
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
  const [openId, setOpenId] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openId === null) return;
    const onDown = (event: PointerEvent) => {
      const el = event.target instanceof Element ? event.target.closest("[data-counter]") : null;
      if (!el || el.getAttribute("data-counter") !== openId) setOpenId(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [openId]);

  const shared = { openId, setOpenId };
  return (
    <div ref={bar} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-canvas px-3 py-1.5">
      <div className="flex items-center gap-1 order-1">
        <Link href={`/decks/${env.deckId}`} aria-label="Back to the deck" title="Back to the deck" className="flex size-9 items-center justify-center rounded-lg hover:bg-white/10 coarse:size-11">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="size-6" />
        </Link>
        <GameMenu />
      </div>
      <div className="order-3 flex min-w-0 basis-full flex-wrap items-center gap-x-1 gap-y-1 2xl:order-2 2xl:flex-1 2xl:basis-0">
        {game ? (
          <>
            <Counter id="life" label="Life" value={game.trackers.life} path="life" icon={<HeartIcon />} flash {...shared} />
            <Counter id="poison" label="Poison" value={game.trackers.poison} path="poison" icon={<SkullIcon />} {...shared} />
            <Counter id="experience" label="Experience" value={game.trackers.experience} path="experience" icon={<SparkIcon />} {...shared} />
            <Counter id="energy" label="Energy" value={game.trackers.energy} path="energy" icon={<BoltIcon />} {...shared} />
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            {MANA_KEYS.map((key) => (
              <Counter key={key} id={`mana-${key}`} label={`${key} mana`} value={game.trackers.manaPool[key]} path={`manaPool.${key}`} icon={<ManaDot letter={key} />} {...shared} />
            ))}
            <details className="relative text-sm">
              <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg px-2 py-1.5 text-ink-muted hover:bg-white/10 hover:text-ink coarse:min-h-11">
                <KebabIcon /> Other trackers
              </summary>
              <div className="absolute bottom-full left-0 z-40 min-w-64 space-y-2 rounded-lg border border-border bg-surface-raised p-3 shadow-[var(--shadow-raised)]">
                <Counter id="life2" label="Life 2" value={game.trackers.life2} path="life2" icon={<HeartIcon />} {...shared} />
                <Counter id="damage" label="Damage" value={game.trackers.genericDamage} path="genericDamage" icon={<SkullIcon />} {...shared} />
                {Object.entries(game.trackers.commanderDamage).map(([name, value]) => (
                  <div key={name} className="flex items-center gap-2 text-xs text-ink-muted">
                    <span className="min-w-0 flex-1 truncate">Damage from {name}</span>
                    <Counter id={`cmdr-${name}`} label={`Damage from ${name}`} value={value} path={`commanderDamage.${name}`} icon={<SkullIcon />} {...shared} />
                  </div>
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
            </details>
          </>
        ) : null}
      </div>
      <div className="order-2 ml-auto flex items-center gap-2 2xl:order-3">
        <span className="max-w-64 max-sm:hidden text-xs text-ink-muted" role="status">
          {status.state === "saved" ? "Saved locally" : status.state === "off" ? "Crash recovery is off in this browser — save to your account to keep this game." : ""}
        </span>
        <button
          type="button"
          onClick={() => env.perform("next-turn")}
          disabled={!game || game.opening.status !== "kept"}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-50 coarse:min-h-11"
        >
          <NextIcon /> Next turn
        </button>
        <button
          type="button"
          onClick={() => env.perform("palette")}
          aria-expanded={paletteOpen}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-white/10 coarse:min-h-11"
        >
          <KebabIcon /> More
        </button>
      </div>
    </div>
  );
}
