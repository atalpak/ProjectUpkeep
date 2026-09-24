/**
 * Tests for the COPY CSV encoder. The property that matters is that NULL and
 * the empty string stay different, and that nothing in Scryfall's text (quotes,
 * commas, newlines, braces, backslashes) can break out of its field.
 *
 * The text is also parsed back with a small reader that follows Postgres's CSV
 * rules, so a bug in escaping shows up as a round-trip mismatch and not only
 * as a string that no longer matches our own expectation.
 *
 * Run with: npx tsx --test scripts/pg-copy.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { copyField, copyLine, pgArrayLiteral } from "../src/lib/pg-copy";

/** Minimal COPY ... CSV reader: unquoted empty = null, quoted = value, "" = quote. */
function parseCsvLine(line: string): (string | null)[] {
  const fields: (string | null)[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let value = "";
      i += 1;
      for (;;) {
        if (line[i] === '"' && line[i + 1] === '"') {
          value += '"';
          i += 2;
        } else if (line[i] === '"') {
          i += 1;
          break;
        } else {
          value += line[i];
          i += 1;
        }
      }
      fields.push(value);
    } else {
      let value = "";
      while (i < line.length && line[i] !== ",") {
        value += line[i];
        i += 1;
      }
      fields.push(value === "" ? null : value);
    }
    i += 1; // the comma
  }
  return fields;
}

test("null is an unquoted empty field, the empty string is a quoted one", () => {
  assert.equal(copyField(null), "");
  assert.equal(copyField(undefined), "");
  assert.equal(copyField(""), '""');
  assert.equal(copyLine([null, "", "x"]), ',"","x"\n');
});

test("strings are always quoted and quotes are doubled", () => {
  assert.equal(copyField('say "hi"'), '"say ""hi"""');
  assert.equal(copyField("a,b"), '"a,b"');
  assert.equal(copyField("line1\nline2"), '"line1\nline2"');
});

test("numbers and booleans", () => {
  assert.equal(copyField(0), '"0"');
  assert.equal(copyField(2.5), '"2.5"');
  assert.equal(copyField(true), '"t"');
  assert.equal(copyField(false), '"f"');
  assert.throws(() => copyField(Number.NaN), /non-finite/);
});

test("arrays become Postgres array literals with every element quoted", () => {
  assert.equal(pgArrayLiteral([]), "{}");
  assert.equal(pgArrayLiteral(["W", "U"]), '{"W","U"}');
  assert.equal(pgArrayLiteral(['a"b', "c\\d", "e,f", "{g}"]), '{"a\\"b","c\\\\d","e,f","{g}"}');
  assert.equal(copyField(["W", "U"]), '"{""W"",""U""}"');
  assert.equal(copyField([]), '"{}"');
});

test("objects become JSON", () => {
  assert.equal(copyField({ modern: "legal" }), '"{""modern"":""legal""}"');
  assert.equal(copyField({}), '"{}"');
});

test("a NUL byte is dropped rather than failing the load", () => {
  assert.equal(copyField("a\u0000b"), '"ab"');
  // In jsonb the NUL would otherwise survive as the text \u0000, which jsonb rejects.
  assert.equal(copyField({ "k\u0000": "v\u0000w" }), '"{""k"":""vw""}"');
  assert.equal(copyField(["x\u0000y"]), '"{""xy""}"');
});

test("a nasty row round-trips through a CSV reader", () => {
  const text = 'Deals "3" damage, then\nthe {R} cost\\n stays';
  const line = copyLine(["id", text, null, "", ["W", "U"], { modern: "legal" }, 1, true]);
  assert.ok(line.endsWith("\n"));
  const parsed = parseCsvLine(line.slice(0, -1));
  assert.deepEqual(parsed, ["id", text, null, "", '{"W","U"}', '{"modern":"legal"}', "1", "t"]);
});
