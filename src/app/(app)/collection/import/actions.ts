"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/supabase/server";
import { CONDITIONS, FINISHES, type Condition, type Finish } from "@/lib/types";
import { parseImport } from "@/lib/import/parse";
import { resolveRows } from "@/lib/import/resolve";
import { planImport, type ImportDefaults, type ImportPlan } from "@/lib/import/plan";
import { commitImport } from "@/lib/import/commit";
import {
  MAX_INPUT_BYTES,
  PREVIEW_ROW_LIMIT,
  type ImportPreview,
  type ImportState,
} from "@/app/(app)/collection/import/action-state";

function fail(message: string): ImportState {
  return { error: message, notice: null, preview: null };
}

/**
 * Reads the form into the settings an import runs under.
 *
 * Both actions do this identically, and the commit re-derives everything from
 * the same raw text rather than trusting a resolved plan sent back by the
 * browser — a client that could nominate card ids to insert could file cards
 * that were never in the file.
 */
function readForm(formData: FormData):
  | { ok: true; source: string; defaults: ImportDefaults }
  | { ok: false; error: string } {
  const source = String(formData.get("source") ?? "");

  if (source.trim() === "") {
    return { ok: false, error: "Paste a list or choose a file first." };
  }
  if (Buffer.byteLength(source, "utf8") > MAX_INPUT_BYTES) {
    return {
      ok: false,
      error: `That input is larger than ${Math.round(MAX_INPUT_BYTES / 1_000_000)}MB. Split it into a few smaller files.`,
    };
  }

  const condition = String(formData.get("default_condition") ?? "NM") as Condition;
  const finish = String(formData.get("default_finish") ?? "nonfoil") as Finish;
  const language = String(formData.get("default_language") ?? "en").trim();
  const rawLocation = String(formData.get("location_id") ?? "").trim();

  if (!CONDITIONS.includes(condition)) return { ok: false, error: "Unknown condition." };
  if (!FINISHES.includes(finish)) return { ok: false, error: "Unknown finish." };

  return {
    ok: true,
    source,
    defaults: {
      condition,
      finish,
      language,
      // An empty select value means unsorted, which is a real destination.
      locationId: rawLocation === "" ? null : rawLocation,
    },
  };
}

/** Parse, resolve and plan — the whole read-only half of an import. */
async function buildPlan(
  source: string,
  defaults: ImportDefaults,
): Promise<{ plan: ImportPlan; parsed: ReturnType<typeof parseImport> }> {
  const parsed = parseImport(source);
  const resolved = await resolveRows(parsed.rows);
  return { plan: planImport(resolved, defaults), parsed };
}

function toPreview(
  plan: ImportPlan,
  parsed: ReturnType<typeof parseImport>,
): ImportPreview {
  const shown = plan.rows.filter((r) => r.card).slice(0, PREVIEW_ROW_LIMIT);

  return {
    format: parsed.format,
    mappedColumns: parsed.mappedColumns,
    totalCards: plan.totalCards,
    matchedRows: plan.matchedRows,
    stackCount: plan.stacks.length,
    rowsTruncated: plan.matchedRows > shown.length,
    rows: shown.map((r) => ({
      line: r.line,
      quantity: r.quantity,
      name: r.name,
      matched: r.card
        ? `${r.card.name} · ${r.card.set_code.toUpperCase()} #${r.card.collector_number}`
        : null,
      imageUri: r.card?.image_uri_small ?? null,
      cardId: r.card?.scryfall_id ?? null,
      condition: r.condition,
      finish: r.finish,
      language: r.language,
      warnings: r.warnings,
    })),
    skipped: plan.skippedRows.map((r) => ({
      line: r.line,
      raw: r.raw,
      reason: r.reason ?? "Could not be matched.",
    })),
    problems: parsed.problems,
    warningCount: plan.rows.filter((r) => r.card && r.warnings.length > 0).length,
  };
}

// ---------------------------------------------------------------------------
// Preview — a dry run that writes nothing
// ---------------------------------------------------------------------------

export async function previewImport(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  if (!(await getCurrentUser())) return fail("You need to be signed in.");

  const form = readForm(formData);
  if (!form.ok) return fail(form.error);

  const { plan, parsed } = await buildPlan(form.source, form.defaults);

  if (parsed.format === "empty" || (plan.rows.length === 0 && parsed.problems.length === 0)) {
    return fail("Nothing to import — no card lines were found.");
  }

  const preview = toPreview(plan, parsed);

  return {
    error: null,
    notice:
      preview.matchedRows === 0
        ? "Nothing here could be matched to a card. Check the format below."
        : null,
    preview,
  };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export async function runImport(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const user = await getCurrentUser();
  if (!user) return fail("You need to be signed in.");

  const form = readForm(formData);
  if (!form.ok) return fail(form.error);

  // Re-parsed and re-resolved from the original text rather than reusing the
  // preview: the browser is not a trustworthy source of card ids.
  const { plan, parsed } = await buildPlan(form.source, form.defaults);

  if (plan.stacks.length === 0) {
    return {
      ...fail("Nothing here could be matched to a card, so nothing was imported."),
      preview: toPreview(plan, parsed),
    };
  }

  const result = await commitImport(plan.stacks, user.id);

  revalidatePath("/collection");
  revalidatePath("/locations");
  revalidatePath("/dashboard");

  const preview = toPreview(plan, parsed);

  if (result.error) {
    return {
      error: `${result.error} ${result.cards} card${result.cards === 1 ? "" : "s"} were written before it stopped.`,
      notice: null,
      preview,
    };
  }

  const parts = [
    `Imported ${result.cards} card${result.cards === 1 ? "" : "s"}`,
    result.inserted > 0 ? `${result.inserted} new entr${result.inserted === 1 ? "y" : "ies"}` : null,
    result.merged > 0 ? `${result.merged} merged into existing stacks` : null,
    preview.skipped.length > 0 ? `${preview.skipped.length} line(s) skipped` : null,
  ].filter(Boolean);

  return {
    error: null,
    notice: `${parts.join(" · ")}.`,
    // Kept so the skipped lines stay on screen to be copied and fixed.
    preview,
    nonce: crypto.randomUUID(),
  };
}
