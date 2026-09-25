/**
 * One source for how big a card is drawn, so the hand and the table agree.
 *
 * The hand card is `HAND_WIDTH_REM` wide, capped at 16% of the window height so
 * a short window does not push the hand off screen. A table card is drawn at
 * that same pixel width (times the table-size setting), which is why the two
 * read as the same card. The table's positions stay proportions of the board;
 * only how large a card is DRAWN follows this, never how it is stored.
 */

import type { CardSize } from "@/lib/playtest/settings";

export const HAND_WIDTH_REM: Record<CardSize, number> = { small: 5.2, medium: 6.6, large: 8 };

/** Hand card width in CSS pixels. `viewportHeight` 0 means "not measured yet". */
export function handCardPx(size: CardSize, viewportHeight: number): number {
  const wanted = HAND_WIDTH_REM[size] * 16;
  return viewportHeight === 0 ? wanted : Math.min(wanted, viewportHeight * 0.16);
}

/**
 * The display scale for table cards, relative to the layout size (`CARD_W` of
 * the board's width). Never above 1: a card is never drawn larger than the room
 * the layout gave it, so a row, column or tidy grid never overlaps by surprise.
 */
export function boardCardScale(handPx: number, tableSizeFactor: number, boardWidthPx: number, cardW: number): number {
  if (boardWidthPx <= 0) return tableSizeFactor;
  return Math.min(1, (handPx * tableSizeFactor) / (cardW * boardWidthPx));
}
