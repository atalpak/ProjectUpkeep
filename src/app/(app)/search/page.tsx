import { setOnlyCode, specFromParams, specToParams } from "@upkeep/domain";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { searchCatalog, suggestSpelling } from "@/lib/cards/scryfall-search";
import { localPrintingIds, ownershipFor } from "@/lib/cards/search-enrichment";
import { getFriendAvailabilityForResults, type FriendNote } from "@/lib/social/queries";
import { CatalogResults } from "@/components/cards/CatalogResults";
import { CatalogSearchForm } from "@/components/cards/CatalogSearchForm";
import Link from "next/link";
import { Banner, PageHeader } from "@/components/ui";

export const metadata = { title: "Advanced Search · Project Upkeep" };

/**
 * Catalog search: `/search?q=<Scryfall query>` executes on Scryfall exactly as
 * typed (see `src/lib/cards/scryfall-search.ts`), then decorates the returned
 * page with the signed-in user's ownership. No query, no request. Legacy
 * `raw=` and facet links are read by `specFromParams` and normalise to `q=`.
 */
export default async function SearchPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
