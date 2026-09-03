/**
 * Public Supabase config resolution.
 *
 * The production incident: routing NEXT_PUBLIC_* through a dynamic
 * `process.env[name]` lookup meant Next.js never inlined the values into the
 * Edge middleware bundle, so `publicSupabaseConfig()` threw on every request.
 * The fix reads them as literal member expressions; these tests pin the
 * behaviour (valid values pass through, missing values fail loudly by name).
 *
 * Run with: npx tsx --test scripts/env.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { publicSupabaseConfig } from "../src/lib/env";

const URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
const ANON_KEY = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("returns url and anonKey when both are set", () => {
  withEnv(
    { [URL_KEY]: "https://example.supabase.co", [ANON_KEY]: "anon-123" },
    () => {
      assert.deepEqual(publicSupabaseConfig(), {
        url: "https://example.supabase.co",
        anonKey: "anon-123",
      });
    },
  );
});

test("throws naming the URL var when it is missing", () => {
  withEnv({ [URL_KEY]: undefined, [ANON_KEY]: "anon-123" }, () => {
    assert.throws(() => publicSupabaseConfig(), /NEXT_PUBLIC_SUPABASE_URL/);
  });
});

test("throws naming the anon key var when it is missing", () => {
  withEnv(
    { [URL_KEY]: "https://example.supabase.co", [ANON_KEY]: undefined },
    () => {
      assert.throws(
        () => publicSupabaseConfig(),
        /NEXT_PUBLIC_SUPABASE_ANON_KEY/,
      );
    },
  );
});

test("treats an empty string as missing", () => {
  withEnv({ [URL_KEY]: "", [ANON_KEY]: "anon-123" }, () => {
    assert.throws(() => publicSupabaseConfig(), /NEXT_PUBLIC_SUPABASE_URL/);
  });
});
