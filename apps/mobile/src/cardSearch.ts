import { specFromParams, specToParams, type AdvancedCardFilter, type CatalogCard, type SearchResponse } from '@upkeep/domain';
import { backend } from './backend';
import { WEB_URL } from './auth';

export type CardSearchResult = {
  name: string;
  imageSmall: string | null;
  image: string | null;
  sampleCardId: string;
  layout: string | null;
  local: boolean;
  scryfallUri: string;
  setLabel: string;
};
export type CardSearchPage = {
  results: CardSearchResult[];
  total: number | null;
  nextPage: number | null;
  warnings: string[];
  error: string | null;
};

/** Facets use the web's shared translator; raw syntax is never parsed locally. */
export function mobileSearchQuery(query: string, facets: Omit<AdvancedCardFilter, 'name'>): string {
  const params = new URLSearchParams({ q: query });
  const letters = facets.colors.filter(c => c !== 'C').map(c => c.toLowerCase());
  const colorless = facets.colors.includes('C');
  params.set('colorMode', facets.colorMode);
  for (const key of ['type', 'oracle', 'set', 'rarity'] as const) params.set(key, facets[key]);
  if (facets.cmc) params.set('cmc', `${facets.cmc.op}:${facets.cmc.value}`);
  const spec = specFromParams(params);
  let colors = '';
  if (facets.colors.length) {
    if (!letters.length) colors = 'c:c';
    else if (facets.colorMode === 'any') colors = `(${[...letters.map(c => `c:${c}`), ...(colorless ? ['c:c'] : [])].join(' or ')})`;
    else if (facets.colorMode === 'atMost') colors = `c<=${letters.join('')}${colorless ? '' : ' -c:c'}`;
    else colors = `c${facets.colorMode === 'exactly' ? '=' : '>='}${letters.join('')}${colorless ? ' c:c' : ''}`;
  }
  return [spec.q, colors].filter(Boolean).join(' ');
}

export function mapSearchCard(card: CatalogCard, localIds: string[] | null): CardSearchResult {
  return {
    name: card.name, sampleCardId: card.id, layout: card.layout,
    image: card.imageNormal ?? card.faces[0]?.imageNormal ?? null,
    imageSmall: card.imageSmall ?? card.faces[0]?.imageSmall ?? card.faces[0]?.imageNormal ?? null,
    local: !card.digital && card.games.includes('paper') && !!localIds?.includes(card.id),
    scryfallUri: card.scryfallUri, setLabel: `${card.set.toUpperCase()} #${card.collectorNumber}`,
  };
}

/** Same authenticated service, traffic gate, query semantics and pages as web. */
export async function searchCards(q: string, page = 1, ownedOnly = false): Promise<CardSearchPage> {
  const empty = { results: [], total: null, nextPage: null, warnings: [] };
  if (!backend) return { ...empty, error: 'Sign in to search cards.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const { data: { session }, error } = await backend.auth.getSession();
    if (error || !session) return { ...empty, error: 'Sign in to search cards.' };
    const params = specToParams({ q: q || (ownedOnly ? '*' : ''), page });
    if (ownedOnly) params.set('owned_only', 'true');
    const response = await fetch(`${WEB_URL}/api/cards/search?${params}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }, signal: controller.signal,
      redirect: 'error',
    });
    const result = await response.json() as SearchResponse & { localPrintingIds?: string[] | null };
    if (result.status === 'error') return { ...empty, warnings: result.warnings, error: result.message };
    if (!response.ok || result.status !== 'ok' || !Array.isArray(result.cards)) throw new Error('Invalid search response');
    return {
      results: result.cards.map(c => mapSearchCard(c, result.localPrintingIds ?? null)),
      total: ownedOnly ? null : result.totalCards,
      nextPage: result.nextPage, warnings: result.warnings, error: null,
    };
  } catch {
    return { ...empty, error: 'Could not reach card search. Check your connection and try again.' };
  } finally { clearTimeout(timer); }
}
