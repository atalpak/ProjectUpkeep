/**
 * Player preferences for the table: sizes, hand behaviour, labels, motion,
 * colours. Kept apart from a game snapshot on purpose (the guide's rule): a
 * setting describes how YOU like to look at a table, a snapshot describes one
 * game, and loading someone's saved game must never change your card size.
 * Stored in localStorage only, per user (recovery.ts `prefsKey`); nothing here
 * goes to the database.
 *
 * `sanitizeSettings` accepts anything (a stored blob from an older build, a
 * hand-edited value) and returns a complete, valid settings object, so a bad
 * or partial value degrades to the default for that one field, never to a
 * crash. The two choices that could hide the game from its own player are
 * bounded: the hand can be hidden but is never removed from the keyboard or
 * the "Hand" overlay, and reduced motion only ever REMOVES animation.
 */

export type CardSize = "small" | "medium" | "large";
export type HandClickMode = "play" | "menu";
export type MotionPref = "system" | "reduce";

/** Playmat and sleeve colours. Named after their role, not a hex, so both
 *  themes can map them: the values are Tailwind-token-free CSS colours chosen
 *  to sit on Upkeep's dark and light tables. */
export const PLAYMATS = {
  ink: { label: "Ink", value: "#141310" },
  felt: { label: "Green felt", value: "#16241b" },
  slate: { label: "Slate", value: "#1b2029" },
  leather: { label: "Leather", value: "#261c14" },
  parchment: { label: "Parchment", value: "#e9dfcb" },
} as const;

export const SLEEVES = {
  ochre: { label: "Ochre", value: "#c9a34a" },
  plum: { label: "Plum", value: "#463a52" },
  forest: { label: "Forest", value: "#3e6046" },
  ember: { label: "Ember", value: "#a8432e" },
  ocean: { label: "Ocean", value: "#3f6ea6" },
} as const;

export type Settings = {
  cardSize: CardSize;
  /** Hand card width, independent of the table's. */
  handSize: CardSize;
  autoSize: boolean;
  handClick: HandClickMode;
  handHover: boolean;
  maxVisibleHand: number;
  countersOnTop: boolean;
  motion: MotionPref;
  playmat: keyof typeof PLAYMATS;
  sleeve: keyof typeof SLEEVES;
  /** Show the "Upkeep" reminder in the turn banner before the draw. */
  upkeepReminder: boolean;
  shuffleOnClose: boolean;
  keepSearchOpenWhileDragging: boolean;
  showInteractionLog: boolean;
  /** A docked card-detail column beside the table (wide windows only). */
  cardDetails: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  cardSize: "medium",
  handSize: "medium",
  autoSize: true,
  handClick: "menu",
  handHover: true,
  maxVisibleHand: 12,
  countersOnTop: true,
  motion: "system",
  playmat: "ink",
  sleeve: "ochre",
  upkeepReminder: false,
  shuffleOnClose: true,
  keepSearchOpenWhileDragging: false,
  showInteractionLog: false,
  cardDetails: true,
};

const SIZES: readonly CardSize[] = ["small", "medium", "large"];

function pickKey<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function sanitizeSettings(input: unknown): Settings {
  const r = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const d = DEFAULT_SETTINGS;
  const max = typeof r.maxVisibleHand === "number" && Number.isFinite(r.maxVisibleHand) ? Math.min(Math.max(Math.trunc(r.maxVisibleHand), 4), 40) : d.maxVisibleHand;
  return {
    cardSize: pickKey(r.cardSize, SIZES, d.cardSize),
    handSize: pickKey(r.handSize, SIZES, d.handSize),
    autoSize: bool(r.autoSize, d.autoSize),
    handClick: pickKey(r.handClick, ["play", "menu"] as const, d.handClick),
    handHover: bool(r.handHover, d.handHover),
    maxVisibleHand: max,
    countersOnTop: bool(r.countersOnTop, d.countersOnTop),
    motion: pickKey(r.motion, ["system", "reduce"] as const, d.motion),
    playmat: pickKey(r.playmat, Object.keys(PLAYMATS) as Array<keyof typeof PLAYMATS>, d.playmat),
    sleeve: pickKey(r.sleeve, Object.keys(SLEEVES) as Array<keyof typeof SLEEVES>, d.sleeve),
    upkeepReminder: bool(r.upkeepReminder, d.upkeepReminder),
    shuffleOnClose: bool(r.shuffleOnClose, d.shuffleOnClose),
    keepSearchOpenWhileDragging: bool(r.keepSearchOpenWhileDragging, d.keepSearchOpenWhileDragging),
    showInteractionLog: bool(r.showInteractionLog, d.showInteractionLog),
    cardDetails: bool(r.cardDetails, d.cardDetails),
  };
}

/** Table card width as a fraction of the board width, per size. The board is
 *  drawn at a fixed CARD_W in the proportional space (board/layout.ts); this
 *  only scales what that space is DISPLAYED at, via a CSS transform, so a
 *  larger card never changes a saved position. */
export const CARD_SCALE: Record<CardSize, number> = { small: 0.8, medium: 1, large: 1.25 };

/** Should animation run? Only ever a way to turn motion OFF: the OS-level
 *  reduced-motion preference always wins, and the in-app "reduce" setting adds
 *  to it. There is deliberately no "force animations on". */
export function animationsEnabled(motion: MotionPref, systemPrefersReduced: boolean): boolean {
  return motion !== "reduce" && !systemPrefersReduced;
}
