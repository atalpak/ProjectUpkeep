/**
 * Catalog search contracts — the framework-free half of Scryfall-compatible
 * search (see docs/guides/SCRYFALL_SEARCH_DEVELOPMENT_GUIDE.md §3–§4, §7).
 *
 * The submitted query is an opaque Scryfall string. Nothing here evaluates it;
 * that is upstream's job. This module only:
 *   - carries a query plus display options as one `SearchSpec` and round-trips
 *     it through URL params without touching the query's interior;
 *   - reads presentation directives (`unique:`, `display:`, `order:` …) with a
 *     lexer that respects quotes and regex literals, keeping source offsets;
 *   - translates the legacy facet/`raw=` URLs once into ordinary query text;
 *   - serializes the visual builder model into a query.
 */

/** Documented upstream limit, counted in code points (not UTF-16 units). */
export const MAX_QUERY_CODEPOINTS = 1000;

export const UNIQUE_MODES = ["cards", "prints", "art"] as const;
export const DISPLAY_MODES = ["grid", "checklist", "full", "text"] as const;
export type UniqueMode = (typeof UNIQUE_MODES)[number];
export type DisplayMode = (typeof DISPLAY_MODES)[number];

/** Standalone API `order` enum; query-level `order:` may be wider, and is forwarded raw. */
export const API_ORDERS = [
  "name", "set", "released", "rarity", "color", "usd", "tix", "eur", "cmc",
  "power", "toughness", "edhrec", "penny", "artist", "review",
] as const;
export const API_DIRS = ["auto", "asc", "desc"] as const;

export type SearchSpec = {
  /** Raw Scryfall syntax, outer whitespace trimmed, interior untouched. */
  q: string;
  page: number;
  unique?: UniqueMode;
  order?: string;
  dir?: (typeof API_DIRS)[number];
  display?: DisplayMode;
  prefer?: string;
  includeExtras?: boolean;
  includeMultilingual?: boolean;
  includeVariations?: boolean;
};

export type SpecValidation =
  | { ok: true; spec: SearchSpec }
  | { ok: false; kind: "empty" | "too_long" | "bad_option"; message: string };

const codePointLength = (s: string): number => Array.from(s).length;

const asBool = (v: string | null): boolean | undefined =>
  v === "true" ? true : v === "false" ? false : undefined;

const oneOf = <T extends string>(list: readonly T[], v: string | null): T | undefined =>
  v !== null && (list as readonly string[]).includes(v) ? (v as T) : undefined;

// ---------------------------------------------------------------------------
// Lexer — top-level tokens with offsets, quote/regex aware
// ---------------------------------------------------------------------------

export type QueryToken = { text: string; start: number; end: number };

/**
 * Splits on whitespace and parentheses that sit outside quotes and regex
 * literals. A `"`/`'` opens a string only at the start of a value; a `/` opens
 * a regex only right after an operator (`:`, `=`, `<`, `>`, `!`). Anything the
 * lexer is unsure of stays inside its token, which is the safe direction.
 * Parentheses are returned as their own tokens.
 */
export function tokenizeQuery(q: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  let i = 0;
  const n = q.length;
  const isSpace = (c: string) => /\s/.test(c);

  while (i < n) {
    if (isSpace(q.charAt(i))) { i++; continue; }
    if (q.charAt(i) === "(" || q.charAt(i) === ")") {
      tokens.push({ text: q.charAt(i), start: i, end: i + 1 });
      i++;
      continue;
    }
    const start = i;
    while (i < n && !isSpace(q.charAt(i)) && q.charAt(i) !== "(" && q.charAt(i) !== ")") {
      const c = q.charAt(i);
      const prev = i > start ? q.charAt(i - 1) : "";
      const atValueStart = i === start || /[:=<>!\-]/.test(prev);
      if ((c === '"' || c === "'") && atValueStart) {
        i++;
        while (i < n && q.charAt(i) !== c) i += q.charAt(i) === "\\" ? 2 : 1;
        i = Math.min(i + 1, n);
      } else if (c === "/" && /[:=<>!]/.test(prev)) {
        i++;
        while (i < n && q.charAt(i) !== "/") i += q.charAt(i) === "\\" ? 2 : 1;
        i = Math.min(i + 1, n);
      } else {
        i++;
      }
    }
    tokens.push({ text: q.slice(start, i), start, end: i });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Presentation directives
// ---------------------------------------------------------------------------

export type DirectiveKey = "unique" | "display" | "order" | "prefer" | "direction";

const DIRECTIVE_RE = /^(unique|display|order|sort|prefer|direction|dir):(\S+)$/i;

function directiveOf(tok: QueryToken): { key: DirectiveKey; value: string } | null {
  if (tok.text === "++") return { key: "unique", value: "prints" };
  if (tok.text === "@@") return { key: "unique", value: "art" };
  const m = DIRECTIVE_RE.exec(tok.text);
  if (!m) return null;
  const raw = (m[1] ?? "").toLowerCase();
  const val = m[2] ?? "";
  const key: DirectiveKey = raw === "sort" ? "order" : raw === "dir" ? "direction" : (raw as DirectiveKey);
  // A value that itself begins a quote/regex means this was a name/text search, not a directive.
  if (/^["'/]/.test(val)) return null;
  return { key, value: val };
}

export type PresentationDirectives = {
  unique?: string;
  display?: string;
  order?: string;
  prefer?: string;
  direction?: string;
  /** Keys that appear more than once — controls must show these as query-controlled. */
  duplicates: DirectiveKey[];
};

export function readPresentation(q: string): PresentationDirectives {
  const out: PresentationDirectives = { duplicates: [] };
  for (const tok of tokenizeQuery(q)) {
    const d = directiveOf(tok);
    if (!d) continue;
    if (out[d.key] !== undefined && !out.duplicates.includes(d.key)) out.duplicates.push(d.key);
    out[d.key] = d.value.toLowerCase();
  }
  return out;
}

/**
 * Sets a directive to `value` (or removes it when `value` is null). Rewrites the
 * existing token in place, appends one when absent. Returns null when the
 * directive occurs more than once — the caller must leave the query alone.
 */
export function setDirective(q: string, key: DirectiveKey, value: string | null): string | null {
  const hits = tokenizeQuery(q).filter((t) => directiveOf(t)?.key === key);
  if (hits.length > 1) return null;
  const replacement = value === null ? "" : `${key}:${value}`;
  if (hits.length === 1) {
    const { start, end } = hits[0]!;
    return (q.slice(0, start) + replacement + q.slice(end)).replace(/[ \t]{2,}/g, " ").trim();
  }
  return value === null ? q : `${q.trim()} ${replacement}`.trim();
}

// ---------------------------------------------------------------------------
// Validation + URL round trip
// ---------------------------------------------------------------------------

const asPage = (v: string | null): number => {
  const n = Number.parseInt(v ?? "1", 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
};

export function validateSpec(spec: SearchSpec): SpecValidation {
  const q = spec.q.trim();
  if (q === "") return { ok: false, kind: "empty", message: "Type a search to begin." };
  if (codePointLength(q) > MAX_QUERY_CODEPOINTS) {
    return {
      ok: false,
      kind: "too_long",
      message: `That search is ${codePointLength(q)} characters; the limit is ${MAX_QUERY_CODEPOINTS}.`,
    };
  }
  return { ok: true, spec: { ...spec, q } };
}

/** Encodes exactly once via URLSearchParams; never hand-concatenates. */
export function specToParams(spec: SearchSpec): URLSearchParams {
  const p = new URLSearchParams();
  p.set("q", spec.q);
  if (spec.page > 1) p.set("page", String(spec.page));
  if (spec.unique) p.set("unique", spec.unique);
  if (spec.order) p.set("order", spec.order);
  if (spec.dir) p.set("dir", spec.dir);
  if (spec.display) p.set("display", spec.display);
  if (spec.prefer) p.set("prefer", spec.prefer);
  if (spec.includeExtras !== undefined) p.set("include_extras", String(spec.includeExtras));
  if (spec.includeMultilingual !== undefined) p.set("include_multilingual", String(spec.includeMultilingual));
  if (spec.includeVariations !== undefined) p.set("include_variations", String(spec.includeVariations));
  return p;
}

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function getter(params: ParamSource): (k: string) => string | null {
  return (k) => {
    if (params instanceof URLSearchParams) return params.get(k);
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v) ?? null;
  };
}

/**
 * Reads a spec from URL params, accepting legacy links: `raw=` becomes `q=`;
 * bare facet params become query clauses. When both `raw` and facets are
 * present, raw wins and facets are ignored (today's rule).
 */
export function specFromParams(params: ParamSource): SearchSpec {
  const get = getter(params);
  const raw = get("raw")?.trim() ?? "";
  const q = raw !== "" ? raw : legacyQuery(get);
  return {
    q,
    page: asPage(get("page")),
    unique: oneOf(UNIQUE_MODES, get("unique")),
    order: get("order")?.trim() || undefined,
    dir: oneOf(API_DIRS, get("dir")),
    display: oneOf(DISPLAY_MODES, get("display")),
    prefer: get("prefer")?.trim() || undefined,
    includeExtras: asBool(get("include_extras")),
    includeMultilingual: asBool(get("include_multilingual")),
    includeVariations: asBool(get("include_variations")),
  };
}

// ---------------------------------------------------------------------------
// Legacy facets → one query
// ---------------------------------------------------------------------------

const OP_SYMBOL: Record<string, string> = { eq: "=", ne: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" };

/** Quotes a value only when it needs it; backslash-escapes embedded quotes. */
export function quoteValue(v: string): string {
  if (/^[^\s"'()\\]+$/.test(v)) return v;
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function legacyQuery(get: (k: string) => string | null): string {
  const parts: string[] = [];
  const name = get("q")?.trim() ?? "";
  if (name) parts.push(name);

  const colors = (get("colors") ?? "").split(",").map((c) => c.trim().toLowerCase())
    .filter((c) => /^[wubrg]$/.test(c));
  if (colors.length) {
    const mode = get("colorMode");
    const op = mode === "exactly" ? "=" : mode === "atMost" ? "<=" : mode === "any" ? ":" : ">=";
    // "any" overlap has no single operator; expand to an OR group.
    parts.push(mode === "any" && colors.length > 1
      ? `(${colors.map((c) => `c:${c}`).join(" or ")})`
      : `c${op}${colors.join("")}`);
  }
  const numeric = (param: string, field: string) => {
    const [op, value] = (get(param) ?? "").split(":");
    if (op !== undefined && op in OP_SYMBOL && value !== undefined && Number.isFinite(Number.parseFloat(value))) {
      parts.push(`${field}${OP_SYMBOL[op] ?? ""}${Number.parseFloat(value)}`);
    }
  };
  numeric("cmc", "mv");
  numeric("loyalty", "loy");

  const text = (param: string, field: string) => {
    const v = get(param)?.trim();
    if (v) parts.push(`${field}:${quoteValue(v)}`);
  };
  text("type", "t");
  text("oracle", "o");
  text("set", "e");
  text("rarity", "r");
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Visual builder → query
// ---------------------------------------------------------------------------

export type BuilderText = { value: string; mode: "phrase" | "words" };
export type BuilderRow = { field: string; op: string; value: string };

export type BuilderModel = {
  name?: BuilderText & { exact?: boolean };
  oracle?: BuilderText & { full?: boolean };
  types?: { include: string[]; exclude: string[]; anyOf?: boolean };
  colors?: { letters: string[]; mode: "exact" | "includes" | "atMost"; colorless?: boolean };
  identity?: { letters: string[]; mode: "exact" | "includes" | "atMost" };
  manaCost?: { value: string; op?: string };
  stats?: BuilderRow[];
  games?: string[];
  formats?: { status: "legal" | "banned" | "restricted"; format: string }[];
  sets?: string[];
  rarities?: string[];
  prices?: BuilderRow[];
  artist?: string;
  flavor?: BuilderText;
  lore?: BuilderText;
  language?: string;
  /** Result preferences are emitted as directives, in a fixed order. */
  unique?: UniqueMode;
  display?: DisplayMode;
  order?: string;
  direction?: "asc" | "desc";
  prefer?: string;
  /** Extra raw clauses appended verbatim (regex, tags, unknown operators). */
  rawTail?: string;
};

const group = (clauses: string[]): string =>
  clauses.length === 0 ? "" : clauses.length === 1 ? (clauses[0] ?? "") : `(${clauses.join(" or ")})`;

function words(field: string, t: BuilderText | undefined, extra = ""): string[] {
  const v = t?.value.trim();
  if (!v) return [];
  if (t!.mode === "phrase") return [`${field}${extra}:${quoteValue(v)}`];
  return v.split(/\s+/).map((w) => `${field}${extra}:${quoteValue(w)}`);
}

const COLOR_OP = { exact: "=", includes: ">=", atMost: "<=" } as const;

/** Deterministic: same model, same string. Never emits an implicit paper/prefer clause. */
export function builderToQuery(m: BuilderModel): string {
  const out: string[] = [];

  if (m.name?.value.trim()) {
    const v = m.name.value.trim();
    if (m.name.exact) out.push(`!${quoteValue(v)}`);
    else if (m.name.mode === "phrase") out.push(`name:${quoteValue(v)}`);
    else out.push(...v.split(/\s+/).map(quoteValue));
  }
  out.push(...words(m.oracle?.full ? "fo" : "o", m.oracle));
  if (m.types) {
    const inc = m.types.include.filter(Boolean).map((t) => `t:${quoteValue(t)}`);
    out.push(...(m.types.anyOf ? [group(inc)] : inc));
    out.push(...m.types.exclude.filter(Boolean).map((t) => `-t:${quoteValue(t)}`));
  }
  if (m.colors) {
    if (m.colors.colorless) out.push("c:c");
    else if (m.colors.letters.length) out.push(`c${COLOR_OP[m.colors.mode]}${m.colors.letters.join("").toLowerCase()}`);
  }
  if (m.identity?.letters.length) out.push(`id${COLOR_OP[m.identity.mode]}${m.identity.letters.join("").toLowerCase()}`);
  if (m.manaCost?.value.trim()) out.push(`m${m.manaCost.op ?? ":"}${m.manaCost.value.trim()}`);
  for (const r of m.stats ?? []) if (r.value.trim()) out.push(`${r.field}${r.op}${r.value.trim()}`);
  if (m.games?.length) out.push(group(m.games.map((g) => `game:${g}`)));
  for (const f of m.formats ?? []) if (f.format) out.push(`${f.status === "legal" ? "f" : f.status}:${f.format}`);
  if (m.sets?.length) out.push(group(m.sets.map((s) => `e:${s}`)));
  if (m.rarities?.length) out.push(group(m.rarities.map((r) => `r:${r}`)));
  for (const r of m.prices ?? []) if (r.value.trim()) out.push(`${r.field}${r.op}${r.value.trim()}`);
  if (m.artist?.trim()) out.push(`a:${quoteValue(m.artist.trim())}`);
  out.push(...words("ft", m.flavor));
  out.push(...words("lore", m.lore));
  if (m.language) out.push(`lang:${m.language}`);
  if (m.rawTail?.trim()) out.push(m.rawTail.trim());

  if (m.unique) out.push(`unique:${m.unique}`);
  if (m.display) out.push(`display:${m.display}`);
  if (m.order) out.push(`order:${m.order}`);
  if (m.direction) out.push(`direction:${m.direction}`);
  if (m.prefer) out.push(`prefer:${m.prefer}`);
  return out.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Result contracts
// ---------------------------------------------------------------------------

export type CatalogFace = {
  name: string;
  imageNormal: string | null;
  imageLarge: string | null;
  imageSmall: string | null;
  manaCost?: string;
  typeLine?: string;
  oracleText?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  artist?: string;
  flavorText?: string;
};

export type CatalogCard = {
  /** Printing id — the React key and the local `cards.scryfall_id`. */
  id: string;
  oracleId: string | null;
  name: string;
  printedName?: string;
  flavorName?: string;
  lang: string;
  games: string[];
  set: string;
  setName: string;
  collectorNumber: string;
  releasedAt: string;
  layout: string;
  manaCost?: string;
  typeLine?: string;
  oracleText?: string;
  rarity: string;
  prices: { usd: string | null; usd_foil: string | null; eur: string | null; tix: string | null };
  /** Card-level image (null for multi-face layouts whose images sit on faces). */
  imageNormal: string | null;
  imageLarge: string | null;
  imageSmall: string | null;
  faces: CatalogFace[];
  scryfallUri: string;
  digital: boolean;
};

export type SearchErrorKind =
  | "validation" | "syntax" | "rate_limited" | "unavailable" | "bad_payload" | "unauthorized" | "not_found";

export type SearchFailure = {
  status: "error";
  kind: SearchErrorKind;
  message: string;
  warnings: string[];
  submittedQuery: string;
  retryAfterSeconds?: number;
  upstream?: { status: number; code?: string; type?: string };
};

export type SearchSuccess = {
  status: "ok";
  submittedQuery: string;
  effectiveQuery: string;
  source: "scryfall";
  page: number;
  totalCards: number | null;
  hasMore: boolean;
  nextPage: number | null;
  warnings: string[];
  fallbackApplied: string | null;
  fetchedAt: string;
  stale: boolean;
  presentation: { display: DisplayMode };
  cards: CatalogCard[];
};

export type SearchResponse = SearchSuccess | SearchFailure;

/** Display precedence: inline `display:` beats the control, which beats the default. */
export function resolveDisplay(spec: SearchSpec): DisplayMode {
  const inline = readPresentation(spec.q).display;
  return oneOf(DISPLAY_MODES, inline ?? null) ?? spec.display ?? "grid";
}

/**
 * The website opens a set gallery (every printing, in set order) for a query
 * that is nothing but one positive set clause. Detected narrowly: anything
 * else — negation, a second clause, OR, quotes, regex — is an ordinary search.
 * Returns the set code, or null.
 */
export function setOnlyCode(q: string): string | null {
  const m = /^(?:e|s|set|edition):([a-z0-9_]{2,8})$/i.exec(q.trim());
  return m ? (m[1] ?? null)?.toLowerCase() ?? null : null;
}
