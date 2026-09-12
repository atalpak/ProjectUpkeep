import { createClient } from "@/lib/supabase/server";
import { searchCards, type CardSearchResult } from "@/lib/cards/search";
import {
  advancedFilterFromParams,
  isAdvancedFilterActive,
  parseScryfallQuery,
  type AdvancedCardFilter,
} from "@/lib/cards/search-query";
import { AdvancedSearchForm } from "@/components/cards/AdvancedSearchForm";
import { SearchResultsGrid } from "@/components/cards/SearchResultsGrid";
import { EmptyState, PageHeader } from "@/components/ui";

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
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = one(params.raw).trim();

  let filter: AdvancedCardFilter = advancedFilterFromParams(params);
  let unsupported: string[] = [];

  if (raw !== "") {
    // The raw box speaks for the whole query when it is used, same rule the
    // API route and the header dropdown apply.
    const parsed = parseScryfallQuery(raw);
    filter = parsed.filter;
    unsupported = parsed.unsupported;
  }

  const active = isAdvancedFilterActive(filter);

  let results: CardSearchResult[] = [];
  if (active) {
    const supabase = await createClient();
    const { data } = await searchCards(supabase, filter, 90);
    results = data;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Advanced Search"
        subtitle="Every card Scryfall knows — not just what's in your collection."
      />

      <AdvancedSearchForm initial={filter} initialRaw={raw} />

      {unsupported.length > 0 ? (
        <p className="text-xs text-ink-muted">
          Not understood, so ignored: {unsupported.join(" ")}
        </p>
      ) : null}

      {!active ? (
        <p className="text-sm text-ink-muted">
          Set at least one filter above, then press Search.
        </p>
      ) : results.length === 0 ? (
        <EmptyState title="Nothing matches those filters." />
      ) : (
        <SearchResultsGrid results={results} />
      )}
    </div>
  );
}
