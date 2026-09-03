/**
 * Normalising the vocabulary every exporter spells differently.
 *
 * Moxfield, ManaBox, Archidekt and Deckbox all encode the same three facts —
 * finish, condition, language — and no two agree on how. Rather than writing a
 * parser per provider, everything funnels through these alias tables: an
 * unknown provider that happens to say "Near Mint" gets handled for free, and
 * adding a provider is usually adding a word here rather than a new code path.
 *
 * Anything unrecognised returns null, which the caller treats as "not stated"
 * and fills from the import's defaults. That is deliberate: silently guessing a
 * condition would put wrong data in someone's collection, and a card filed as
 * the wrong finish is worse than one filed as the default.
 */

import { CONDITIONS, FINISHES, LANGUAGES, type Condition, type Finish } from "@/lib/types";

/**
 * Lowercase, and reduce every run of punctuation to a single space.
 *
 * Blunt on purpose. The same grade reaches us as "near_mint", "Near Mint" and
 * "Good (Lightly Played)" depending on who exported it; flattening punctuation
 * means one alias entry covers every spelling of a value rather than three.
 */
function normalise(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------

const FINISH_ALIASES: Record<string, Finish> = {
  // Explicitly non-foil. Blank is handled by the caller, not here.
  "normal": "nonfoil",
  "nonfoil": "nonfoil",
  "non foil": "nonfoil",
  "regular": "nonfoil",
  "false": "nonfoil",
  "no": "nonfoil",
  "0": "nonfoil",

  "foil": "foil",
  "true": "foil",
  "yes": "foil",
  "1": "foil",
  "traditional foil": "foil",

  "etched": "etched",
  "etched foil": "etched",

  "glossy": "glossy",
};

/**
 * Reads a foil/finish cell.
 *
 * Returns null for an empty cell rather than "nonfoil", so the caller can tell
 * "this export says non-foil" from "this export did not say". Both usually end
 * up non-foil, but only one of them should override an explicit default.
 */
export function parseFinish(value: string | null | undefined): Finish | null {
  if (value == null) return null;
  const key = normalise(value);
  if (key === "") return null;
  const mapped = FINISH_ALIASES[key];
  if (mapped) return mapped;
  // A provider we do not know about, but the value is already our vocabulary.
  return (FINISHES as readonly string[]).includes(key) ? (key as Finish) : null;
}

// ---------------------------------------------------------------------------
// Condition
// ---------------------------------------------------------------------------

const CONDITION_ALIASES: Record<string, Condition> = {
  // Our own codes, as Moxfield and Archidekt emit them.
  "nm": "NM",
  "lp": "LP",
  "mp": "MP",
  "hp": "HP",
  "dmg": "DMG",

  // ManaBox and friends: snake_case words.
  "near mint": "NM",
  "lightly played": "LP",
  "moderately played": "MP",
  "heavily played": "HP",
  "damaged": "DMG",

  // Deckbox's grading vocabulary, which is its own thing entirely.
  "mint": "NM",
  "excellent": "LP",
  "good": "LP",
  "good lightly played": "LP",
  "played": "MP",
  "poor": "DMG",

  // Occasionally seen shorthand.
  "m": "NM",
  "ex": "LP",
  "vg": "MP",
  "gd": "MP",
};

export function parseCondition(value: string | null | undefined): Condition | null {
  if (value == null) return null;
  const key = normalise(value);
  if (key === "") return null;

  const mapped = CONDITION_ALIASES[key];
  if (mapped) return mapped;

  const upper = value.trim().toUpperCase();
  return (CONDITIONS as readonly string[]).includes(upper) ? (upper as Condition) : null;
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

/** Built once from the language table so the two can never drift apart. */
const LANGUAGE_BY_LABEL = new Map<string, string>(
  LANGUAGES.map((l) => [normalise(l.label), l.code]),
);
const LANGUAGE_CODES = new Set<string>(LANGUAGES.map((l) => l.code));

const LANGUAGE_EXTRA_ALIASES: Record<string, string> = {
  // Scryfall's own codes for the two Chinese variants, spelled out.
  "chinese simplified": "zhs",
  "simplified chinese": "zhs",
  "chinese traditional": "zht",
  "traditional chinese": "zht",
  "chinese": "zhs",
  "japanese": "ja",
  "jp": "ja",
  "portuguese brazil": "pt",
  "portuguese (brazil)": "pt",
  "brazilian portuguese": "pt",
};

export function parseLanguage(value: string | null | undefined): string | null {
  if (value == null) return null;
  const key = normalise(value);
  if (key === "") return null;

  if (LANGUAGE_CODES.has(key)) return key;
  const byLabel = LANGUAGE_BY_LABEL.get(key);
  if (byLabel) return byLabel;
  return LANGUAGE_EXTRA_ALIASES[key] ?? null;
}
