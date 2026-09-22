/**
 * Tests for the dropdown placement maths behind `useViewportFit`.
 *
 * Run with: npx tsx --test scripts/viewport-fit.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { fitToViewport, type Box } from "../src/lib/ui/viewport-fit";

const viewport = { width: 390, height: 800 };
const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

test("a panel that already fits is left alone", () => {
  const fit = fitToViewport(box(100, 100, 224, 120), box(300, 70, 30, 26), viewport);
  assert.deepEqual(fit, { dx: 0, dy: 0, maxHeight: null });
});

test("a panel hanging off the left edge is pushed back to the margin", () => {
  const fit = fitToViewport(box(-40, 100, 224, 120), box(150, 70, 30, 26), viewport);
  assert.equal(fit.dx, 48);
});

test("a panel hanging off the right edge is pulled back", () => {
  const fit = fitToViewport(box(250, 100, 224, 120), box(250, 70, 30, 26), viewport);
  assert.equal(fit.dx, 390 - 8 - 474);
});

test("a panel wider than the window starts at the left margin", () => {
  const fit = fitToViewport(box(30, 100, 500, 60), null, viewport);
  assert.equal(fit.dx, -22);
});

test("near the bottom with more room above, it flips above the trigger", () => {
  // Trigger 26px tall at y=700, panel starts 4px under it at y=730, 200px tall.
  const fit = fitToViewport(box(100, 730, 224, 200), box(300, 700, 30, 26), viewport);
  assert.equal(fit.maxHeight, null);
  // New top = 730 + dy must put the bottom 4px above the trigger's top (700).
  assert.equal(730 + fit.dy + 200, 700 - 4);
});

test("a flipped panel taller than the space above is capped and scrolls", () => {
  const fit = fitToViewport(box(100, 530, 224, 600), box(300, 500, 30, 26), viewport);
  // above = 500 - 4 - 8 = 488, below = 800 - 8 - 530 = 262
  assert.equal(fit.maxHeight, 488);
  assert.equal(530 + fit.dy + 488, 500 - 4);
});

test("with more room below than above it stays put and is capped to the space", () => {
  const fit = fitToViewport(box(100, 130, 224, 900), box(300, 100, 30, 26), viewport);
  assert.equal(fit.dy, 0);
  assert.equal(fit.maxHeight, 800 - 8 - 130);
});

test("without an anchor it cannot flip, only cap", () => {
  const fit = fitToViewport(box(100, 700, 224, 400), null, viewport);
  assert.equal(fit.dy, 0);
  // Only 92px are left below, but a scrolling panel is never squeezed under 96.
  assert.equal(fit.maxHeight, 96);
});
