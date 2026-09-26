/**
 * Characterisation tests for the web Scryfall-syntax reader in
 * `src/lib/cards/search-query.ts`, and a parity check against the copy the
 * mobile app shares (`packages/upkeep-domain/src/card-search.ts`).
 *
 * "Characterisation" is the point: these pin what the parser does TODAY, warts
 * included, so that folding the web side onto the shared module (the follow-up
 * card-search.ts's header promises) is a change you can see rather than a
 * behaviour that drifts. Where a case documents something that looks like a
 * bug rather than a decision (negation, unterminated quotes), the comment says
 * so — the assertion still pins the current output, it does not bless it.
 *
 * The parity half runs one corpus through both parsers. Where they agree the
 * assertion is plain deep equality; where they differ, the difference is a
 * named `known divergence` test that asserts BOTH sides of the current
 * behaviour, so closing the gap makes that test fail and forces the entry to
 * be deleted deliberately. As of writing there is no divergence in what the two
 * parsers *return*; the divergences are in the surface each module exports.
 *
 * The domain module is imported by relative path, not `@upkeep/domain`: in a
 * worktree the workspace symlink resolves to a different checkout's copy.
 *
 * `search-query.test.ts` beside this file is the original happy-path suite
 * (including the URL round trip); this one is the exhaustive edge-case pin and
 * the parity check, kept separate so neither grows unwieldy.
 *
 * Run with: npx tsx --test scripts/search-query-characterisation.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import * as web from "../src/lib/cards/search-query";
import * as shared from "../packages/upkeep-domain/src/card-search";
import * as webFilters from "../src/lib/collection/filters";

const { EMPTY_ADVANCED_FILTER, parseScryfallQuery } = web;

type Filter = web.AdvancedCardFilter;

/** Parses `raw` and asserts the filter equals EMPTY plus `expected`. */
function expectParse(
  raw: string,
  expected: Partial<Filter>,
  unsupported: string[] = [],
): void {
  const result = parseScryfallQuery(raw);
  assert.deepEqual(result.filter, { ...EMPTY_ADVANCED_FILTER, ...expected }, `filter for ${JSON.stringify(raw)}`);
  assert.deepEqual(result.unsupported, unsupported, `unsupported for ${JSON.stringify(raw)}`);
}

// ---------------------------------------------------------------------------
// Empty, whitespace, bare words
// ---------------------------------------------------------------------------

test("empty and whitespace-only input parse to the empty filter", () => {
  expectParse("", {});
  expectParse("   ", {});
  expectParse("\t\n ", {});
  assert.equal(web.isAdvancedFilterActive(parseScryfallQuery("  ").filter), false);
});

test("parsing does not mutate the shared EMPTY_ADVANCED_FILTER", () => {
  parseScryfallQuery("goblin c:r cmc>=3 t:elf");
  assert.deepEqual(EMPTY_ADVANCED_FILTER, {
    name: "",
    colors: [],
    colorMode: "all",
    cmc: null,
    loyalty: null,
    type: "",
    oracle: "",
    set: "",
    rarity: "",
  });
});

test("bare words are the name, joined by single spaces", () => {
  expectParse("lightning bolt", { name: "lightning bolt" });
  expectParse("  sol    ring  ", { name: "sol ring" });
  expectParse("a\tb\nc", { name: "a b c" });
});

test("name words keep their case", () => {
  expectParse("Sol RING", { name: "Sol RING" });
});

test("name words interleave with facets; facet position does not matter", () => {
  expectParse("goblin c:r guide", { name: "goblin guide", colors: ["R"] });
  expectParse("c:r goblin guide", { name: "goblin guide", colors: ["R"] });
});

// ---------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------

test("a bare quoted phrase is one name word with the quotes stripped", () => {
  expectParse('"sol ring"', { name: "sol ring" });
  expectParse('"a b" c', { name: "a b c" });
});

test("an empty quoted phrase contributes nothing", () => {
  expectParse('""', {});
});

test("quoted values keep their inner spaces for t / o / s", () => {
  expectParse('t:"legendary creature"', { type: "legendary creature" });
  expectParse('o:"draw a card"', { oracle: "draw a card" });
  expectParse('set:"a b"', { set: "a b" });
});

test("a quoted colour value is NOT unquoted: its quotes defeat the name lookup", () => {
  // The colour branch never calls unquote(), so `"blue"` (quotes included) is
  // not a name and falls back to per-letter shorthand: b, l(x), u, e(x) -> B, U.
  // Looks like a bug. `c:"red"` only "works" by accident (r, e, d -> R).
  // Pinned as-is; the parity corpus shows the shared copy does the same.
  expectParse('c:"red"', { colors: ["R"] });
  expectParse('c:"blue"', { colors: ["B", "U"] });
  expectParse('c:"green"', { colors: ["G", "R"] });
  expectParse('c:"r u"', { colors: ["R", "U"] });
});

test("an unterminated quote is not an error: the quote stays in the value", () => {
  // Looks like a wart: `t:"unterminated foo` splits at the space, so the type
  // keeps its opening quote and `foo` becomes a name word. Pinned as-is.
  expectParse('t:"unterminated foo', { type: '"unterminated', name: "foo" });
  expectParse('t:"', { type: '"' });
  expectParse('"', { name: '"' });
});

test("quotes only unwrap when they wrap the whole value", () => {
  expectParse('t:legendary"x y"', { type: 'legendary"x y"' });
  expectParse('a"b c"', { name: 'a"b c"' });
  // `"a"b` tokenises as `"a"` then `b`.
  expectParse('"a"b', { name: "a b" });
  expectParse('t:"a"b', { type: "a", name: "b" });
});

// ---------------------------------------------------------------------------
// c: / color:
// ---------------------------------------------------------------------------

test("colour: `:` is 'all', `=` is 'exactly', `<=` is 'atMost'", () => {
  expectParse("c:wu", { colors: ["W", "U"], colorMode: "all" });
  expectParse("c=wu", { colors: ["W", "U"], colorMode: "exactly" });
  expectParse("c<=wu", { colors: ["W", "U"], colorMode: "atMost" });
});

test("colour: `color` is an alias for `c`", () => {
  expectParse("color:r", { colors: ["R"] });
  expectParse("color=r", { colors: ["R"], colorMode: "exactly" });
  expectParse("color<=r", { colors: ["R"], colorMode: "atMost" });
});

test("colour: letters, full names and comma lists all read", () => {
  expectParse("c:wubrg", { colors: ["W", "U", "B", "R", "G"] });
  expectParse("c:red,blue", { colors: ["R", "U"] });
  expectParse("c:white", { colors: ["W"] });
  expectParse("c:colorless", { colors: ["C"] });
  expectParse("c:c", { colors: ["C"] });
});

test("colour: a comma part is a whole name first, letters only as a fallback", () => {
  // "wu" is not a name, so it falls back to letters; "green" IS a name, so it
  // is not read as g-r-e-e-n.
  expectParse("c:wu,green", { colors: ["W", "U", "G"] });
  expectParse("c:w,red", { colors: ["W", "R"] });
});

test("colour: duplicates collapse, first-seen order is kept", () => {
  expectParse("c:rr", { colors: ["R"] });
  expectParse("c:urw", { colors: ["U", "R", "W"] });
});

test("colour: unknown letters inside an otherwise valid value are dropped", () => {
  // `x` is not a colour; `c:rx` still yields R. A wart, pinned.
  expectParse("c:rx", { colors: ["R"] });
});

test("colour: stray or trailing commas are tolerated", () => {
  expectParse("c:r,", { colors: ["R"] });
  expectParse("c:,r", { colors: ["R"] });
});

test("colour: `>=`, `<`, `>` are not colour operators, so they are unsupported", () => {
  expectParse("c>=r", {}, ["c>=r"]);
  expectParse("c<r", {}, ["c<r"]);
  expectParse("c>r", {}, ["c>r"]);
});

test("colour: no recognisable colour, or no value, is unsupported not a name", () => {
  expectParse("c:xyz", {}, ["c:xyz"]);
  expectParse("c:", {}, ["c:"]);
  expectParse("c=", {}, ["c="]);
  expectParse("c<=", {}, ["c<="]);
  expectParse("c:é", {}, ["c:é"]);
});

test("colour: a space after the colon splits the token", () => {
  expectParse("c: r", { name: "r" }, ["c:"]);
});

test("colour: the last colour clause wins outright (no merging)", () => {
  expectParse("c:r c:u", { colors: ["U"] });
  expectParse("c=r c:u", { colors: ["U"], colorMode: "all" });
});

test("colour: `ci:` / `id:` (colour identity) are not handled, only reported", () => {
  // The header search has no colour-identity facet. Scryfall's `id<=wu` is the
  // "commander identity" idiom people will type; it must not become a name.
  expectParse("ci:wu", {}, ["ci:wu"]);
  expectParse("id<=wu", {}, ["id<=wu"]);
});

// ---------------------------------------------------------------------------
// cmc / mv, loy / loyalty
// ---------------------------------------------------------------------------

const OPS: Array<[string, "eq" | "ne" | "gt" | "gte" | "lt" | "lte"]> = [
  [":", "eq"],
  ["=", "eq"],
  ["!=", "ne"],
  [">", "gt"],
  [">=", "gte"],
  ["<", "lt"],
  ["<=", "lte"],
];

test("cmc and mv: every comparator maps to its numeric op", () => {
  for (const key of ["cmc", "mv"]) {
    for (const [sym, op] of OPS) {
      expectParse(`${key}${sym}3`, { cmc: { op, value: 3 } });
    }
  }
});

test("loy and loyalty: every comparator maps to its numeric op", () => {
  for (const key of ["loy", "loyalty"]) {
    for (const [sym, op] of OPS) {
      expectParse(`${key}${sym}4`, { loyalty: { op, value: 4 } });
    }
  }
});

test("numeric values: decimals and negatives read; other shapes are unsupported", () => {
  expectParse("cmc>=-1.5", { cmc: { op: "gte", value: -1.5 } });
  expectParse("cmc:2.5", { cmc: { op: "eq", value: 2.5 } });
  expectParse("cmc:abc", {}, ["cmc:abc"]);
  expectParse("cmc>=", {}, ["cmc>="]);
  expectParse("cmc:3.", {}, ["cmc:3."]);
  expectParse("cmc:.5", {}, ["cmc:.5"]);
  expectParse("cmc:+3", {}, ["cmc:+3"]);
  expectParse("cmc==3", {}, ["cmc==3"]);
  expectParse("cmc=>3", {}, ["cmc=>3"]);
});

test("loyalty: 'X' is not a number, so `loy!=X` is unsupported", () => {
  expectParse("loy!=X", {}, ["loy!=X"]);
  expectParse("loy:x", {}, ["loy:x"]);
});

test("numeric facets: the last clause wins; cmc and loyalty are independent", () => {
  expectParse("cmc:1 cmc:2", { cmc: { op: "eq", value: 2 } });
  expectParse("loy>=3 loyalty<2", { loyalty: { op: "lt", value: 2 } });
  expectParse("cmc<=2 loy>=4", {
    cmc: { op: "lte", value: 2 },
    loyalty: { op: "gte", value: 4 },
  });
});

test("power / toughness comparisons are not handled, only reported", () => {
  expectParse("pow>=3", {}, ["pow>=3"]);
  expectParse("tou<2", {}, ["tou<2"]);
});

// ---------------------------------------------------------------------------
// t / o / s / r
// ---------------------------------------------------------------------------

test("t/type, o/oracle, s/set, r/rarity each fill their own field", () => {
  expectParse("t:elf", { type: "elf" });
  expectParse("type:elf", { type: "elf" });
  expectParse("o:draw", { oracle: "draw" });
  expectParse("oracle:draw", { oracle: "draw" });
  expectParse("s:dom", { set: "dom" });
  expectParse("set:dom", { set: "dom" });
  expectParse("r:rare", { rarity: "rare" });
  expectParse("rarity:rare", { rarity: "rare" });
});

test("t / o / s / r accept `:` only — `=` and friends are unsupported", () => {
  expectParse("t=elf", {}, ["t=elf"]);
  expectParse("s>=dom", {}, ["s>=dom"]);
  expectParse("r!=common", {}, ["r!=common"]);
});

test("t / o / s / r with an empty value are unsupported", () => {
  expectParse("t:", {}, ["t:"]);
  expectParse("o:", {}, ["o:"]);
  expectParse("s:", {}, ["s:"]);
  expectParse("r:", {}, ["r:"]);
});

test("repeated t / o / s / r: the last one wins", () => {
  expectParse("t:a t:b", { type: "b" });
});

test("all facets together", () => {
  expectParse('goblin c=r cmc<=2 loy>3 t:"legendary creature" o:haste s:dom r:rare', {
    name: "goblin",
    colors: ["R"],
    colorMode: "exactly",
    cmc: { op: "lte", value: 2 },
    loyalty: { op: "gt", value: 3 },
    type: "legendary creature",
    oracle: "haste",
    set: "dom",
    rarity: "rare",
  });
});

// ---------------------------------------------------------------------------
// Case-insensitivity
// ---------------------------------------------------------------------------

test("keys and operators are case-insensitive", () => {
  expectParse("CMC>=3", { cmc: { op: "gte", value: 3 } });
  expectParse("Mv<3", { cmc: { op: "lt", value: 3 } });
  expectParse("LOY:5", { loyalty: { op: "eq", value: 5 } });
  expectParse("T:Elf", { type: "Elf" });
  expectParse("O:Draw", { oracle: "Draw" });
  expectParse("R:Mythic", { rarity: "Mythic" });
});

test("colour values are case-insensitive (they are lower-cased)", () => {
  expectParse("C:R", { colors: ["R"] });
  expectParse("c:RED", { colors: ["R"] });
  expectParse("COLOR=WU", { colors: ["W", "U"], colorMode: "exactly" });
});

test("text values keep the case typed — the matcher, not the parser, folds it", () => {
  expectParse("S:DOM", { set: "DOM" });
  expectParse("t:LEGENDARY", { type: "LEGENDARY" });
});

// ---------------------------------------------------------------------------
// Negation
// ---------------------------------------------------------------------------

test("negation: a leading `-` is NOT understood; the clause becomes a name word", () => {
  // Looks like a real gap: Scryfall's `-t:goblin` means "not a goblin", and
  // here it becomes a name search for the literal text "-t:goblin". The
  // unsupported list does not flag it either, because the "unknown key" regex
  // is anchored on a letter and `-` is not one. Pinned, not endorsed.
  expectParse("-t:goblin", { name: "-t:goblin" });
  expectParse("-c:r", { name: "-c:r" });
  expectParse("-is:foil", { name: "-is:foil" });
  expectParse("-cmc>=3", { name: "-cmc>=3" });
});

test("negation: `!` (exact-name) is not understood either", () => {
  expectParse('!"sol ring"', { name: '!"sol ring"' });
});

test("negation: `!=` exists only as a numeric comparator", () => {
  expectParse("cmc!=0", { cmc: { op: "ne", value: 0 } });
  expectParse("loy!=3", { loyalty: { op: "ne", value: 3 } });
  expectParse("c!=r", {}, ["c!=r"]);
});

// ---------------------------------------------------------------------------
// Unsupported / malformed
// ---------------------------------------------------------------------------

test("unknown `key:value` clauses are reported, in order, and kept out of the name", () => {
  expectParse("bolt is:foil pow>=3 f:modern", { name: "bolt" }, ["is:foil", "pow>=3", "f:modern"]);
});

test("unsupported clauses keep their original case", () => {
  expectParse("IS:Foil", {}, ["IS:Foil"]);
});

test("`name:` is not a facet — it is reported unsupported", () => {
  expectParse('name:"x"', {}, ['name:"x"']);
});

test("shapes that do not look like key-operator clauses stay name words", () => {
  expectParse("=3", { name: "=3" });
  expectParse("x:", {}, ["x:"]);
  expectParse("3:x", { name: "3:x" });
});

// ---------------------------------------------------------------------------
// Matching — the half PostgREST cannot express
// ---------------------------------------------------------------------------

const card = (colors: string[] | null, loyalty: string | null = null) => ({ colors, loyalty });

test("matchesAdvancedCard: colour modes over parsed queries", () => {
  const all = parseScryfallQuery("c:w").filter;
  const exactly = parseScryfallQuery("c=wu").filter;
  const atMost = parseScryfallQuery("c<=wu").filter;

  assert.equal(web.matchesAdvancedCard(card(["W", "U"]), all), true);
  assert.equal(web.matchesAdvancedCard(card(["U"]), all), false);

  assert.equal(web.matchesAdvancedCard(card(["W", "U"]), exactly), true);
  assert.equal(web.matchesAdvancedCard(card(["W"]), exactly), false);
  assert.equal(web.matchesAdvancedCard(card(["W", "U", "B"]), exactly), false);

  assert.equal(web.matchesAdvancedCard(card(["W"]), atMost), true);
  assert.equal(web.matchesAdvancedCard(card(["W", "U"]), atMost), true);
  assert.equal(web.matchesAdvancedCard(card(["W", "B"]), atMost), false);
});

test("matchesAdvancedCard: colourless cards count as C, and C is not 'at most' anything else", () => {
  const colourless = parseScryfallQuery("c:c").filter;
  assert.equal(web.matchesAdvancedCard(card(null), colourless), true);
  assert.equal(web.matchesAdvancedCard(card([]), colourless), true);
  assert.equal(web.matchesAdvancedCard(card(["R"]), colourless), false);
  // A colourless card is {C}; `c<=r` wants a subset of {R}, and {C} is not one.
  assert.equal(web.matchesAdvancedCard(card(null), parseScryfallQuery("c<=r").filter), false);
});

test("matchesAdvancedCard: no colour filter matches everything", () => {
  assert.equal(web.matchesAdvancedCard(card(["R"]), EMPTY_ADVANCED_FILTER), true);
  assert.equal(web.matchesAdvancedCard(card(null), EMPTY_ADVANCED_FILTER), true);
});

test("matchesAdvancedCard: loyalty compares numerically and excludes non-numbers", () => {
  const ge3 = parseScryfallQuery("loy>=3").filter;
  assert.equal(web.matchesAdvancedCard(card([], "3"), ge3), true);
  assert.equal(web.matchesAdvancedCard(card([], "2"), ge3), false);
  assert.equal(web.matchesAdvancedCard(card([], "X"), ge3), false);
  assert.equal(web.matchesAdvancedCard(card([], "1+*"), ge3), false);
  assert.equal(web.matchesAdvancedCard(card([], null), ge3), false);
  const ne3 = parseScryfallQuery("loy!=3").filter;
  // `ne` still needs a number to compare: a null loyalty is excluded, not "not 3".
  assert.equal(web.matchesAdvancedCard(card([], null), ne3), false);
  assert.equal(web.matchesAdvancedCard(card([], "4"), ne3), true);
});

// ---------------------------------------------------------------------------
// Parity with the shared / mobile copy
// ---------------------------------------------------------------------------

/**
 * A broad corpus: every family, every comparator, quoting, case, negation,
 * malformed input. Add to it freely — the parity test costs nothing per entry.
 */
const CORPUS: string[] = [
  "", " ", "\t\n", "lightning bolt", "  sol    ring  ", "Sol RING", "a\tb\nc",
  '"sol ring"', '"a b" c', '""', '"', 'a"b c"', '"a"b', '!"sol ring"',
  "c:r", "c:wu", "c=wu", "c<=wu", "c>=wu", "c<wu", "c>wu", "c!=r",
  "color:red,blue", "color=green", "color<=w", "c:wubrg", "c:c", "c:colorless",
  "c:wu,green", "c:w,red", "c:rr", "c:rx", "c:r,", "c:,r", "c:xyz", "c:", "c=", "c<=",
  "c:é", "c: r", 'c:"red"', 'c:"blue"', 'c:"r u"', "C:R", "c:RED", "COLOR=WU", "c:r c:u", "c=r c:u",
  "ci:wu", "id<=wu",
  "cmc:3", "cmc=3", "cmc!=3", "cmc>3", "cmc>=3", "cmc<3", "cmc<=3", "mv:3", "mv>=3", "MV<3",
  "cmc>=-1.5", "cmc:2.5", "cmc:abc", "cmc>=", "cmc:3.", "cmc:.5", "cmc:+3", "cmc==3", "cmc=>3",
  "cmc:1 cmc:2",
  "loy:5", "loy=5", "loy!=5", "loy>5", "loy>=5", "loy<5", "loy<=5", "loyalty>=3", "LOY:5",
  "loy!=X", "loy:x", "loy>=3 loyalty<2",
  "t:elf", "type:elf", 't:"legendary creature"', "T:Elf", "t:", "t:a t:b", "t=elf",
  't:legendary"x y"', 't:"a"b', 't:"unterminated foo', 't:"', 't:"x" "y z"',
  "o:draw", "oracle:draw", 'o:"draw a card"', "O:Draw", "o:",
  "s:dom", "set:dom", 'set:"a b"', "S:DOM", "s:", "s>=dom",
  "r:rare", "rarity:rare", "R:Mythic", "r:", "r!=common",
  "-t:goblin", "-c:r", "-is:foil", "-cmc>=3", "-", "--t:x",
  "is:foil", "pow>=3", "tou<2", "f:modern", "name:\"x\"", "x:", "=3", "3:x", "IS:Foil",
  "bolt is:foil pow>=3",
  'goblin c:r cmc<=2 t:"legendary creature" s:dom r:rare',
  'goblin c=r cmc<=2 loy>3 t:"legendary creature" o:haste s:dom r:rare',
  "cmc<=2 c:r", "c:r goblin guide", "goblin c:r guide",
  // Non-ASCII whitespace and zero-width characters, written as escapes so an
  // editor or shell cannot quietly normalise them. \s matches the first four;
  // the last two are not \s, which is where engines can differ.
  "\u00a0c:r", "a\u00a0b", "c:r\u2003u", "\u3000bolt", "c:r\u2003goblin",
  "\u200bbolt", "\ufeffbolt",
];

test("parity: web and shared parsers return identical output across the corpus", () => {
  for (const query of CORPUS) {
    assert.deepEqual(
      parseScryfallQuery(query),
      shared.parseScryfallQuery(query),
      `parsers disagree on ${JSON.stringify(query)}`,
    );
  }
});

test("parity: the corpus is not vacuous — it reaches every facet and unsupported", () => {
  const seen = new Set<string>();
  for (const query of CORPUS) {
    const { filter, unsupported } = parseScryfallQuery(query);
    if (filter.name) seen.add("name");
    if (filter.colors.length) seen.add("colors");
    if (filter.colorMode !== "all") seen.add(`mode:${filter.colorMode}`);
    if (filter.cmc) seen.add(`cmc:${filter.cmc.op}`);
    if (filter.loyalty) seen.add(`loy:${filter.loyalty.op}`);
    if (filter.type) seen.add("type");
    if (filter.oracle) seen.add("oracle");
    if (filter.set) seen.add("set");
    if (filter.rarity) seen.add("rarity");
    if (unsupported.length) seen.add("unsupported");
  }
  for (const expected of [
    "name", "colors", "mode:exactly", "mode:atMost",
    "cmc:eq", "cmc:ne", "cmc:gt", "cmc:gte", "cmc:lt", "cmc:lte",
    "loy:eq", "loy:ne", "loy:gt", "loy:gte", "loy:lt", "loy:lte",
    "type", "oracle", "set", "rarity", "unsupported",
  ]) {
    assert.ok(seen.has(expected), `corpus never exercises ${expected}`);
  }
});

test("parity: EMPTY_ADVANCED_FILTER and the vocabularies agree", () => {
  assert.deepEqual(EMPTY_ADVANCED_FILTER, shared.EMPTY_ADVANCED_FILTER);
  assert.deepEqual(webFilters.COLORS, shared.COLORS);
  assert.deepEqual(webFilters.COLOR_MODES, shared.COLOR_MODES);
  assert.deepEqual(webFilters.NUMERIC_OPS, shared.NUMERIC_OPS);
});

test("parity: isAdvancedFilterActive agrees on every corpus filter", () => {
  for (const query of CORPUS) {
    const { filter } = parseScryfallQuery(query);
    assert.equal(web.isAdvancedFilterActive(filter), shared.isAdvancedFilterActive(filter), query);
  }
});

test("parity: matchesAdvancedCard agrees over a grid of cards", () => {
  const colourSets: Array<string[] | null> = [
    null, [], ["W"], ["R"], ["W", "U"], ["U", "W"], ["W", "B"], ["W", "U", "B", "R", "G"], ["C"], ["X"],
  ];
  const loyalties: Array<string | null> = [null, "", "0", "3", "4", "-1", "2.5", "X", "1+*", "*"];
  for (const query of CORPUS) {
    const { filter } = parseScryfallQuery(query);
    for (const colors of colourSets) {
      for (const loyalty of loyalties) {
        assert.equal(
          web.matchesAdvancedCard({ colors, loyalty }, filter),
          shared.matchesAdvancedCard({ colors, loyalty }, filter),
          `${JSON.stringify(query)} vs colors=${JSON.stringify(colors)} loyalty=${JSON.stringify(loyalty)}`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Known divergences
//
// None concern what parseScryfallQuery returns. They are differences in what
// each module exports. Each test asserts both sides so that closing the gap
// (in either direction) breaks it and the entry must be removed on purpose.
// ---------------------------------------------------------------------------

test("known divergence: looksLikeScryfallSyntax exists only in the shared module", () => {
  // Mobile's search box uses it to decide between a plain name query and the
  // syntax reader. The web header search calls parseScryfallQuery directly, so
  // never needed it.
  assert.equal("looksLikeScryfallSyntax" in web, false);
  assert.equal(typeof shared.looksLikeScryfallSyntax, "function");
});

test("known divergence: advancedFacetCount exists only in the shared module", () => {
  // Backs mobile's "Filters (3)" badge; the web panel has no equivalent.
  assert.equal("advancedFacetCount" in web, false);
  assert.equal(typeof shared.advancedFacetCount, "function");
});

test("known divergence: the URL round trip exists only in the web module", () => {
  // Web filters live in the query string; mobile holds them in component state.
  assert.equal(typeof web.advancedFilterToParams, "function");
  assert.equal(typeof web.advancedFilterFromParams, "function");
  assert.equal("advancedFilterToParams" in shared, false);
  assert.equal("advancedFilterFromParams" in shared, false);
});

test("known divergence: the two modules re-implement, not share, the matching helpers", () => {
  // web/search-query.ts imports matchesColors/matchesNumeric/statToNumber/
  // colorsOf from collection/filters.ts; the shared module carries its own
  // copies. They agree today (see the parity grid above) but nothing ties them.
  assert.notEqual(webFilters.matchesColors, shared.matchesColors);
  assert.notEqual(webFilters.matchesNumeric, shared.matchesNumeric);
  assert.notEqual(webFilters.statToNumber, shared.statToNumber);
  assert.notEqual(webFilters.colorsOf, shared.colorsOf);
});
