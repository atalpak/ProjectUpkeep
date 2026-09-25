/**
 * The action catalogue behind the command palette AND the shortcut sheet.
 *
 * One list serves both on purpose: the palette (`/` or Ctrl/Cmd-K) lets you
 * type "draw 3", "search library", "add +1/+1 counter" and see every action
 * that exists, and the shortcut reference is just the subset of this list that
 * has a key. Two lists would drift, and a shortcut nobody can discover is
 * decoration. This module is pure (strings in, matches out): the UI owns what
 * each action id DOES, so nothing here can touch the game.
 *
 * Shortcuts never fire while a text field is focused; that is the UI's check
 * (it knows about focus), `resolveShortcut` only maps a key press to an id.
 */

export type ActionGroup = "Library" | "Hand" | "Battlefield" | "Turn" | "Trackers" | "Game" | "View";

export type PaletteAction = {
  id: string;
  label: string;
  group: ActionGroup;
  /** Extra words that should find this action. */
  keywords?: string[];
  /** Shown in the palette and the reference sheet. */
  shortcut?: string;
  /** A short plain-language example, e.g. "draw 3". */
  example?: string;
};

export const PALETTE_ACTIONS: PaletteAction[] = [
  { id: "draw", label: "Draw a card", group: "Library", keywords: ["draw one"], shortcut: "D", example: "draw 3" },
  { id: "draw-n", label: "Draw cards…", group: "Library", keywords: ["draw x"], example: "draw 3" },
  { id: "shuffle", label: "Shuffle library", group: "Library", shortcut: "S" },
  { id: "search-library", label: "Search library", group: "Library", keywords: ["tutor", "find", "look through"], shortcut: "F" },
  { id: "peek-top", label: "Look at the top cards…", group: "Library", keywords: ["scry", "peek"], example: "peek 4" },
  { id: "peek-bottom", label: "Look at the bottom cards…", group: "Library", example: "peek bottom 2" },
  { id: "mill", label: "Mill cards…", group: "Library", example: "mill 3" },
  { id: "random-draw", label: "Draw a random card from the library", group: "Library" },
  { id: "top-to-graveyard", label: "Move the top card to the graveyard", group: "Library" },

  { id: "hand-overlay", label: "Show the whole hand", group: "Hand", keywords: ["full hand"], shortcut: "H" },
  { id: "hand-hide", label: "Hide / show the hand", group: "Hand", keywords: ["cover"] },
  { id: "hand-random-discard", label: "Discard a random card", group: "Hand" },
  { id: "hand-sort-name", label: "Sort hand by name", group: "Hand" },
  { id: "hand-sort-type", label: "Sort hand by type", group: "Hand" },
  { id: "hand-sort-color", label: "Sort hand by colour", group: "Hand" },
  { id: "hand-sort-mv", label: "Sort hand by mana value", group: "Hand", keywords: ["cmc"] },
  { id: "hand-all-to-graveyard", label: "Move the whole hand to the graveyard", group: "Hand" },
  { id: "hand-all-to-library", label: "Shuffle the hand into the library", group: "Hand" },

  { id: "tap-toggle", label: "Tap / untap selected", group: "Battlefield", shortcut: "T" },
  { id: "untap-all", label: "Untap all", group: "Battlefield", shortcut: "U" },
  { id: "tap-all", label: "Tap all", group: "Battlefield" },
  { id: "select-all", label: "Select every card on the battlefield", group: "Battlefield", shortcut: "A" },
  { id: "clear-selection", label: "Clear selection", group: "Battlefield", shortcut: "Esc" },
  { id: "tidy", label: "Tidy the battlefield (lands, creatures, other)", group: "Battlefield", keywords: ["arrange", "sort", "organise"], shortcut: "Shift+T" },
  { id: "group", label: "Group selected cards", group: "Battlefield", shortcut: "Ctrl+G" },
  { id: "ungroup", label: "Ungroup selected cards", group: "Battlefield", shortcut: "Ctrl+Shift+G" },
  { id: "to-graveyard", label: "Send selected to the graveyard", group: "Battlefield", shortcut: "G" },
  { id: "to-exile", label: "Send selected to exile", group: "Battlefield", shortcut: "E" },
  { id: "to-hand", label: "Return selected to hand", group: "Battlefield", shortcut: "R" },
  { id: "to-library-top", label: "Put selected on top of the library", group: "Battlefield", shortcut: "L" },
  { id: "to-library-bottom", label: "Put selected on the bottom of the library", group: "Battlefield", shortcut: "B" },
  { id: "add-counter", label: "Add a counter to selected…", group: "Battlefield", keywords: ["counter", "+1/+1", "loyalty"], shortcut: "+", example: "add +1/+1 counter" },
  { id: "remove-counter", label: "Remove a +1/+1 counter from selected", group: "Battlefield", shortcut: "-" },
  { id: "proliferate", label: "Proliferate all counters", group: "Battlefield", shortcut: "P" },
  { id: "copy-token", label: "Make a token copy of selected", group: "Battlefield", keywords: ["clone"], shortcut: "C" },
  { id: "delete", label: "Remove selected tokens from the game", group: "Battlefield", shortcut: "Delete" },
  { id: "create-token", label: "Create a token or extra card…", group: "Battlefield", keywords: ["add card", "custom"], shortcut: "K" },

  { id: "next-turn", label: "Next turn (untap, then draw)", group: "Turn", shortcut: "N" },
  { id: "roll", label: "Roll a die or flip a coin…", group: "Turn", keywords: ["dice", "coin", "flip"], example: "roll d20" },
  { id: "set-turn", label: "Set the turn number…", group: "Turn", example: "turn 5" },

  { id: "life-set", label: "Set life…", group: "Trackers", example: "life 30" },
  { id: "tracker-poison", label: "Set poison counters…", group: "Trackers", example: "poison 3" },
  { id: "tracker-energy", label: "Set energy…", group: "Trackers", example: "energy 2" },
  { id: "tracker-experience", label: "Set experience…", group: "Trackers", example: "experience 4" },

  { id: "undo", label: "Undo", group: "Game", shortcut: "Ctrl+Z" },
  { id: "redo", label: "Redo", group: "Game", shortcut: "Ctrl+Shift+Z" },
  { id: "new-game", label: "Start a new game", group: "Game", keywords: ["restart", "mulligan"] },
  { id: "save", label: "Save this game to my account…", group: "Game", shortcut: "Ctrl+S" },
  { id: "saves", label: "Open my saved games", group: "Game", keywords: ["load", "restore"] },
  { id: "log", label: "Open the full log", group: "Game", keywords: ["history"], shortcut: "O" },
  { id: "metrics", label: "Open charts and metrics", group: "Game", keywords: ["stats"] },
  { id: "export", label: "Export the log", group: "Game", keywords: ["download", "copy"] },
  { id: "share", label: "Share this table…", group: "Game", keywords: ["link", "popout", "pop out"] },
  { id: "settings", label: "Settings", group: "Game", keywords: ["preferences", "card size"] },
  { id: "interaction", label: "Opponent interaction prompts…", group: "Game", keywords: ["simulator"] },

  { id: "view-graveyard", label: "Browse the graveyard", group: "View", shortcut: "V" },
  { id: "view-exile", label: "Browse exile", group: "View" },
  { id: "view-command", label: "Browse the command zone", group: "View" },
  { id: "view-zones", label: "View other zones", group: "View" },
  { id: "inspect", label: "Inspect the focused card (hold I)", group: "View", shortcut: "I" },
  { id: "keybinds", label: "Keyboard shortcuts", group: "View", shortcut: "?" },
];

export type PaletteMatch = {
  id: string;
  label: string;
  /** A number, a counter name or a die, depending on the action. */
  arg: number | string | null;
  /** For life: "set" (life 30) or "delta" (life -3). */
  mode: "set" | "delta" | null;
};

function labelOf(id: string): string {
  return PALETTE_ACTIONS.find((a) => a.id === id)?.label ?? id;
}

const DIE = /^(?:roll\s+)?d?(4|6|8|10|12|20)$/;

/** Parametric forms: "draw 3", "mill 2", "peek 4", "life -3", "add +1/+1 counter". */
function parametric(query: string): PaletteMatch[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  const found: PaletteMatch[] = [];
  const push = (id: string, label: string, arg: number | string | null, mode: PaletteMatch["mode"] = null) => found.push({ id, label, arg, mode });

  let m: RegExpExecArray | null;
  if ((m = /^draw (\d{1,3})$/.exec(q))) push("draw-n", `Draw ${Number(m[1])} card${Number(m[1]) === 1 ? "" : "s"}`, Number(m[1]));
  if ((m = /^mill (\d{1,3})$/.exec(q))) push("mill", `Mill ${Number(m[1])} card${Number(m[1]) === 1 ? "" : "s"}`, Number(m[1]));
  if ((m = /^(?:peek|look|scry)(?: at)?(?: top)? (\d{1,3})$/.exec(q))) push("peek-top", `Look at the top ${Number(m[1])}`, Number(m[1]));
  if ((m = /^(?:peek|look)(?: at)? bottom (\d{1,3})$/.exec(q))) push("peek-bottom", `Look at the bottom ${Number(m[1])}`, Number(m[1]));
  if ((m = /^life ([+-]\d{1,4})$/.exec(q))) push("life-set", `Change life by ${Number(m[1]) > 0 ? "+" : ""}${Number(m[1])}`, Number(m[1]), "delta");
  else if ((m = /^life (\d{1,4})$/.exec(q))) push("life-set", `Set life to ${Number(m[1])}`, Number(m[1]), "set");
  if ((m = /^turn (\d{1,4})$/.exec(q))) push("set-turn", `Set the turn to ${Number(m[1])}`, Number(m[1]));
  if ((m = /^(poison|energy|experience) (\d{1,4})$/.exec(q))) push(`tracker-${m[1]}`, `Set ${m[1]} to ${Number(m[2])}`, Number(m[2]), "set");
  if ((m = DIE.exec(q))) push("roll", `Roll a d${m[1]}`, `d${m[1]}`);
  if (q === "coin" || q === "flip" || q === "flip a coin" || q === "roll coin") push("roll", "Flip a coin", "coin");

  // "add +1/+1 counter", "add loyalty counter", "counter shield", "+1/+1"
  const counterA = /^(?:add )?(.+?) counters?$/.exec(q);
  const counterB = /^counters? (.+)$/.exec(q);
  const counterC = /^add (\+\d+\/\+\d+|-\d+\/-\d+)$/.exec(q);
  const name = counterA?.[1] ?? counterB?.[1] ?? counterC?.[1];
  if (name && name !== "add" && name.length <= 40) {
    push("add-counter", `Add a "${name}" counter to selected`, name);
  }
  return found;
}

/** Everything that matches, parametric matches first, then keyword matches by
 *  how early the query appears. An empty query lists the whole catalogue. */
export function matchPalette(query: string, limit = 10): PaletteMatch[] {
  const q = query.trim().toLowerCase();
  if (q === "") return PALETTE_ACTIONS.slice(0, limit).map((a) => ({ id: a.id, label: a.label, arg: null, mode: null }));

  const results = parametric(q);
  const taken = new Set(results.map((r) => r.id));
  const words = q.split(/\s+/);
  const scored: Array<{ action: PaletteAction; score: number }> = [];
  for (const action of PALETTE_ACTIONS) {
    if (taken.has(action.id)) continue;
    const haystack = [action.label, action.id, ...(action.keywords ?? []), action.example ?? ""].join(" ").toLowerCase();
    if (!words.every((w) => haystack.includes(w))) continue;
    const label = action.label.toLowerCase();
    const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : (action.keywords ?? []).some((k) => k.startsWith(q)) ? 2 : 3;
    scored.push({ action, score });
  }
  scored.sort((a, b) => a.score - b.score);
  for (const { action } of scored) results.push({ id: action.id, label: labelOf(action.id), arg: null, mode: null });
  return results.slice(0, limit);
}

export type KeyPress = { key: string; ctrl: boolean; meta: boolean; shift: boolean; alt: boolean };

/**
 * Maps a key press to an action id, or null. Text-field focus is checked by
 * the caller. Ctrl and Cmd are the same modifier here so the sheet is right on
 * every platform. `1`..`9` are "quick play hand card N" and come back as
 * `play-hand-N` / `play-hand-tapped-N`.
 */
export function resolveShortcut(press: KeyPress): string | null {
  const mod = press.ctrl || press.meta;
  const key = press.key;
  if (mod) {
    const k = key.toLowerCase();
    if (k === "z") return press.shift ? "redo" : "undo";
    if (k === "y") return "redo";
    if (k === "k") return "palette";
    if (k === "s") return "save";
    if (k === "g") return press.shift ? "ungroup" : "group";
    return null;
  }
  if (press.alt) return null;
  if (key === "/") return "palette";
  if (key === "?") return "keybinds";
  if (/^[1-9]$/.test(key)) return `${press.shift ? "play-hand-tapped-" : "play-hand-"}${key}`;
  if (key === "Delete" || key === "Backspace") return "delete";
  if (key === "Escape") return "clear-selection";
  if (key === "+" || key === "=") return "add-counter";
  if (key === "-" || key === "_") return "remove-counter";
  if (key.length !== 1) return null;
  const k = key.toLowerCase();
  const byKey: Record<string, string> = {
    d: "draw", s: "shuffle", f: "search-library", h: "hand-overlay", t: press.shift ? "tidy" : "tap-toggle", u: "untap-all", a: "select-all",
    g: "to-graveyard", e: "to-exile", r: "to-hand", l: "to-library-top", b: "to-library-bottom", p: "proliferate", c: "copy-token",
    k: "create-token", n: "next-turn", o: "log", v: "view-graveyard", i: "inspect",
  };
  return byKey[k] ?? null;
}
