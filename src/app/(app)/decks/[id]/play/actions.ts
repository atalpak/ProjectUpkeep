"use server";

/**
 * Server actions for Play mode: saved games and shared tables. Every one of
 * them follows the same five rules, and they are the reason this file is small
 * and repetitive rather than clever:
 *
 *  1. The OWNER comes from `auth.getUser()`, never from an argument.
 *  2. The DECK comes from the route (`page.tsx` binds it; Next encrypts bound
 *     arguments), and is still re-checked here: it must exist, be a deck, and
 *     have `user_id` = the caller. RLS alone is not enough for that, because a
 *     friend can READ your public deck (migration 35), so "the deck row came
 *     back" does not mean "the deck is mine" (CLAUDE.md hard constraint 3).
 *  3. The snapshot is UNTRUSTED input. It is run through `validateSnapshot`
 *     (which also upgrades an old version), must name the route's deck, is
 *     re-serialised to its canonical form, and is refused if it is over the
 *     cap BEFORE the database sees it. The preview is computed here from the
 *     validated state, never taken from the client.
 *  4. These actions touch ONLY `playtest_sessions` and `playtest_shares`, and
 *     read `locations` to check the deck. They never write `deck_cards`,
 *     `card_instances`, `locations` or ownership, and never call `rpc`.
 *     `scripts/playtest-boundary.test.ts` reads this file and fails if that
 *     stops being true: it is the mechanical form of "playing never writes the
 *     collection".
 *  5. Failures return `{ ok: false, message }` in plain words (database errors
 *     are mapped through `playtestErrorMessage`); nothing here throws at the UI.
 *
 * A "use server" file may export only async functions, so the helpers are not
 * exported and the shared result types live in `src/lib/playtest/session.ts`.
 * The play UI receives these as props from `page.tsx` and never imports this
 * file (lint forbids it), so nothing under `src/components/playtester` reaches
 * into the route.
 */

import { createClient } from "@/lib/supabase/server";
import { playtestErrorMessage } from "@/lib/supabase/errors";
import { projectPublic, PROJECTION_VERSION } from "@/lib/playtest/board/share";
import { SnapshotValidationError, validateSnapshot } from "@/lib/playtest/board/serialize";
import type { GameState } from "@/lib/playtest/board/types";
import {
  MAX_PROJECTION_CHARS,
  cleanTitle,
  copyTitle,
  prepareSave,
  readPreview,
  type ActionResult,
  type SessionSummary,
  type ShareSummary,
} from "@/lib/playtest/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Authorized = { supabase: Supabase; userId: string; deckName: string };

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

async function authorize(deckId: string): Promise<Authorized | { ok: false; message: string }> {
  if (typeof deckId !== "string" || !UUID.test(deckId)) return fail("That deck could not be found.");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return fail("You need to be signed in.");

  // user_id = caller AND type = 'deck': see rule 2 above.
  const { data: deck, error: deckError } = await supabase
    .from("locations")
    .select("id, name, user_id, type")
    .eq("id", deckId)
    .eq("user_id", data.user.id)
    .eq("type", "deck")
    .maybeSingle();
  if (deckError) return fail(playtestErrorMessage(deckError));
  if (!deck) return fail("That deck could not be found.");
  return { supabase, userId: data.user.id, deckName: deck.name as string };
}

function isFailure(value: Authorized | { ok: false; message: string }): value is { ok: false; message: string } {
  return "ok" in value;
}

/** Validates an untrusted snapshot for THIS deck and prepares what to store. */
function checked(deckId: string, snapshot: unknown): { state: GameState; canonical: string; preview: ReturnType<typeof readPreview> } | { ok: false; message: string } {
  let state: GameState;
  try {
    state = validateSnapshot(snapshot);
  } catch (err) {
    if (err instanceof SnapshotValidationError) return fail(`That game could not be saved: ${err.message}`);
    throw err;
  }
  if (state.deckId !== deckId) return fail("That game belongs to a different deck.");
  const prepared = prepareSave(state);
  if ("error" in prepared) return fail(prepared.error);
  return { state: prepared.state, canonical: prepared.canonical, preview: prepared.preview };
}

const SESSION_COLUMNS = "id, title, updated_at, source_fingerprint, preview";

type SessionRow = { id: string; title: string; updated_at: string; source_fingerprint: string; preview: unknown };

function toSummary(row: SessionRow): SessionSummary {
  return { id: row.id, title: row.title, updatedAt: row.updated_at, sourceFingerprint: row.source_fingerprint, preview: readPreview(row.preview) };
}

const CONFLICT = "This save was changed in another tab, or deleted. Save as a copy instead?";

export async function saveSession(deckId: string, input: { title: string; snapshot: unknown }): Promise<ActionResult<{ session: SessionSummary }>> {
  const auth = await authorize(deckId);
  if (isFailure(auth)) return auth;
  const title = cleanTitle(input?.title);
  if (!title) return fail("Give this save a name.");
  const ready = checked(deckId, input?.snapshot);
  if ("ok" in ready) return ready;

  const { data, error } = await auth.supabase
    .from("playtest_sessions")
    .insert({
      owner_user_id: auth.userId,
      deck_id: deckId,
      title,
      schema_version: ready.state.schemaVersion,
      source_fingerprint: ready.state.source.fingerprint,
      snapshot: JSON.parse(ready.canonical),
      preview: ready.preview,
    })
    .select(SESSION_COLUMNS)
    .single();
  if (error || !data) return fail(playtestErrorMessage(error ?? {}));
  return { ok: true, session: toSummary(data as SessionRow) };
}

export async function overwriteSession(
  deckId: string,
  input: { id: string; expectedUpdatedAt: string; snapshot: unknown },
): Promise<ActionResult<{ session: SessionSummary }>> {
  const auth = await authorize(deckId);
  if (isFailure(auth)) return auth;
  if (!UUID.test(String(input?.id)) || typeof input?.expectedUpdatedAt !== "string") return fail("That save could not be found.");
  const ready = checked(deckId, input.snapshot);
  if ("ok" in ready) return ready;

  // Filtered on the owner, the deck AND the last-seen updated_at: a save that
  // another tab has touched since is a conflict, not a silent overwrite.
  const { data, error } = await auth.supabase
    .from("playtest_sessions")
    .update({
      schema_version: ready.state.schemaVersion,
      source_fingerprint: ready.state.source.fingerprint,
      snapshot: JSON.parse(ready.canonical),
      preview: ready.preview,
    })
    .eq("id", input.id)
    .eq("owner_user_id", auth.userId)
    .eq("deck_id", deckId)
    .eq("updated_at", input.expectedUpdatedAt)
    .select(SESSION_COLUMNS);
  if (error) return fail(playtestErrorMessage(error));
  if (!data || data.length === 0) return fail(CONFLICT);
  return { ok: true, session: toSummary(data[0] as SessionRow) };
}

export async function renameSession(deckId: string, input: { id: string; title: string }): Promise<ActionResult<{ session: SessionSummary }>> {
  const auth = await authorize(deckId);
  if (isFailure(auth)) return auth;
  const title = cleanTitle(input?.title);
  if (!title) return fail("Give this save a name.");
  if (!UUID.test(String(input?.id))) return fail("That save could not be found.");

  const { data, error } = await auth.supabase
    .from("playtest_sessions")
    .update({ title })
    .eq("id", input.id)
    .eq("owner_user_id", auth.userId)
    .eq("deck_id", deckId)
    .select(SESSION_COLUMNS);
  if (error) return fail(playtestErrorMessage(error));
  if (!data || data.length === 0) return fail("That save could not be found.");
  return { ok: true, session: toSummary(data[0] as SessionRow) };
}

export async function duplicateSession(deckId: string, input: { id: string }): Promise<ActionResult<{ session: SessionSummary }>> {
  const auth = await authorize(deckId);
  if (isFailure(auth)) return auth;
  if (!UUID.test(String(input?.id))) return fail("That save could not be found.");

  // Read the owner's own row (owner + deck filtered) and insert a copy of it.
  // The copy counts against the quota like any other save.
  const { data: source, error: readError } = await auth.supabase
    .from("playtest_sessions")
    .select("title, schema_version, source_fingerprint, snapshot, preview")
    .eq("id", input.id)
    .eq("owner_user_id", auth.userId)
    .eq("deck_id", deckId)
    .maybeSingle();
  if (readError) return fail(playtestErrorMessage(readError));
  if (!source) return fail("That save could not be found.");

  const { data, error } = await auth.supabase
    .from("playtest_sessions")
    .insert({
      owner_user_id: auth.userId,
      deck_id: deckId,
      title: copyTitle(source.title as string),
      schema_version: source.schema_version,
      source_fingerprint: source.source_fingerprint,
      snapshot: source.snapshot,
      preview: source.preview,
    })
    .select(SESSION_COLUMNS)
    .single();
  if (error || !data) return fail(playtestErrorMessage(error ?? {}));
  return { ok: true, session: toSummary(data as SessionRow) };
}

export async function deleteSession(deckId: string, input: { id: string }): Promise<ActionResult> {
  const auth = await authorize(deckId);
  if (isFailure(auth)) return auth;
  if (!UUID.test(String(input?.id))) return fail("That save could not be found.");

  const { error } = await auth.supabase
    .from("playtest_sessions")
    .delete()
    .eq("id", input.id)
    .eq("owner_user_id", auth.userId)
    .eq("deck_id", deckId);
  if (error) return fail(playtestErrorMessage(error));
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Shares                                                              */
/* ------------------------------------------------------------------ */

const SHARE_COLUMNS = "id, token, title, show_hand, expires_at, updated_at";

type ShareRow = { id: string; token: string; title: string; show_hand: boolean; expires_at: string; updated_at: string };

function toShare(row: ShareRow): ShareSummary {
  return { id: row.id, token: row.token, title: row.title, showHand: row.show_hand, expiresAt: row.expires_at, updatedAt: row.updated_at };
}

/** The projection is built HERE, from the validated snapshot, and is the only
 *  thing a share stores. The owner snapshot is never used as the payload. */
function projectionFor(state: GameState, showHand: boolean): { projection: unknown; error?: undefined } | { error: string; projection?: undefined } {
  const projection = projectPublic(state, { showHand });
  if (JSON.stringify(projection).length > MAX_PROJECTION_CHARS) return { error: "This table is too large to share." };
  return { projection };
}

export async function createShare(deckId: string, input: { snapshot: unknown; showHand: boolean; title?: string }): Promise<ActionResult<{ share: ShareSummary }>> {
  const auth = await authorize(deckId);
  if (isFailure(auth)) return auth;
  const ready = checked(deckId, input?.snapshot);
  if ("ok" in ready) return ready;
  const built = projectionFor(ready.state, input.showHand === true);
  if (built.error !== undefined) return fail(built.error);
  const title = cleanTitle(input.title) ?? cleanTitle(auth.deckName) ?? "Shared table";

  // Expired shares free their slots: clear this caller's own before counting.
  const cleanup = await auth.supabase
    .from("playtest_shares")
    .delete()
    .eq("owner_user_id", auth.userId)
    .lte("expires_at", new Date().toISOString());
  if (cleanup.error) return fail(playtestErrorMessage(cleanup.error));
  const { data, error } = await auth.supabase
    .from("playtest_shares")
    .insert({
      owner_user_id: auth.userId,
      deck_id: deckId,
      title,
      projection: built.projection,
      projection_version: PROJECTION_VERSION,
      show_hand: input.showHand === true,
    })
    .select(SHARE_COLUMNS)
    .single();
  if (error || !data) return fail(playtestErrorMessage(error ?? {}));
  return { ok: true, share: toShare(data as ShareRow) };
}

/** "Update share": re-projects the CURRENT game on the server. The token stays,
 *  so the link people already hold keeps working. */
export async function refreshShare(
  deckId: string,
  input: { id: string; snapshot: unknown; showHand: boolean; extend?: boolean },
): Promise<ActionResult<{ share: ShareSummary }>> {
  const auth = await authorize(deckId);
  if (isFailure(auth)) return auth;
  if (!UUID.test(String(input?.id))) return fail("That share could not be found.");
  const ready = checked(deckId, input.snapshot);
  if ("ok" in ready) return ready;
  const built = projectionFor(ready.state, input.showHand === true);
  if (built.error !== undefined) return fail(built.error);

  const patch: Record<string, unknown> = {
    projection: built.projection,
    projection_version: PROJECTION_VERSION,
    show_hand: input.showHand === true,
  };
  // 30 more days, bounded by the database to 90 from creation.
  if (input.extend) patch.expires_at = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

  const { data, error } = await auth.supabase
    .from("playtest_shares")
    .update(patch)
    .eq("id", input.id)
    .eq("owner_user_id", auth.userId)
    .eq("deck_id", deckId)
    .select(SHARE_COLUMNS);
  if (error) {
    if (error.code === "23514") return fail("This share cannot be extended any further. Create a new one instead.");
    return fail(playtestErrorMessage(error));
  }
  if (!data || data.length === 0) return fail("That share could not be found.");
  return { ok: true, share: toShare(data[0] as ShareRow) };
}

export async function deleteShare(deckId: string, input: { id: string }): Promise<ActionResult> {
  const auth = await authorize(deckId);
  if (isFailure(auth)) return auth;
  if (!UUID.test(String(input?.id))) return fail("That share could not be found.");

  const { error } = await auth.supabase
    .from("playtest_shares")
    .delete()
    .eq("id", input.id)
    .eq("owner_user_id", auth.userId)
    .eq("deck_id", deckId);
  if (error) return fail(playtestErrorMessage(error));
  return { ok: true };
}
