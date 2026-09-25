/**
 * The structured game log. `GameEvent` (types.ts) is stored; the sentence a
 * person reads is derived here by `describeEvent` and never persisted, so the
 * wording can change and the metrics (metrics.ts) can be recomputed from the
 * same data.
 *
 * Two audiences read this log and they must not see the same thing:
 *
 *  - the owner sees everything, including peeks and searches and the names of
 *    cards they drew;
 *  - anyone else (a share, a "shareable" export) sees only `publicEvents()`:
 *    what a real opponent at the table could have seen. Draws and mills become
 *    bare counts, a card that went to a private zone or was face down loses its
 *    name, seeds are stripped, and private events (peeks, notes, simulator
 *    prompts) are dropped. The whitelist below is deliberately the only way
 *    `data` reaches a public event: a new field is invisible to the public
 *    until someone adds it here on purpose.
 */

import { isPublicZone, ZONE_LABELS, type EventKind, type GameEvent } from "./types";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function list(names: string[]): string {
  if (names.length === 0) return "a card";
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const zoneName = (zone: string | null): string => (zone ? ZONE_LABELS[zone as keyof typeof ZONE_LABELS].toLowerCase() : "play");

export function describeEvent(event: GameEvent): string {
  const { data, names } = event;
  switch (event.kind) {
    case "start":
      return `Started a ${data.format === "commander" ? "Commander" : "constructed"} game.`;
    case "draw":
      return `Drew ${plural(num(data.count), "card")}.`;
    case "mill":
      return `Milled ${plural(num(data.count), "card")}.`;
    case "move": {
      const count = Math.max(names.length, num(data.count));
      const subject = names.length > 0 ? list(names) : plural(count, "card");
      const where = data.faceDown ? `${zoneName(event.to)} face down` : zoneName(event.to);
      return `Moved ${subject} to ${where}.`;
    }
    case "discard":
      return `Discarded ${list(names)} at random.`;
    case "flags": {
      const who = list(names);
      switch (data.flag) {
        case "tapped":
          return `${data.value ? "Tapped" : "Untapped"} ${who}.`;
        case "dimmed":
          return `${data.value ? "Dimmed" : "Un-dimmed"} ${who}.`;
        case "face":
          return data.value === "face-down" ? `Turned ${who} face down.` : data.value === "back" ? `Transformed ${who}.` : `Turned ${who} face up.`;
        case "rotation":
          return `Rotated ${who} to ${String(data.value)} degrees.`;
        case "ptOffset":
          return `Set the power/toughness modifier on ${who} to ${String(data.value)}.`;
        case "commanderTax":
          return `Set the commander tax on ${who} to ${String(data.value)}.`;
        default:
          return `Changed ${who}.`;
      }
    }
    case "counter": {
      const delta = num(data.delta);
      return `${delta >= 0 ? "Added" : "Removed"} ${plural(Math.abs(delta), `${String(data.counter)} counter`)} on ${list(names)}.`;
    }
    case "proliferate":
      return `Proliferated ${plural(num(data.count), "card")}.`;
    case "create":
      return `Created ${plural(num(data.count), String(data.kind ?? "card"))}${names.length > 0 ? ` (${list(names)})` : ""}.`;
    case "delete":
      return `Removed ${list(names)} from the game.`;
    case "shuffle":
      return `Shuffled the ${zoneName(String(data.zone ?? "library"))}.`;
    case "mulligan":
      return `Mulligan ${num(data.number)}.`;
    case "keep":
      return num(data.bottom) > 0 ? `Kept, bottoming ${plural(num(data.bottom), "card")}.` : "Kept the hand.";
    case "peek":
      return `Looked at the ${String(data.from)} ${plural(num(data.count), "card")} of the ${zoneName(String(data.zone))}.`;
    case "reveal":
      return `${data.revealed ? "Revealed" : "Hid"} ${list(names)}.`;
    case "tracker":
      return `${String(data.label)}: ${num(data.old)} to ${num(data.value)}.`;
    case "turn":
      return `Turn ${num(data.turn)}${num(data.drew) > 0 ? `, drew ${plural(num(data.drew), "card")}` : ""}.`;
    case "roll":
      return data.kind === "coin" ? `Coin flip: ${num(data.result) === 1 ? "heads" : "tails"}.` : `Rolled a ${String(data.kind)}: ${num(data.result)}.`;
    case "layout":
      return `Rearranged ${plural(num(data.count), "card")} on the table.`;
    case "group":
      return data.label ? `Grouped ${plural(event.ids.length || num(data.count), "card")} as "${String(data.label)}".` : `Ungrouped ${plural(event.ids.length || num(data.count), "card")}.`;
    case "note":
      return `Noted ${list(names)}.`;
    case "reorder":
      return `Reordered the ${zoneName(String(data.zone))}.`;
    case "interaction":
      return `Opponent prompt for turn ${num(data.turn)} (${String(data.resolution)}).`;
    case "simulator":
      return "Changed the opponent-interaction settings.";
    case "restore":
      return "Loaded a saved game.";
  }
}

/** Fields a public event may carry, per kind. Everything else is dropped. */
const PUBLIC_DATA_KEYS: Record<EventKind, readonly string[]> = {
  start: ["format"],
  draw: ["count"],
  mill: ["count"],
  move: ["count", "faceDown", "mv", "nCreature", "nLand", "nOther", "mvCreature"],
  discard: [],
  flags: ["flag", "value"],
  counter: ["counter", "delta", "total"],
  proliferate: ["count"],
  create: ["count", "kind"],
  delete: [],
  shuffle: ["zone"],
  mulligan: ["number"],
  keep: ["bottom"],
  peek: [],
  reveal: ["revealed"],
  tracker: ["label", "old", "value"],
  turn: ["turn", "drew", "power", "producers"],
  roll: ["kind", "result"],
  layout: ["count"],
  group: ["label", "count"],
  note: [],
  reorder: ["zone"],
  interaction: [],
  simulator: [],
  restore: [],
};

/** Kinds that never leave the owner's browser. */
const NEVER_PUBLIC: ReadonlySet<EventKind> = new Set(["peek", "note", "interaction", "simulator", "restore", "discard"]);

/**
 * What a real opponent could have seen. Object ids are always dropped (a share
 * mints its own), and a name survives only when the card ended up somewhere
 * public and was not face down.
 */
export function publicEvents(events: readonly GameEvent[]): GameEvent[] {
  const result: GameEvent[] = [];
  for (const event of events) {
    if (event.voided || event.private || NEVER_PUBLIC.has(event.kind)) continue;

    const data: GameEvent["data"] = {};
    for (const key of PUBLIC_DATA_KEYS[event.kind]) {
      if (Object.prototype.hasOwnProperty.call(event.data, key)) data[key] = event.data[key];
    }

    // Draws and mills are counts only, whatever zone the cards landed in.
    const countOnly = event.kind === "draw" || event.kind === "mill";
    // A name is public if the card is/was somewhere the table can see it.
    // For a move that is the destination; for card-targeted events the zone
    // it sat in (`from`); face-down cards never are.
    const visibleZone = event.kind === "move" || event.kind === "create" ? event.to : event.from;
    const showNames = !countOnly && visibleZone !== null && isPublicZone(visibleZone) && event.data.hidden !== true && event.data.faceDown !== true;

    if (event.kind === "move" || event.kind === "create") data.count = Math.max(event.ids.length, event.names.length, Number(event.data.count) || 0);

    result.push({
      ...event,
      ids: [],
      names: showNames ? event.names : [],
      // A private origin is not disclosed: only the destination survives.
      from: event.kind === "move" && event.from !== null && !isPublicZone(event.from) ? null : event.from,
      data,
      voided: false,
      private: false,
    });
  }
  return result;
}
