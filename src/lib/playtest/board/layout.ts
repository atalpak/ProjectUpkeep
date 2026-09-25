/**
 * Table geometry, all in proportions of a fixed-shape virtual board.
 *
 * The board is a 16:9 rectangle scaled to fit whatever window it is in; x and
 * y are fractions of its width and height. Storing proportions rather than
 * pixels is what makes a saved game survive a resize, a second monitor or a
 * 200% zoom, and it is why this file has no DOM in it: the UI multiplies by
 * the measured board size and this module never learns what that was.
 *
 * `pos` is the card's TOP-LEFT corner. Ungrouped cards store their own `pos`;
 * a grouped card's position is derived here from the group anchor,
 * arrangement and index, and never stored (see types.ts). Everything is
 * deterministic and rounded to 4 places so a saved layout compares equal.
 */

import type { GameCommand } from "./commands";
import { cardBucket, own } from "./reducers/util";
import type { GameCard, GameState, Group, Pos } from "./types";

export const BOARD_ASPECT = 16 / 9;
/** Card size as a fraction of board width / height. A card is 5:7 in pixels,
 *  so its height as a fraction of the board's HEIGHT is 1.4 * w * aspect. */
export const CARD_W = 0.07;
export const CARD_H = Number((1.4 * CARD_W * BOARD_ASPECT).toFixed(4));

const ROW_STEP = 0.08;
const COLUMN_STEP = 0.055;
const STACK_STEP = { x: 0.012, y: 0.02 };

export const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** Keeps the whole card on the board, rounded. */
export function clampPos(pos: Pos): Pos {
  const x = Math.min(Math.max(Number.isFinite(pos.x) ? pos.x : 0, 0), 1 - CARD_W);
  const y = Math.min(Math.max(Number.isFinite(pos.y) ? pos.y : 0, 0), 1 - CARD_H);
  return { x: round4(x), y: round4(y) };
}

export function groupCardPos(group: Group, index: number): Pos {
  switch (group.arrangement) {
    case "row":
      return clampPos({ x: group.anchor.x + index * ROW_STEP, y: group.anchor.y });
    case "column":
      return clampPos({ x: group.anchor.x, y: group.anchor.y + index * COLUMN_STEP });
    case "stack":
      return clampPos({ x: group.anchor.x + index * STACK_STEP.x, y: group.anchor.y + index * STACK_STEP.y });
  }
}

/** Where every battlefield card is, own position or derived from its group.
 *  Iterates `zones.battlefield`, so map order is stacking order. */
export function resolvedPositions(state: GameState): Map<string, Pos> {
  const result = new Map<string, Pos>();
  const indexInGroup = new Map<string, number>();
  for (const id of state.zones.battlefield) {
    const card = state.cards[id];
    if (!card) continue;
    const group = card.groupId ? own(state.groups, card.groupId) : undefined;
    if (card.groupId && group) {
      const index = indexInGroup.get(card.groupId) ?? 0;
      indexInGroup.set(card.groupId, index + 1);
      result.set(id, groupCardPos(group, index));
    } else if (card.pos) {
      result.set(id, card.pos);
    }
  }
  return result;
}

/** The rectangle a card occupies, accounting for a tap (90 or 270) turning it
 *  on its side about its centre. Fractions of the board. */
export function cardRect(card: Pick<GameCard, "rotation" | "tapped">, pos: Pos): { x: number; y: number; w: number; h: number } {
  const sideways = card.tapped || card.rotation === 90 || card.rotation === 270;
  const w = sideways ? CARD_H / BOARD_ASPECT : CARD_W;
  const h = sideways ? CARD_W * BOARD_ASPECT : CARD_H;
  const cx = pos.x + CARD_W / 2;
  const cy = pos.y + CARD_H / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** A deterministic free slot for a card entering the battlefield without a
 *  chosen position: the first grid cell, scanning left to right then down,
 *  that does not sit on an existing card. */
export function defaultPos(state: GameState): Pos {
  const taken = [...resolvedPositions(state).values()];
  const stepX = CARD_W * 1.1;
  const stepY = CARD_H * 1.08;
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 12; col++) {
      const pos = clampPos({ x: 0.04 + col * stepX, y: 0.04 + row * stepY });
      const overlaps = taken.some((t) => Math.abs(t.x - pos.x) < CARD_W * 0.85 && Math.abs(t.y - pos.y) < CARD_H * 0.85);
      if (!overlaps) return pos;
    }
  }
  // A full table: pile onto the corner rather than fail.
  return clampPos({ x: 0.04, y: 0.04 });
}

export type Rect = { x: number; y: number; w: number; h: number };

/** Battlefield cards whose rectangle touches `rect` (area select). Returned in
 *  stacking order. Pure so the marquee can be tested without a DOM. */
export function cardsInRect(state: GameState, rect: Rect): string[] {
  const hits: string[] = [];
  const positions = resolvedPositions(state);
  for (const id of state.zones.battlefield) {
    const pos = positions.get(id);
    const card = state.cards[id];
    if (!pos || !card) continue;
    const r = cardRect(card, pos);
    const disjoint = r.x > rect.x + rect.w || r.x + r.w < rect.x || r.y > rect.y + rect.h || r.y + r.h < rect.y;
    if (!disjoint) hits.push(id);
  }
  return hits;
}

export type SnapResult = { pos: Pos; guideX: number | null; guideY: number | null };

/**
 * Alignment snapping for a drag: pull the moving card's left edge or centre
 * onto another card's (and the same for top edge / middle) when within
 * `threshold`, and report the guide line to draw. Never snaps to itself
 * because the caller passes only the OTHER cards' positions.
 */
export function snapPosition(pos: Pos, others: Pos[], threshold = 0.008): SnapResult {
  let x = pos.x;
  let y = pos.y;
  let guideX: number | null = null;
  let guideY: number | null = null;
  let bestX = threshold;
  let bestY = threshold;
  for (const other of others) {
    for (const [mine, theirs] of [
      [pos.x, other.x],
      [pos.x + CARD_W / 2, other.x + CARD_W / 2],
      [pos.x + CARD_W, other.x + CARD_W],
    ] as const) {
      const d = Math.abs(mine - theirs);
      if (d < bestX) {
        bestX = d;
        x = pos.x + (theirs - mine);
        guideX = round4(theirs);
      }
    }
    for (const [mine, theirs] of [
      [pos.y, other.y],
      [pos.y + CARD_H / 2, other.y + CARD_H / 2],
      [pos.y + CARD_H, other.y + CARD_H],
    ] as const) {
      const d = Math.abs(mine - theirs);
      if (d < bestY) {
        bestY = d;
        y = pos.y + (theirs - mine);
        guideY = round4(theirs);
      }
    }
  }
  return { pos: clampPos({ x, y }), guideX, guideY };
}

/**
 * "Tidy": the old rows-and-groups shelf, as a one-shot button. Dissolves every
 * group and lays the battlefield out as creatures, other permanents, then
 * lands, each wrapping onto extra lines, cards of the same name adjacent.
 * Returns a single command so it is one undo step; the stacking order is left
 * alone.
 */
export function tidyLayout(state: GameState): GameCommand {
  const rows: Record<"creature" | "other" | "land", GameCard[]> = { creature: [], other: [], land: [] };
  for (const id of state.zones.battlefield) {
    const card = state.cards[id];
    if (card) rows[cardBucket(card)].push(card);
  }
  const step = CARD_W * 1.12;
  const perLine = Math.max(1, Math.floor((1 - 0.04 * 2) / step));
  let lines = 0;
  for (const key of ["creature", "other", "land"] as const) lines += Math.ceil(rows[key].length / perLine);
  // Squeeze the lines together (cards overlap vertically) only when there are
  // too many to fit at a comfortable spacing.
  const lineHeight = lines <= 1 ? CARD_H * 1.1 : Math.min(CARD_H * 1.1, (1 - 0.04 * 2 - CARD_H) / (lines - 1));

  const placements: Array<{ id: string; x: number; y: number }> = [];
  let line = 0;
  for (const key of ["creature", "other", "land"] as const) {
    const sorted = [...rows[key]].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    sorted.forEach((card, i) => {
      const pos = clampPos({ x: 0.04 + (i % perLine) * step, y: 0.04 + (line + Math.floor(i / perLine)) * lineHeight });
      placements.push({ id: card.id, x: pos.x, y: pos.y });
    });
    line += Math.ceil(sorted.length / perLine);
  }

  const grouped = state.zones.battlefield.filter((id) => state.cards[id]?.groupId);
  const commands: GameCommand[] = [];
  if (grouped.length > 0) commands.push({ type: "SET_GROUP", ids: grouped, groupId: null });
  commands.push({ type: "SET_LAYOUT", placements });
  return commands.length === 1 ? commands[0] : { type: "BATCH", commands };
}

/** Screen-reader / tab order: top to bottom, then left to right. */
export function readingOrder(state: GameState, ids: string[]): string[] {
  const positions = resolvedPositions(state);
  return [...ids].sort((a, b) => {
    const pa = positions.get(a);
    const pb = positions.get(b);
    if (!pa || !pb) return 0;
    return Math.round(pa.y * 20) - Math.round(pb.y * 20) || pa.x - pb.x;
  });
}
