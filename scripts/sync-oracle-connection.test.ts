/**
 * Tests for how the oracle loader builds its connection. Each refusal is a
 * mistake that would otherwise fail somewhere unhelpful (ENETUNREACH on a
 * runner, a staging table that vanishes between statements) or, worse, not
 * fail at all (a connection that encrypts but never checks who it is talking to).
 *
 * Run with: npx tsx --test scripts/sync-oracle-connection.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { connectionOptions } from "./sync-oracle-connection";

const POOLER = "postgresql://scryfall_loader.abcdefghij:s3cret%2Fpw@aws-0-us-east-1.pooler.supabase.com:5432/postgres";

test("parses the session-pooler URL, decoding the password", () => {
  const o = connectionOptions(POOLER);
  assert.equal(o.host, "aws-0-us-east-1.pooler.supabase.com");
  assert.equal(o.port, 5432);
  assert.equal(o.database, "postgres");
  assert.equal(o.username, "scryfall_loader.abcdefghij");
  assert.equal(o.password, "s3cret/pw");
  assert.equal(o.max, 1, "one session: the staging table lives on it");
});

test("TLS is always an object that verifies, never 'require'", () => {
  const o = connectionOptions(POOLER);
  assert.equal(typeof o.ssl, "object");
  assert.deepEqual(o.ssl, { rejectUnauthorized: true });
});

test("a URL that asks for sslmode=require cannot downgrade verification", () => {
  for (const suffix of ["?sslmode=require", "?sslmode=disable", "?ssl=false", "?sslmode=prefer"]) {
    const o = connectionOptions(POOLER + suffix);
    assert.deepEqual(o.ssl, { rejectUnauthorized: true }, suffix);
  }
});

test("a supplied CA is passed through and verification stays on", () => {
  const pem = "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n";
  assert.deepEqual(connectionOptions(POOLER, pem).ssl, { rejectUnauthorized: true, ca: pem });
});

test("refuses transaction mode (port 6543)", () => {
  assert.throws(() => connectionOptions(POOLER.replace(":5432", ":6543")), /transaction mode/);
});

test("refuses the IPv6-only direct host", () => {
  assert.throws(
    () => connectionOptions("postgresql://scryfall_loader:pw@db.abcdefghij.supabase.co:5432/postgres"),
    /IPv6-only direct host/,
  );
});

test("refuses garbage, other schemes and missing credentials, without echoing the password", () => {
  assert.throws(() => connectionOptions("not a url"), /not a valid URL/);
  assert.throws(() => connectionOptions("https://example.com/"), /postgresql:\/\//);
  assert.throws(() => connectionOptions("postgresql://host:5432/postgres"), /user and a password/);
  try {
    connectionOptions("postgresql://u:hunter2@db.abcdefghij.supabase.co:5432/postgres");
    assert.fail("expected a throw");
  } catch (error) {
    assert.doesNotMatch((error as Error).message, /hunter2/);
  }
});
