/** Run with: npm test -w @upkeep/domain */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  builderToQuery, readPresentation, setDirective, specFromParams, specToParams,
  tokenizeQuery, validateSpec, resolveDisplay,
} from "../src/catalog-search";

const roundTrip = (q: string) => specFromParams(specToParams({ q, page: 1 })).q;

test("transport keeps quotes, regex, braces, + & # / and unicode intact", () => {
  for (const q of [
    'o:"draw a card"', "o:/\\sm/ t:creature", "m:{W/U}", "name:/a\\/b/", "a+b & c#d",
    "!\"Sol Ring\"", "t:elf   t:goblin", "é ñ 日本", 'o:"line\\nbreak"', "++ @@",
  ]) assert.equal(roundTrip(q), q);
});

test("length limit counts code points, does not truncate", () => {
  assert.equal(validateSpec({ q: "😀".repeat(1000), page: 1 }).ok, true);
  const bad = validateSpec({ q: "😀".repeat(1001), page: 1 });
  assert.equal(bad.ok, false);
  assert.equal(validateSpec({ q: "  ", page: 1 }).ok, false);
});

test("directives outside quotes are read, inside quotes/regex are not", () => {
  assert.equal(readPresentation("t:forest unique:art display:text").display, "text");
  assert.equal(readPresentation('o:"display:text"').display, undefined);
  assert.equal(readPresentation("o:/order:name/").order, undefined);
  assert.equal(readPresentation("sort:usd").order, "usd");
  assert.equal(readPresentation("@@").unique, "art");
  assert.equal(readPresentation("(order:cmc)").order, "cmc");
  assert.deepEqual(readPresentation("order:cmc order:usd").duplicates, ["order"]);
});

test("setDirective rewrites, appends, and refuses duplicates", () => {
  assert.equal(setDirective("t:elf order:name", "order", "usd"), "t:elf order:usd");
  assert.equal(setDirective("t:elf", "unique", "prints"), "t:elf unique:prints");
  assert.equal(setDirective('o:"order:name" t:elf', "order", "usd"), 'o:"order:name" t:elf order:usd');
  assert.equal(setDirective("order:a order:b", "order", "usd"), null);
  assert.equal(setDirective("t:elf unique:art", "unique", null), "t:elf");
});

test("tokenizer keeps quoted and regex values whole", () => {
  assert.deepEqual(tokenizeQuery('t:elf o:"a b" o:/x y/ (a or b)').map((t) => t.text),
    ["t:elf", 'o:"a b"', "o:/x y/", "(", "a", "or", "b", ")"]);
});

test("legacy URLs: raw wins, facets translate once", () => {
  assert.equal(specFromParams(new URLSearchParams("raw=t:elf&colors=r")).q, "t:elf");
  assert.equal(specFromParams(new URLSearchParams("q=t:elf")).q, "t:elf");
  assert.equal(specFromParams(new URLSearchParams("cmc=gte:3&type=elf")).q, "mv>=3 t:elf");
  assert.equal(specFromParams(new URLSearchParams("colors=r,g&colorMode=atMost")).q, "c<=rg");
  assert.equal(specFromParams({ q: "x", page: "0", include_extras: "yes" }).includeExtras, undefined);
});

test("display precedence: inline beats control", () => {
  assert.equal(resolveDisplay({ q: "t:x display:text", page: 1, display: "full" }), "text");
  assert.equal(resolveDisplay({ q: "t:x", page: 1, display: "full" }), "full");
});

test("builder: grouped OR, separate clauses, colorless, no hidden paper/prefer", () => {
  assert.equal(builderToQuery({ types: { include: ["legendary", "elf"], exclude: ["artifact"] } }),
    "t:legendary t:elf -t:artifact");
  assert.equal(builderToQuery({ types: { include: ["elf", "bird"], exclude: [], anyOf: true } }), "(t:elf or t:bird)");
  assert.equal(builderToQuery({ colors: { letters: [], mode: "includes", colorless: true } }), "c:c");
  assert.equal(builderToQuery({ colors: { letters: ["R", "G"], mode: "atMost" } }), "c<=rg");
  assert.equal(builderToQuery({ sets: ["lea", "leb"], rarities: ["r"] }), "(e:lea or e:leb) r:r");
  assert.equal(builderToQuery({ oracle: { value: 'say "hi"', mode: "phrase" } }), 'o:"say \\"hi\\""');
  assert.equal(builderToQuery({ oracle: { value: "draw card", mode: "words" } }), "o:draw o:card");
  assert.equal(builderToQuery({ name: { value: "Sol Ring", mode: "phrase", exact: true } }), '!"Sol Ring"');
  assert.equal(builderToQuery({ lore: { value: "urza", mode: "words" } }), "lore:urza");
  assert.equal(builderToQuery({ stats: [{ field: "mv", op: ">=", value: "2" }, { field: "mv", op: "<=", value: "4" }] }),
    "mv>=2 mv<=4");
});

import { setOnlyCode } from "../src/catalog-search";

test("set-only detection is narrow", () => {
  assert.equal(setOnlyCode("e:lea"), "lea");
  assert.equal(setOnlyCode(" set:MH3 "), "mh3");
  for (const q of ["-e:lea", "e:lea t:elf", "e:lea or e:leb", "(e:lea)", "e:lea unique:cards", "t:elf", 'e:"lea"']) {
    assert.equal(setOnlyCode(q), null, q);
  }
});
