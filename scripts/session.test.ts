/**
 * The proxy's private-route gate: which paths are reachable without a session.
 *
 * This is a security boundary — a path wrongly treated as public serves a
 * signed-out visitor a page that assumes a user. `isPublicPath` matches by
 * prefix, so the risk is a too-broad entry in PUBLIC_PATHS; these tests pin
 * down that the private areas stay private and only the intended routes open.
 *
 * Run with: npx tsx --test scripts/session.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { isPublicPath, PUBLIC_PATHS } from "../src/lib/supabase/session";

test("the public routes, and their sub-paths, are reachable without a session", () => {
  for (const path of ["/login", "/signup", "/auth", "/terms", "/privacy"]) {
    assert.equal(isPublicPath(path), true, `${path} should be public`);
    assert.equal(isPublicPath(`${path}/anything`), true, `${path}/anything should be public`);
  }
  assert.equal(isPublicPath("/"), true, "the marketing home page is public");
});

test("the signed-in app is not public", () => {
  for (const path of [
    "/collection",
    "/collection/import",
    "/locations",
    "/decks",
    "/find",
    "/dashboard",
    "/friends",
    "/trades",
    "/wants",
    "/notifications",
    "/settings",
    "/u/someone",
  ]) {
    assert.equal(isPublicPath(path), false, `${path} must stay behind the login gate`);
  }
});

test("the legal pages are the only additions beyond auth routes", () => {
  // A guard on the list itself: if someone adds a broad entry here, this fails
  // and sends them to think about the prefix match before it ships.
  assert.deepEqual(PUBLIC_PATHS, ["/login", "/signup", "/auth", "/terms", "/privacy"]);
});
