/**
 * The card_instance vocabulary that both clients need to agree on.
 *
 * Condition and finish are genuinely one vocabulary: the exact same CHECK
 * constraints on `public.card_instances` (see
 * supabase/migrations/00000000000005_card_instances.sql), the exact same
 * arrays, in both `src/lib/types.ts` and `packages/scan-core/src/types.ts`
 * before this package existed. This is their one real home now; both of those
 * files re-export from here rather than keeping their own copy.
 *
 * Language is NOT folded in the same way. The web app's `LANGUAGES` in
 * `src/lib/types.ts` is `{ code, label }` pairs for a `<select>` — display
 * data the domain layer has no business owning. Mobile's `LANGUAGES` in
 * `packages/scan-core/src/types.ts` is a bare code list used only to validate
 * a scanned draft. `LANGUAGE_CODES` below is that bare list, shared because
 * it really is the same fact (which codes `card_instances.language` accepts,
 * loosely — the column itself has no CHECK, just a length bound); the web
 * app's labelled version stays local to it.
 */

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const FINISHES = ["nonfoil", "foil", "etched", "glossy"] as const;
export type Finish = (typeof FINISHES)[number];

export const LANGUAGE_CODES = [
  "en", "es", "fr", "de", "it", "pt", "ja", "ko", "ru",
  "zhs", "zht", "he", "la", "grc", "ar", "sa", "ph",
] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

/**
 * Display names for the codes above. Lives beside them (rather than only in
 * the web app's `LANGUAGES` select list) because the import vocabulary parser
 * matches a spreadsheet's "Japanese" back to `ja`. Typed as a full Record so a
 * code added to `LANGUAGE_CODES` without a label is a compile error.
 */
export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  ko: "Korean",
  ru: "Russian",
  zhs: "Chinese (Simplified)",
  zht: "Chinese (Traditional)",
  he: "Hebrew",
  la: "Latin",
  grc: "Ancient Greek",
  ar: "Arabic",
  sa: "Sanskrit",
  ph: "Phyrexian",
};
