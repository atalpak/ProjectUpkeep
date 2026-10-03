-- Scryfall's oracle_tags and rulings bulk feeds are card-level data. Keep them
-- separate from printing writes and from customer tables. Tag links deliberately
-- do not reference oracle_cards: independently published feeds can temporarily
-- disagree about which Oracle IDs exist (as the printing and Oracle feeds do).

create table public.oracle_tags (
  id uuid primary key,
  label text not null,
  slug text not null,
  description text,
  uri text,
  aliases text[] not null default '{}',
  parent_ids uuid[] not null default '{}',
  child_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);
create index oracle_tags_slug_idx on public.oracle_tags (slug);

create table public.oracle_tag_cards (
  tag_id uuid not null references public.oracle_tags(id) on delete cascade,
  oracle_id uuid not null,
  weight text not null,
  primary key (tag_id, oracle_id)
);
create index oracle_tag_cards_oracle_id_idx on public.oracle_tag_cards (oracle_id);

-- A ruling has no Scryfall ID. The loader hashes its complete source tuple;
-- identical lines deduplicate and a changed comment becomes a new row.
create table public.oracle_rulings (
  content_hash text primary key,
  oracle_id uuid not null,
  source text not null,
  published_at date not null,
  comment text not null
);
create index oracle_rulings_oracle_id_date_idx
  on public.oracle_rulings (oracle_id, published_at desc);

alter table public.oracle_tags enable row level security;
alter table public.oracle_tag_cards enable row level security;
alter table public.oracle_rulings enable row level security;

-- Public catalog data is readable by the same roles as oracle_cards. New
-- tables inherit broad Supabase defaults, so revoke writes explicitly.
revoke all on public.oracle_tags, public.oracle_tag_cards, public.oracle_rulings
  from public, anon, authenticated, service_role;
grant select on public.oracle_tags, public.oracle_tag_cards, public.oracle_rulings
  to anon, authenticated, service_role;
create policy "oracle_tags: public catalog reads" on public.oracle_tags
  for select to anon, authenticated using (true);
create policy "oracle_tag_cards: public catalog reads" on public.oracle_tag_cards
  for select to anon, authenticated using (true);
create policy "oracle_rulings: public catalog reads" on public.oracle_rulings
  for select to anon, authenticated using (true);

-- Only the existing least-privilege direct loader may refresh these feeds.
-- DELETE is needed to remove taggings or rulings that Scryfall retracts;
-- the loader checks feed completeness before entering that transaction.
grant select, insert, update, delete
  on public.oracle_tags, public.oracle_tag_cards, public.oracle_rulings
  to scryfall_loader;
create policy "oracle_tags: loader write" on public.oracle_tags
  for all to scryfall_loader using (true) with check (true);
create policy "oracle_tag_cards: loader write" on public.oracle_tag_cards
  for all to scryfall_loader using (true) with check (true);
create policy "oracle_rulings: loader write" on public.oracle_rulings
  for all to scryfall_loader using (true) with check (true);

-- Run history remains limited to this loader's own three catalog feeds. Its
-- column grants from migration 44 still exclude catalog publish bookkeeping.
drop policy "scryfall_sync_runs: loader select" on public.scryfall_sync_runs;
drop policy "scryfall_sync_runs: loader insert" on public.scryfall_sync_runs;
drop policy "scryfall_sync_runs: loader update" on public.scryfall_sync_runs;
create policy "scryfall_sync_runs: loader select" on public.scryfall_sync_runs
  for select to scryfall_loader
  using (bulk_type in ('oracle_cards', 'oracle_tags', 'rulings'));
create policy "scryfall_sync_runs: loader insert" on public.scryfall_sync_runs
  for insert to scryfall_loader
  with check (bulk_type in ('oracle_cards', 'oracle_tags', 'rulings'));
create policy "scryfall_sync_runs: loader update" on public.scryfall_sync_runs
  for update to scryfall_loader
  using (bulk_type in ('oracle_cards', 'oracle_tags', 'rulings'))
  with check (bulk_type in ('oracle_cards', 'oracle_tags', 'rulings'));

notify pgrst, 'reload schema';
