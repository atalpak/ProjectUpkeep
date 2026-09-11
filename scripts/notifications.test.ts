/**
 * Notification wording and routing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  notificationHref,
  notificationSentence,
  relativeTime,
} from "../src/lib/social/notifications";
import { NOTIFICATION_TYPES } from "../src/lib/social/types";

test("every notification type has a sentence naming the actor", () => {
  for (const type of NOTIFICATION_TYPES) {
    const sentence = notificationSentence(type, "Alice");
    assert.ok(sentence.includes("Alice"), `${type} should name the actor`);
    assert.ok(sentence.endsWith("."), `${type} should read as a sentence`);
  }
});

test("every trade notification routes to the friends page, open or settled", () => {
  assert.equal(notificationHref("trade_proposed"), "/friends");
  assert.equal(notificationHref("trade_countered"), "/friends");
  assert.equal(notificationHref("trade_accepted"), "/friends");
  assert.equal(notificationHref("trade_declined"), "/friends");
  assert.equal(notificationHref("trade_cancelled"), "/friends");
});

test("a notification naming a trade links to that trade specifically", () => {
  // Same destination page as before, plus the id so it can be picked out of
  // the list rather than left for you to find.
  assert.equal(notificationHref("trade_proposed", "abc-123"), "/friends?trade=abc-123");
  assert.equal(notificationHref("trade_accepted", "abc-123"), "/friends?trade=abc-123");
});

test("no trade id, or a null one, leaves the plain list link untouched", () => {
  assert.equal(notificationHref("trade_proposed"), "/friends");
  assert.equal(notificationHref("trade_proposed", null), "/friends");
  assert.equal(notificationHref("trade_proposed", undefined), "/friends");
});

test("a trade id with characters that need escaping is encoded", () => {
  assert.equal(notificationHref("trade_accepted", "a/b c"), "/friends?trade=a%2Fb%20c");
});

test("relativeTime scales from minutes to a date", () => {
  const now = Date.parse("2026-09-01T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  assert.equal(relativeTime(ago(10_000), now), "just now");
  assert.equal(relativeTime(ago(5 * 60_000), now), "5m ago");
  assert.equal(relativeTime(ago(3 * 3_600_000), now), "3h ago");
  assert.equal(relativeTime(ago(2 * 86_400_000), now), "2d ago");
  assert.equal(relativeTime(ago(30 * 86_400_000), now), new Date(ago(30 * 86_400_000)).toLocaleDateString());
});
