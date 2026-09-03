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

test("open offers route to the friends page, settled ones to the archive", () => {
  assert.equal(notificationHref("trade_proposed"), "/friends");
  assert.equal(notificationHref("trade_countered"), "/friends");
  assert.equal(notificationHref("trade_accepted"), "/trades");
  assert.equal(notificationHref("trade_declined"), "/trades");
  assert.equal(notificationHref("trade_cancelled"), "/trades");
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
