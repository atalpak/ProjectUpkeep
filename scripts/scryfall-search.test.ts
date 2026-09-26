import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  adaptCard, clearCatalogSearchCache, effectiveQueryOf, searchCatalog, upstreamParams, type SearchDeps,
} from "../src/lib/cards/scryfall-search-core";

const card = (id: string, extra: object = {}) => ({
  object: "card", id, oracle_id: "o-" + id, name: "Card " + id, set: "lea", set_name: "Alpha",
  collector_number: "1", released_at: "1993-08-05", layout: "normal", rarity: "rare", lang: "en",
  games: ["paper"], prices: { usd: "1.00" }, image_uris: { normal: "n", large: "l", small: "s" },
  scryfall_uri: "u", ...extra,
});
const list = (data: object[], extra: object = {}) => ({ object: "list", total_cards: data.length, has_more: false, data, ...extra });
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function harness(responses: Response[], gate?: Awaited<ReturnType<SearchDeps["claimSlot"]>>) {
  const calls: string[] = [];
  const cooldowns: number[] = [];
  const deps: SearchDeps = {
    claimSlot: async () => gate ?? { ok: true, granted: true, waitMs: 0, cooldownMs: 0 },
    openCooldown: async (s) => { cooldowns.push(s); },
    sleep: async () => {},
    fetchJson: (async (url: string) => { calls.push(String(url)); const r = responses.shift(); if (!r) throw new Error("network"); return r; }) as typeof fetch,
  };
  return { deps, calls, cooldowns };
}

beforeEach(() => clearCatalogSearchCache());

test("raw query reaches upstream unchanged, with options as parameters", async () => {
  const h = harness([reply(200, list([card("a")]))]);
  const q = 'o:"draw a card" o:/\\sm/ +&#';
  const r = await searchCatalog(h.deps, { q, page: 2, unique: "prints", order: "released", dir: "asc" });
  assert.equal(r.status, "ok");
  const url = new URL(h.calls[0]!);
  assert.equal(url.searchParams.get("q"), q);
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("unique"), "prints");
  assert.equal(url.searchParams.get("order"), "released");
  assert.ok(!url.searchParams.has("include_extras"), "no hidden restrictions or additions");
});

test("prefer becomes a query directive; display never goes upstream", () => {
  assert.equal(effectiveQueryOf({ q: "t:elf", page: 1, prefer: "oldest" }), "t:elf prefer:oldest");
  assert.ok(!upstreamParams({ q: "t:elf", page: 1, display: "text" }, "t:elf").has("display"));
});

test("overlong and empty queries never call upstream", async () => {
  const h = harness([]);
  const a = await searchCatalog(h.deps, { q: "x".repeat(1001), page: 1 });
  const b = await searchCatalog(h.deps, { q: "  ", page: 1 });
  assert.equal(a.status === "error" && a.kind, "validation");
  assert.equal(b.status === "error" && b.kind, "validation");
  assert.equal(h.calls.length, 0);
});

test("upstream order and totals are preserved; pagination advances", async () => {
  const h = harness([reply(200, list([card("z"), card("a")], { total_cards: 500, has_more: true }))]);
  const r = await searchCatalog(h.deps, { q: "t:elf", page: 1 });
  assert.ok(r.status === "ok");
  assert.deepEqual(r.cards.map((c) => c.id), ["z", "a"]);
  assert.equal(r.totalCards, 500);
  assert.equal(r.hasMore, true);
  assert.equal(r.nextPage, 2);
});

test("syntax error surfaces upstream details and warnings; nothing is reduced", async () => {
  const h = harness([reply(400, { object: "error", code: "bad_request", details: "Unknown keyword", warnings: ["w"] })]);
  const r = await searchCatalog(h.deps, { q: "foo:bar", page: 1 });
  assert.ok(r.status === "error");
  assert.equal(r.kind, "syntax");
  assert.equal(r.message, "Unknown keyword");
  assert.deepEqual(r.warnings, ["w"]);
  assert.equal(h.calls.length, 1);
});

test("a no-match 404 is an empty result, not an error, and is cached briefly", async () => {
  const h = harness([reply(404, { object: "error", code: "not_found", details: "No cards" })]);
  const r = await searchCatalog(h.deps, { q: "zzzz", page: 1 });
  assert.ok(r.status === "ok" && r.cards.length === 0 && r.totalCards === 0);
  await searchCatalog(h.deps, { q: "zzzz", page: 1 });
  assert.equal(h.calls.length, 1);
});

test("warnings on a successful list are kept", async () => {
  const h = harness([reply(200, list([card("a")], { warnings: ["Invalid expression"] }))]);
  const r = await searchCatalog(h.deps, { q: "t:elf", page: 1 });
  assert.ok(r.status === "ok");
  assert.deepEqual(r.warnings, ["Invalid expression"]);
});

test("429 opens a cooldown of at least 30s, honouring a longer Retry-After", async () => {
  const h = harness([reply(429, { object: "error" }, { "retry-after": "90" }), reply(429, { object: "error" })]);
  const a = await searchCatalog(h.deps, { q: "a", page: 1 });
  const b = await searchCatalog(h.deps, { q: "b", page: 1 });
  assert.ok(a.status === "error" && a.kind === "rate_limited" && a.retryAfterSeconds === 90);
  assert.ok(b.status === "error" && b.retryAfterSeconds === 30);
  assert.deepEqual(h.cooldowns, [90, 30]);
});

test("a refused gate means no upstream call and a retry hint", async () => {
  const h = harness([], { ok: true, granted: false, waitMs: 0, cooldownMs: 12000 });
  const r = await searchCatalog(h.deps, { q: "a", page: 1 });
  assert.ok(r.status === "error" && r.kind === "rate_limited" && r.retryAfterSeconds === 12);
  assert.equal(h.calls.length, 0);
  const down = harness([], { ok: false });
  const d = await searchCatalog(down.deps, { q: "a", page: 1 });
  assert.ok(d.status === "error" && d.kind === "unavailable");
});

test("identical concurrent requests coalesce into one call", async () => {
  const h = harness([reply(200, list([card("a")]))]);
  const [x, y] = await Promise.all([
    searchCatalog(h.deps, { q: "t:elf", page: 1 }),
    searchCatalog(h.deps, { q: "t:elf", page: 1 }),
  ]);
  assert.equal(h.calls.length, 1);
  assert.equal(x.status, "ok");
  assert.equal(y.status, "ok");
});

test("cache key covers options and page; display change reuses the cards", async () => {
  const h = harness([reply(200, list([card("a")])), reply(200, list([card("b")])), reply(200, list([card("c")]))]);
  await searchCatalog(h.deps, { q: "t:elf", page: 1 });
  const again = await searchCatalog(h.deps, { q: "t:elf", page: 1, display: "text" });
  assert.equal(h.calls.length, 1);
  assert.ok(again.status === "ok" && again.presentation.display === "text");
  await searchCatalog(h.deps, { q: "t:elf", page: 2 });
  await searchCatalog(h.deps, { q: "t:elf", page: 1, unique: "art" });
  assert.equal(h.calls.length, 3);
});

test("transient failures are not cached as empty results; network failure is retryable", async () => {
  const h = harness([reply(500, { object: "error" }), reply(200, list([card("a")]))]);
  const a = await searchCatalog(h.deps, { q: "t:elf", page: 1 });
  assert.ok(a.status === "error" && a.kind === "unavailable");
  const b = await searchCatalog(h.deps, { q: "t:elf", page: 1 });
  assert.ok(b.status === "ok" && b.cards.length === 1);
});

test("malformed JSON and wrong shapes fail as bad_payload", async () => {
  const h = harness([new Response("<html>", { status: 200 }), reply(200, { object: "list" })]);
  const a = await searchCatalog(h.deps, { q: "a", page: 1 });
  const b = await searchCatalog(h.deps, { q: "b", page: 1 });
  assert.ok(a.status === "error" && a.kind === "bad_payload");
  assert.ok(b.status === "error" && b.kind === "bad_payload");
});

test("adapter: multi-face images hoist to the card, nullable oracle id survives, junk is dropped", () => {
  const dfc = adaptCard({ id: "d", name: "A // B", oracle_id: null, layout: "transform",
    card_faces: [{ name: "A", image_uris: { normal: "fa" } }, { name: "B", image_uris: { normal: "fb" } }] });
  assert.equal(dfc?.imageNormal, "fa");
  assert.equal(dfc?.oracleId, null);
  assert.equal(dfc?.faces.length, 2);
  assert.equal(adaptCard({ name: "no id" }), null);
  assert.equal(adaptCard("x"), null);
});

import { isPlainNameQuery, suggestSpelling } from "../src/lib/cards/scryfall-search-core";

test("spelling help: plain names only, real differences only, gated", async () => {
  assert.equal(isPlainNameQuery("lightnin bolt"), true);
  for (const q of ["t:elf", '"x y"', "-ring", "ab", "o:/x/"]) assert.equal(isPlainNameQuery(q), false, q);
  const h = harness([reply(200, { object: "card", name: "Lightning Bolt" })]);
  assert.equal(await suggestSpelling(h.deps, "lightnin bolt"), "Lightning Bolt");
  const same = harness([reply(200, { object: "card", name: "Lightning Bolt" })]);
  assert.equal(await suggestSpelling(same.deps, "lightning bolt"), null);
  const none = harness([reply(404, { object: "error" })]);
  assert.equal(await suggestSpelling(none.deps, "zzzzz"), null);
  const refused = harness([], { ok: true, granted: false, waitMs: 0, cooldownMs: 5000 });
  assert.equal(await suggestSpelling(refused.deps, "lightnin bolt"), null);
  assert.equal(refused.calls.length, 0);
});
