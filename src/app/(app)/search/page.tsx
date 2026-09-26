import { setOnlyCode, specFromParams, specToParams } from "@upkeep/domain";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { catalogSearchEnabled, searchCatalog, suggestSpelling } from "@/lib/cards/scryfall-search";
import { localPrintingIds, ownershipFor } from "@/lib/cards/search-enrichment";
import { getFriendAvailabilityForResults, type FriendNote } from "@/lib/social/queries";
import { CatalogResults } from "@/components/cards/CatalogResults";
import { CatalogSearchForm } from "@/components/cards/CatalogSearchForm";
import Link from "next/link";
import { searchCards, type CardSearchResult } from "@/lib/cards/search";
import {
  advancedFilterFromParams,
  isAdvancedFilterActive,
  parseScryfallQuery,
  type AdvancedCardFilter,
} from "@/lib/cards/search-query";
import { AdvancedSearchForm } from "@/components/cards/AdvancedSearchForm";
import { SearchResultsGrid } from "@/components/cards/SearchResultsGrid";
import { Banner, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Advanced Search · Project Upkeep" };

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * A Scryfall-style card database search — colour, mana value, type, rules
 * text, set, rarity, or literal syntax — across every printing, not just
 * what anyone owns. Reads `cards` unscoped, deliberately: this is public
 * Scryfall data, not a collection, so no owner filter applies (see
 * `.claude/rules/data-access.md`).
 *
 * `/find` answers "where is this among my collection and my friends'?";
 * this page answers "what does Magic have that matches this?" — the two
 * read as siblings rather than duplicates because they start from opposite
 * ends: one from a card you already have in mind, the other from a shape
 * (a colour, a mana value, a line of rules text) you are still narrowing.
 *
 * Filters and the raw query live in the URL, the same choice `/collection`
 * makes: a search here is a link, not just a page state. Nothing runs until
 * the form's own Search button is pressed — no live-as-you-type — because
 * this reaches over the entire card database rather than one collection.
 */
async function LegacySearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = one(params.raw).trim();
  const q = one(params.q).trim();

  let filter: AdvancedCardFilter = advancedFilterFromParams(params);
  let unsupported: string[] = [];

  if (raw !== "") {
    // The raw box speaks for the whole query when it is used, same rule the
    // API route and the header dropdown apply.
    const parsed = parseScryfallQuery(raw);
    filter = parsed.filter;
    unsupported = parsed.unsupported;
  }

  // What the primary box displays: a `raw` param already belongs there; a
  // bare `q` (a plain name, arriving from the header search's dropdown or its
  // Enter fallback) is shown there too, rather than only landing invisibly in
  // the collapsed Filters panel's own Card name field — the whole point of
  // "run this in Advanced Search" is seeing what was actually searched.
  const displayRaw = raw || q;

  const active = isAdvancedFilterActive(filter);

  let results: CardSearchResult[] = [];
  let searchError: string | null = null;
  if (active) {
    const supabase = await createClient();
    const { data, error } = await searchCards(supabase, filter, 90, { withFaces: true });
    results = data;
    searchError = error;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="Advanced Search"
        subtitle="Every card Scryfall knows — not just what's in your collection."
      />

      {/* Keyed on the URL's own query string: a client-side navigation to a
          route this identical (most of all `/search` with no params at all,
          the "start over" link every entry point into this page uses) leaves
          the component instance in place, so its own `raw`/`filter` state —
          only ever read from `initial`/`initialRaw` at mount — would keep
          showing the previous search. Changing `key` forces React to treat
          it as a fresh mount instead of a re-render, which is what actually
          resets it. */}
      <AdvancedSearchForm key={JSON.stringify(params)} initial={filter} initialRaw={displayRaw} />

      {unsupported.length > 0 ? (
        <p className="text-xs text-ink-muted">
          Not understood, so ignored: {unsupported.join(" ")}
        </p>
      ) : null}

      <Banner kind="error">
        {searchError ? `The search couldn't complete: ${searchError}` : null}
      </Banner>

      {!active ? (
        <p className="text-sm text-ink-muted">
          Set at least one filter above, then press Search.
        </p>
      ) : searchError ? null : results.length === 0 ? (
        <EmptyState title="Nothing matches those filters." icon={false} />
      ) : (
        <SearchResultsGrid results={results} />
      )}
    </div>
  );
}

/**
 * Catalog search: `/search?q=<Scryfall query>` executes on Scryfall exactly as
 * typed (see `src/lib/cards/scryfall-search.ts`), then decorates the returned
 * page with the signed-in user's ownership. No query, no request. Legacy
 * `raw=` and facet links are read by `specFromParams` and normalise to `q=`.
 * With `SCRYFALL_SEARCH_ENABLED=false` the older local search below runs
 * instead — a deliberate rollback switch, never an automatic fallback.
 */
export default async function SearchPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!catalogSearchEnabled()) return LegacySearchPage(props);

  const params = await props.searchParams;
  const spec = specFromParams(params);
  const supabase = await createClient();

  // Website behaviour, shown rather than hidden: a lone positive set clause
  // browses the whole set (every printing, set order) unless the person chose otherwise.
  const setGallery = setOnlyCode(spec.q) !== null && spec.unique === undefined && spec.order === undefined;
  const effective = setGallery ? { ...spec, unique: "prints" as const, order: "set" } : spec;

  const response = spec.q === "" ? null : await searchCatalog(supabase, effective);

  const didYouMean =
    response?.status === "ok" && response.cards.length === 0 ? await suggestSpelling(supabase, spec.q) : null;

  let ownership = null;
  let friends: Record<string, FriendNote[]> | null = null;
  let localIds: string[] | null = null;
  if (response?.status === "ok") {
    const user = await getCurrentUser();
    ownership = user
      ? await ownershipFor(supabase, user.id, response.cards.map((c) => ({ id: c.id, oracleId: c.oracleId })))
      : null;
    localIds = await localPrintingIds(supabase, response.cards.map((c) => c.id));
    friends = await getFriendAvailabilityForResults(
      response.cards.map((c) => ({ id: c.id, oracleId: c.oracleId, name: c.name })),
    ).catch(() => null);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="Advanced Search"
        subtitle="Paste any Scryfall search — every card Scryfall knows, not just what's in your collection."
      />
      <CatalogSearchForm key={JSON.stringify(params)} spec={spec} />

      {response === null ? (
        <p className="text-sm text-ink-muted">Type a search above, then press Search.</p>
      ) : response.status === "error" ? (
        <div className="space-y-2">
          <Banner kind="error">{response.message}</Banner>
          {response.warnings.length ? <p className="text-sm text-ink-muted">{response.warnings.join(" ")}</p> : null}
          {response.retryAfterSeconds ? (
            <p className="text-sm text-ink-muted">
              Try again in about {response.retryAfterSeconds}s.{" "}
              <Link className="underline" href={`/search?${specToParams(spec)}`}>Retry</Link>
            </p>
          ) : null}
        </div>
      ) : (
        <>
        {didYouMean ? (
          <p className="text-sm">
            Did you mean{" "}
            <Link className="text-accent-text underline" href={`/search?${specToParams({ ...spec, q: didYouMean, page: 1 })}`}>{didYouMean}</Link>?
          </p>
        ) : null}
        {setGallery ? (
          <p className="text-sm text-ink-muted">
            Showing every printing in set order, like Scryfall&rsquo;s set page (unique:prints order:set applied).
          </p>
        ) : null}
        <CatalogResults
          response={response}
          spec={spec}
          ownership={ownership}
          friends={friends}
          localIds={localIds}
          ownershipUnavailable={ownership === null}
        />
        </>
      )}
    </div>
  );
}
