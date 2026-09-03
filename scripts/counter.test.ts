/**
 * Mirroring a received trade into a counter-offer.
 *
 * The bit that is easy to get backwards: which side of the original maps to
 * which side of the counter.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  counterSeedIsEmpty,
  mirrorTradeForCounter,
  type CounterSourceItem,
} from "../src/lib/social/counter";

const item = (
  direction: CounterSourceItem["direction"],
  instanceId: string | null,
  quantity = 1,
): CounterSourceItem => ({ direction, instanceId, quantity });

test("the recipient's give-up side becomes their offering side", () => {
  const seed = mirrorTradeForCounter(
    [item("from_recipient", "mine-1", 2)],
    ["mine-1"],
    [],
  );
  assert.deepEqual(seed.offering, { "mine-1": 2 });
  assert.deepEqual(seed.requesting, {});
});

test("what they were offered becomes what they request back", () => {
  const seed = mirrorTradeForCounter(
    [item("from_proposer", "theirs-1", 1)],
    [],
    ["theirs-1"],
  );
  assert.deepEqual(seed.requesting, { "theirs-1": 1 });
  assert.deepEqual(seed.offering, {});
});

test("a full two-sided trade mirrors both ways at once", () => {
  const seed = mirrorTradeForCounter(
    [
      item("from_proposer", "t-1", 1),
      item("from_proposer", "t-2", 3),
      item("from_recipient", "m-1", 1),
    ],
    ["m-1", "m-2"],
    ["t-1", "t-2"],
  );
  assert.deepEqual(seed.requesting, { "t-1": 1, "t-2": 3 });
  assert.deepEqual(seed.offering, { "m-1": 1 });
});

test("an item whose card is no longer tradable is dropped, not seeded", () => {
  const seed = mirrorTradeForCounter(
    [item("from_recipient", "moved-away", 1), item("from_recipient", "still-here", 1)],
    ["still-here"], // "moved-away" is not in the offerable set any more
    [],
  );
  assert.deepEqual(seed.offering, { "still-here": 1 });
});

test("items with no instance id or a junk quantity are ignored", () => {
  const seed = mirrorTradeForCounter(
    [
      item("from_recipient", null, 1),
      item("from_recipient", "m-1", 0),
      item("from_recipient", "m-2", Number.NaN),
      item("from_recipient", "m-3", -4),
    ],
    ["m-1", "m-2", "m-3"],
    [],
  );
  assert.deepEqual(seed.offering, {});
});

test("an unknown direction string contributes nothing", () => {
  const seed = mirrorTradeForCounter(
    [item("sideways" as CounterSourceItem["direction"], "x-1", 1)],
    ["x-1"],
    ["x-1"],
  );
  assert.ok(counterSeedIsEmpty(seed));
});

test("Set and array inputs are treated the same", () => {
  const items = [item("from_recipient", "m-1", 1)];
  const fromArray = mirrorTradeForCounter(items, ["m-1"], []);
  const fromSet = mirrorTradeForCounter(items, new Set(["m-1"]), new Set());
  assert.deepEqual(fromArray, fromSet);
});

test("counterSeedIsEmpty only when both sides are empty", () => {
  assert.equal(counterSeedIsEmpty({ offering: {}, requesting: {} }), true);
  assert.equal(counterSeedIsEmpty({ offering: { a: 1 }, requesting: {} }), false);
  assert.equal(counterSeedIsEmpty({ offering: {}, requesting: { b: 2 } }), false);
});
