/** Run with: npm test -w @upkeep/domain */
import { test } from "node:test";
import assert from "node:assert/strict";

import { commitStacks, summarizePlan } from "../src/import-commit";
import { planImport } from "../src/import-plan";
import type { ResolvedRow } from "../src/import-select";

const item = (id: string) => ({ operationId: id });

test("a failed stack does not stop the ones after it", async () => {
  const seen: string[] = [];
  const out = await commitStacks([item("a"), item("b"), item("c")], async (i) => {
    seen.push(i.operationId);
    if (i.operationId === "b") throw new Error("boom");
  });
  assert.deepEqual(seen, ["a", "b", "c"]);
  assert.equal(out.succeeded.length, 2);
  assert.equal(out.failed[0]!.item.operationId, "b");
  assert.equal(out.failed[0]!.error, "boom");
  assert.equal(out.untried.length, 0);
});

test("consecutive failures stop the run and leave the rest untried", async () => {
  let calls = 0;
  const out = await commitStacks(
    [item("a"), item("b"), item("c"), item("d"), item("e")],
    async () => {
      calls += 1;
      throw new Error("offline");
    },
  );
  assert.equal(calls, 3);
  assert.equal(out.failed.length, 3);
  assert.deepEqual(out.untried.map((i) => i.operationId), ["d", "e"]);
});

test("a success resets the failure streak", async () => {
  const out = await commitStacks(
    [item("a"), item("b"), item("c"), item("d"), item("e")],
    async (i) => {
      if (["a", "b", "d", "e"].includes(i.operationId)) throw new Error("x");
    },
  );
  assert.equal(out.untried.length, 0);
  assert.equal(out.failed.length, 4);
});

test("progress reports each attempted item", async () => {
  const marks: number[] = [];
  await commitStacks([item("a"), item("b")], async () => {}, {
    onProgress: (done, total) => marks.push(done * 10 + total),
  });
  assert.deepEqual(marks, [12, 22]);
});

const card = (id: string, finishes: string[]) => ({
  scryfall_id: id, name: id, set_code: "abc", set_name: null, collector_number: "1",
  image_uri_small: null, available_finishes: finishes, released_at: null, digital: false,
});
const row = (line: number, c: ResolvedRow["card"], extra: Partial<ResolvedRow> = {}): ResolvedRow => ({
  line, raw: "", quantity: 2, name: "x", setCode: null, setName: null, setHint: null,
  collectorNumber: null, finish: null, condition: null, language: null, scryfallId: null,
  card: c, reason: c ? null : "No card with that name in the database.", warning: null, ...extra,
});

test("summary counts cards, stacks, unknown names and caveats", () => {
  const plan = planImport(
    [
      row(1, card("a", ["nonfoil"])),
      row(2, card("a", ["nonfoil"])),
      row(3, card("b", ["foil"])), // asked nonfoil by default -> finish warning
      row(4, null),
    ],
    { condition: "NM", finish: "nonfoil", language: "en", locationId: null },
  );
  assert.deepEqual(summarizePlan(plan), { cards: 6, stacks: 2, needAttention: 1, withWarnings: 1 });
});
