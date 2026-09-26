import {
  resolveDisplay,
  setDirective,
  validateSpec,
  type CatalogCard,
  type CatalogFace,
  type SearchFailure,
  type SearchResponse,
  type SearchSpec,
  type SearchSuccess,
} from "@upkeep/domain";

/**
 * Submitted catalog search, executed by Scryfall (guide §3–§4, §9).
 *
 * The query is sent upstream exactly as typed; nothing here evaluates it, so
 * every operator Scryfall knows — including ones invented after this file —
 * works, and a malformed query fails with Scryfall's own explanation rather
 * than being partly understood. Reads only public catalog data; user-scoped
 * annotations are added afterwards by `search-enrichment.ts`.
 *
 * Traffic: Scryfall allows two search requests a second and locks out for 30s
 * after a 429. Instances share that budget through `claim_scryfall_slot`
 * (migration 48). Identical in-flight requests are coalesced and answers are
 * kept in a per-instance cache — per-instance because a shared cache written
 * by signed-in users could be poisoned, so the shared database only ever holds
 * the traffic gate. A stale entry is served, marked stale, if upstream fails.
 *
 * Config (all optional): `SCRYFALL_SEARCH_CONTACT` — appended to the required
 * User-Agent; `SCRYFALL_SEARCH_ENABLED=false` — turns the feature off.
 */

/** What the search needs from its environment — injected so the logic is testable without a network or a database. */
export type SearchDeps = {
  claimSlot: (gapMs: number, maxWaitMs: number) => Promise<
    { ok: true; granted: boolean; waitMs: number; cooldownMs: number } | { ok: false }
  >;
  openCooldown: (seconds: number) => Promise<void>;
  fetchJson?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const API = "https://api.scryfall.com/cards/search";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NO_MATCH_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_QUEUE_WAIT_MS = 4000;
const SLOT_GAP_MS = 600; // spaced above Scryfall's 500ms floor
const CACHE_MAX_ENTRIES = 200;
/** Bump to invalidate every cached answer when search policy changes. */
const POLICY_VERSION = 1;

export function catalogSearchEnabled(): boolean {
  return process.env.SCRYFALL_SEARCH_ENABLED !== "false";
}

const userAgent = () =>
  `ProjectUpkeep/0.1 (${process.env.SCRYFALL_SEARCH_CONTACT?.trim() || "https://github.com/projectupkeep"})`;

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

/** The effective query: `prefer` is a query directive, not an API parameter. */
export function effectiveQueryOf(spec: SearchSpec): string {
  if (!spec.prefer) return spec.q;
  return setDirective(spec.q, "prefer", spec.prefer) ?? spec.q;
}

export function upstreamParams(spec: SearchSpec, effectiveQuery: string): URLSearchParams {
  const p = new URLSearchParams();
  p.set("q", effectiveQuery);
  if (spec.page > 1) p.set("page", String(spec.page));
  if (spec.unique) p.set("unique", spec.unique);
  if (spec.order) p.set("order", spec.order);
  if (spec.dir) p.set("dir", spec.dir);
  if (spec.includeExtras !== undefined) p.set("include_extras", String(spec.includeExtras));
  if (spec.includeMultilingual !== undefined) p.set("include_multilingual", String(spec.includeMultilingual));
  if (spec.includeVariations !== undefined) p.set("include_variations", String(spec.includeVariations));
  return p;
}

// ---------------------------------------------------------------------------
// Payload adapter — validated, not trusted
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function faceOf(raw: Json): CatalogFace | null {
  const name = str(raw.name);
  if (!name) return null;
  const img = isObj(raw.image_uris) ? raw.image_uris : {};
  return {
    name,
    imageNormal: strOrNull(img.normal),
    imageLarge: strOrNull(img.large),
    imageSmall: strOrNull(img.small),
    manaCost: str(raw.mana_cost),
    typeLine: str(raw.type_line),
    oracleText: str(raw.oracle_text),
    power: str(raw.power),
    toughness: str(raw.toughness),
    loyalty: str(raw.loyalty),
    artist: str(raw.artist),
    flavorText: str(raw.flavor_text),
  };
}

export function adaptCard(raw: unknown): CatalogCard | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const name = str(raw.name);
  if (!id || !name) return null;
  const img = isObj(raw.image_uris) ? raw.image_uris : {};
  const prices = isObj(raw.prices) ? raw.prices : {};
  const faces = Array.isArray(raw.card_faces)
    ? raw.card_faces.map((f) => (isObj(f) ? faceOf(f) : null)).filter((f): f is CatalogFace => f !== null)
    : [];
  // Multi-face layouts keep images on the faces; hoist the front for tiles.
  const front = faces[0];
  return {
    id,
    oracleId: strOrNull(raw.oracle_id),
    name,
    printedName: str(raw.printed_name),
    flavorName: str(raw.flavor_name),
    lang: str(raw.lang) ?? "en",
    games: strList(raw.games),
    set: str(raw.set) ?? "",
    setName: str(raw.set_name) ?? "",
    collectorNumber: str(raw.collector_number) ?? "",
    releasedAt: str(raw.released_at) ?? "",
    layout: str(raw.layout) ?? "normal",
    manaCost: str(raw.mana_cost),
    typeLine: str(raw.type_line),
    oracleText: str(raw.oracle_text),
    rarity: str(raw.rarity) ?? "",
    prices: {
      usd: strOrNull(prices.usd),
      usd_foil: strOrNull(prices.usd_foil),
      eur: strOrNull(prices.eur),
      tix: strOrNull(prices.tix),
    },
    imageNormal: strOrNull(img.normal) ?? front?.imageNormal ?? null,
    imageLarge: strOrNull(img.large) ?? front?.imageLarge ?? null,
    imageSmall: strOrNull(img.small) ?? front?.imageSmall ?? null,
    faces,
    scryfallUri: str(raw.scryfall_uri) ?? "",
    digital: raw.digital === true,
  };
}

// ---------------------------------------------------------------------------
// Cache and coalescing (per instance; public data only)
// ---------------------------------------------------------------------------

type CacheEntry = { at: number; ttl: number; value: SearchSuccess };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<SearchResponse>>();

/** Exact query + every query-affecting option + page + policy version + UTC day (relative dates). */
function cacheKey(effectiveQuery: string, params: URLSearchParams): string {
  return JSON.stringify([POLICY_VERSION, new Date().toISOString().slice(0, 10), effectiveQuery, params.toString()]);
}

function remember(key: string, value: SearchSuccess, ttl: number) {
  cache.delete(key);
  cache.set(key, { at: Date.now(), ttl, value });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Test seam. */
export function clearCatalogSearchCache() {
  cache.clear();
  inflight.clear();
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

const fail = (
  spec: SearchSpec,
  kind: SearchFailure["kind"],
  message: string,
  extra: Partial<SearchFailure> = {},
): SearchFailure => ({ status: "error", kind, message, warnings: [], submittedQuery: spec.q, ...extra });

export async function searchCatalog(deps: SearchDeps, input: SearchSpec): Promise<SearchResponse> {
  const checked = validateSpec(input);
  if (!checked.ok) return fail(input, "validation", checked.message);
  const spec = checked.spec;

  const effectiveQuery = effectiveQueryOf(spec);
  const params = upstreamParams(spec, effectiveQuery);
  const key = cacheKey(effectiveQuery, params);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return withPresentation(hit.value, spec);

  let pending = inflight.get(key);
  if (!pending) {
    pending = execute(deps, spec, effectiveQuery, params, key).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const result = await pending;
  return result.status === "ok" ? withPresentation(result, spec) : result;
}

/** Display is a renderer choice: cached cards stay valid when only it changes. */
function withPresentation(value: SearchSuccess, spec: SearchSpec): SearchSuccess {
  return { ...value, submittedQuery: spec.q, presentation: { display: resolveDisplay(spec) } };
}

async function execute(
  deps: SearchDeps,
  spec: SearchSpec,
  effectiveQuery: string,
  params: URLSearchParams,
  key: string,
): Promise<SearchResponse> {
  const staleOr = (failure: SearchFailure): SearchResponse => {
    const old = cache.get(key);
    return old ? { ...old.value, stale: true, warnings: [...old.value.warnings] } : failure;
  };

  // 1. Shared traffic gate.
  const gate = await deps.claimSlot(SLOT_GAP_MS, MAX_QUEUE_WAIT_MS);
  if (!gate.ok) {
    // The gate lives in the database; if it is unreachable, do not call out unmetered.
    return staleOr(fail(spec, "unavailable", "Search is temporarily unavailable. Try again shortly."));
  }
  if (!gate.granted) {
    const seconds = Math.max(1, Math.ceil((gate.cooldownMs || gate.waitMs || 1000) / 1000));
    return staleOr(
      fail(spec, "rate_limited", "Search is busy right now. Try again in a moment.", { retryAfterSeconds: seconds }),
    );
  }
  if (gate.waitMs > 0) await (deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(gate.waitMs);

  // 2. The call.
  let res: Response;
  try {
    res = await (deps.fetchJson ?? fetch)(`${API}?${params.toString()}`, {
      headers: { "User-Agent": userAgent(), Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return staleOr(fail(spec, "unavailable", "Couldn't reach Scryfall. Try again."));
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return staleOr(fail(spec, "bad_payload", "Scryfall sent something unreadable. Try again."));
  }
  const obj = isObj(body) ? body : {};
  const warnings = strList(obj.warnings);

  if (res.status === 429) {
    const retryHeader = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
    const seconds = Math.max(30, Number.isFinite(retryHeader) ? retryHeader : 0);
    await deps.openCooldown(seconds).catch(() => undefined);
    return staleOr(
      fail(spec, "rate_limited", "Scryfall asked us to slow down.", {
        retryAfterSeconds: seconds,
        upstream: { status: 429 },
      }),
    );
  }

  if (res.status === 404 && str(obj.object) === "error") {
    // A search that matches nothing is a normal answer, not a failure.
    const empty = toSuccess(spec, effectiveQuery, { ...obj, data: [], total_cards: 0, has_more: false, warnings }, []);
    remember(key, empty, NO_MATCH_TTL_MS);
    return empty;
  }

  if (res.status >= 400 && res.status < 500) {
    return fail(spec, "syntax", str(obj.details) ?? "Scryfall couldn't understand that search.", {
      warnings,
      upstream: { status: res.status, code: str(obj.code), type: str(obj.type) },
    });
  }
  if (!res.ok) {
    return staleOr(fail(spec, "unavailable", "Scryfall is having trouble. Try again.", { upstream: { status: res.status } }));
  }

  if (str(obj.object) !== "list" || !Array.isArray(obj.data)) {
    return staleOr(fail(spec, "bad_payload", "Scryfall sent something unexpected. Try again."));
  }
  const cards = obj.data.map(adaptCard).filter((c): c is CatalogCard => c !== null);
  const success = toSuccess(spec, effectiveQuery, obj, cards);
  remember(key, success, cards.length === 0 ? NO_MATCH_TTL_MS : CACHE_TTL_MS);
  return success;
}

function toSuccess(spec: SearchSpec, effectiveQuery: string, list: Json, cards: CatalogCard[]): SearchSuccess {
  const hasMore = list.has_more === true;
  return {
    status: "ok",
    submittedQuery: spec.q,
    effectiveQuery,
    source: "scryfall",
    page: spec.page,
    totalCards: typeof list.total_cards === "number" ? list.total_cards : null,
    hasMore,
    nextPage: hasMore ? spec.page + 1 : null,
    warnings: strList(list.warnings),
    fallbackApplied: null,
    fetchedAt: new Date().toISOString(),
    stale: false,
    presentation: { display: resolveDisplay(spec) },
    cards,
  };
}

/** Plain words only — anything with syntax characters is never "a misspelt name". */
export const isPlainNameQuery = (q: string): boolean => /^[^:<>=()"!/\\]{3,}$/.test(q.trim()) && !/(^|\s)-\S/.test(q);

/**
 * Spelling help for a zero-result plain-name search: Scryfall's fuzzy name
 * lookup, through the same shared gate. Returns a card name or null. The
 * search API itself does not do this; the website does. The original query is
 * never replaced — the caller only offers the suggestion as a link.
 */
export async function suggestSpelling(deps: SearchDeps, q: string): Promise<string | null> {
  if (!isPlainNameQuery(q)) return null;
  const gate = await deps.claimSlot(SLOT_GAP_MS, MAX_QUEUE_WAIT_MS);
  if (!gate.ok || !gate.granted) return null;
  if (gate.waitMs > 0) await (deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(gate.waitMs);
  try {
    const res = await (deps.fetchJson ?? fetch)(
      `https://api.scryfall.com/cards/named?${new URLSearchParams({ fuzzy: q.trim() })}`,
      { headers: { "User-Agent": userAgent(), Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" },
    );
    if (res.status === 429) {
      await deps.openCooldown(30).catch(() => undefined);
      return null;
    }
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const name = isObj(body) ? str(body.name) : undefined;
    // Only a real difference is a suggestion.
    return name && name.toLowerCase() !== q.trim().toLowerCase() ? name : null;
  } catch {
    return null;
  }
}
