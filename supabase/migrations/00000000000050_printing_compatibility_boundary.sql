-- Preserve the installed app's cards API while separating physical printing
-- storage. The sync switches to a catalog-only ingest RPC; client reads keep
-- their existing fields and relationships. No user rows or FK identities move.
set lock_timeout = '5s';
alter table public.cards rename to card_printings;
revoke all on public.card_printings from public, anon, authenticated;
grant select on public.card_printings to anon, authenticated, service_role;
create or replace view public.cards with (security_invoker = true) as
select
  p.scryfall_id,
  p.oracle_id,
  p.name,
  p.set_code,
  p.set_name,
  p.collector_number,
  p.rarity,
  p.type_line,
  p.released_at,
  p.image_uri,
  p.image_uri_small,
  p.scryfall_uri,
  p.available_finishes,
  p.lang,
  p.digital,
  p.last_synced_at,
  p.mana_cost,
  p.cmc,
  p.colors,
  p.color_identity,
  p.oracle_text,
  p.flavor_text,
  p.keywords,
  p.power,
  p.toughness,
  p.loyalty,
  p.artist,
  p.layout,
  p.card_faces,
  p.set_type,
  p.price_usd,
  p.price_usd_foil,
  p.price_usd_etched,
  p.price_eur,
  p.price_eur_foil,
  p.tcgplayer_id,
  p.purchase_uri,
  p.prices_updated_at,
  p.flavor_name,
  p.produced_mana,
  p.game_changer,
  p.content_hash
from public.card_printings p;

-- Rebind collection reads to the compatibility view, not the renamed heap.
do $migration$
declare definition text; routine regprocedure;
begin
  definition := replace(pg_get_viewdef('public.collection_entries'::regclass, true), 'card_printings', 'cards');
  execute 'create or replace view public.collection_entries with (security_invoker = true) as ' || definition;
  for routine in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('apply_stack_reprint','apply_stack_rekey')
  loop
    definition := pg_get_functiondef(routine);
    definition := regexp_replace(definition, '(v_(old_card|new_card|card)\s+)public.(?:card_printings|cards)(\s*;)', '\1record\3', 'g');
    execute definition;
  end loop;
end $migration$;
revoke all on public.cards from public, anon, authenticated, service_role;
grant select on public.cards to anon, authenticated, service_role;

-- Write only supplied columns, preserving prices_updated_at on metadata-only
-- batches. Names come from pg_attribute and are quoted, never interpolated SQL.
create function public.write_card_printing_batch(p_rows jsonb) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $function$
declare columns_sql text; updates_sql text; count_written integer; keys text[];
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'Expected at most 1000 printing rows' using errcode='22023';
  end if;
  if jsonb_array_length(p_rows)=0 then return 0; end if;
  select array_agg(k order by k) into keys from jsonb_object_keys(p_rows->0) k;
  if not ('scryfall_id'=any(keys)) then raise exception 'Missing printing id' using errcode='22023'; end if;
  if exists (select 1 from unnest(keys) k where not exists (
    select 1 from pg_attribute where attrelid='public.card_printings'::regclass and attname=k and attnum>0 and not attisdropped))
    or exists (select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r)<>'object'
      or (select array_agg(k order by k) from jsonb_object_keys(r) k) is distinct from keys) then
    raise exception 'Unknown column or heterogeneous printing batch' using errcode='22023';
  end if;
  select string_agg(format('%I',k),', '), string_agg(format('%I=excluded.%I',k,k),', ') filter(where k<>'scryfall_id')
    into columns_sql,updates_sql from unnest(keys) k;
  if updates_sql is null then raise exception 'Empty printing update' using errcode='22023'; end if;
  execute format('insert into public.card_printings (%s) select %s from jsonb_populate_recordset(null::public.card_printings,$1) on conflict(scryfall_id) do update set %s',columns_sql,columns_sql,updates_sql) using p_rows;
  get diagnostics count_written = row_count;
  return count_written;
end $function$;
revoke all on function public.write_card_printing_batch(jsonb) from public, anon, authenticated, service_role;

create function public.ingest_card_printings(p_rows jsonb, p_write boolean default true) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $function$
begin
  if not p_write then return 0; end if;
  return public.write_card_printing_batch(p_rows);
end $function$;
revoke all on function public.ingest_card_printings(jsonb,boolean) from public, anon, authenticated, service_role;
grant execute on function public.ingest_card_printings(jsonb,boolean) to service_role;
notify pgrst, 'reload schema';
