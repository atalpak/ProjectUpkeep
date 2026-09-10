/**
 * The pure half of the feedback form.
 *
 * `sendFeedback` is a "use server" action, so its input check and its
 * DB-error wording were pulled into src/lib/feedback/validate.ts to be covered
 * here rather than only through a live insert. The limits mirror migration 29's
 * feedback_body_length / feedback_page_length checks.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_BODY_LENGTH,
  MAX_PAGE_LENGTH,
  feedbackErrorMessage,
  validateFeedback,
} from "../src/lib/feedback/validate";

test("an empty body is rejected", () => {
  const result = validateFeedback("", "/collection");
  assert.deepEqual(result, { error: "Type a little something first." });
});

test("a whitespace-only body is rejected — JS .trim() strips tabs and newlines", () => {
  assert.ok("error" in validateFeedback("   ", "/collection"));
  assert.ok("error" in validateFeedback("\t\n  \n", "/collection"));
  assert.ok("error" in validateFeedback("\f\v\r", "/collection"));
});

test("a missing body (null/undefined) is rejected, not coerced to 'null'", () => {
  assert.ok("error" in validateFeedback(null, "/collection"));
  assert.ok("error" in validateFeedback(undefined, "/collection"));
});

test("a body one over the cap is rejected", () => {
  const result = validateFeedback("x".repeat(MAX_BODY_LENGTH + 1), "/collection");
  assert.deepEqual(result, {
    error: `Keep it under ${MAX_BODY_LENGTH.toLocaleString()} characters.`,
  });
});

test("a body exactly at the cap passes", () => {
  const body = "x".repeat(MAX_BODY_LENGTH);
  assert.deepEqual(validateFeedback(body, "/collection"), {
    body,
    page: "/collection",
  });
});

test("the cap is measured after trimming — surrounding space does not count", () => {
  const body = `  ${"x".repeat(MAX_BODY_LENGTH)}  `;
  assert.deepEqual(validateFeedback(body, "/collection"), {
    body: "x".repeat(MAX_BODY_LENGTH),
    page: "/collection",
  });
});

test("an over-long page is dropped to null rather than rejecting the submit", () => {
  const result = validateFeedback("real message", "/x".repeat(MAX_PAGE_LENGTH));
  assert.deepEqual(result, { body: "real message", page: null });
});

test("a page at the length limit is kept", () => {
  const page = "/".repeat(MAX_PAGE_LENGTH);
  assert.deepEqual(validateFeedback("real message", page), {
    body: "real message",
    page,
  });
});

test("an empty or missing page becomes null", () => {
  assert.deepEqual(validateFeedback("hi", ""), { body: "hi", page: null });
  assert.deepEqual(validateFeedback("hi", null), { body: "hi", page: null });
  assert.deepEqual(validateFeedback("hi", undefined), { body: "hi", page: null });
});

test("valid input passes straight through, body trimmed", () => {
  assert.deepEqual(validateFeedback("  the import screen hangs  ", "/decks"), {
    body: "the import screen hangs",
    page: "/decks",
  });
});

test("feedbackErrorMessage maps the body-length constraint to its sentence", () => {
  const raw =
    'new row for relation "feedback" violates check constraint "feedback_body_length"';
  assert.equal(
    feedbackErrorMessage(raw),
    `Keep it between 1 and ${MAX_BODY_LENGTH.toLocaleString()} characters.`,
  );
});

test("feedbackErrorMessage gives a generic line for anything else", () => {
  const generic = "Couldn't send that — try again.";
  assert.equal(feedbackErrorMessage("some other postgres error"), generic);
  assert.equal(feedbackErrorMessage(null), generic);
  assert.equal(feedbackErrorMessage(undefined), generic);
});
