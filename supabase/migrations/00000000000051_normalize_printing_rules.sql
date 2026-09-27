-- Deduplicate card rules while preserving every printing's last ingested
-- default_cards snapshot, including nulls and absent Oracle records. Oracle
-- changes freeze old effective values; only printing ingest can advance them.
-- Disk compaction is a later measured operation, not hidden in this migration.
set lock_timeout='5s';
create table public.card_rule_overrides (
  scryfall_id uuid primary key references public.card_printings(scryfall_id) on delete cascade,
  fields jsonb not null check(jsonb_typeof(fields)='object')
);
alter table public.card_rule_overrides enable row level security;
revoke all on public.card_rule_overrides from public, anon, authenticated, service_role;
grant select on public.card_rule_overrides to anon, authenticated, service_role;
create policy "card_rule_overrides: public catalog reads" on public.card_rule_overrides for select to anon, authenticated using(true);
-- Extract shared fields without dropping explicit JSON nulls.
create function public.card_shared_fields(p_row jsonb) returns jsonb
language sql immutable strict set search_path=pg_catalog as $function$
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p_row)
  where key=any(array['mana_cost','cmc','type_line','oracle_text','colors','color_identity','keywords','power','toughness','loyalty','produced_mana','game_changer','layout']::text[]);
$function$;
revoke all on function public.card_shared_fields(jsonb) from public, anon, authenticated, service_role;

insert into public.card_rule_overrides(scryfall_id,fields)
select p.scryfall_id, differences.fields
from public.card_printings p left join public.oracle_cards o using(oracle_id)
cross join lateral (
  select coalesce(jsonb_object_agg(v.key,v.value),'{}'::jsonb) fields
  from jsonb_each(public.card_shared_fields(to_jsonb(p))) v
  where o.oracle_id is null or v.value is distinct from to_jsonb(o)->v.key
) differences where differences.fields<>'{}'::jsonb;
create or replace view public.cards with(security_invoker=true) as
select
  p.scryfall_id,
  p.oracle_id,
  p.name,
  p.set_code,
  p.set_name,
  p.collector_number,
  p.rarity,
  case when x.fields ? 'type_line' then (x.fields->>'type_line')::text else o.type_line end as type_line,
  p.released_at,
  p.image_uri,
  p.image_uri_small,
  p.scryfall_uri,
  p.available_finishes,
  p.lang,
  p.digital,
  p.last_synced_at,
  case when x.fields ? 'mana_cost' then (x.fields->>'mana_cost')::text else o.mana_cost end as mana_cost,
  case when x.fields ? 'cmc' then (x.fields->>'cmc')::real else o.cmc end as cmc,
  case when x.fields ? 'colors' then case when x.fields->'colors'='null'::jsonb then null::text[] else array(select jsonb_array_elements_text(x.fields->'colors')) end else o.colors end as colors,
  case when x.fields ? 'color_identity' then case when x.fields->'color_identity'='null'::jsonb then null::text[] else array(select jsonb_array_elements_text(x.fields->'color_identity')) end else o.color_identity end as color_identity,
  case when x.fields ? 'oracle_text' then (x.fields->>'oracle_text')::text else o.oracle_text end as oracle_text,
  p.flavor_text,
  case when x.fields ? 'keywords' then case when x.fields->'keywords'='null'::jsonb then null::text[] else array(select jsonb_array_elements_text(x.fields->'keywords')) end else o.keywords end as keywords,
  case when x.fields ? 'power' then (x.fields->>'power')::text else o.power end as power,
  case when x.fields ? 'toughness' then (x.fields->>'toughness')::text else o.toughness end as toughness,
  case when x.fields ? 'loyalty' then (x.fields->>'loyalty')::text else o.loyalty end as loyalty,
  p.artist,
  case when x.fields ? 'layout' then (x.fields->>'layout')::text else o.layout end as layout,
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
  case when x.fields ? 'produced_mana' then case when x.fields->'produced_mana'='null'::jsonb then null::text[] else array(select jsonb_array_elements_text(x.fields->'produced_mana')) end else o.produced_mana end as produced_mana,
  case when x.fields ? 'game_changer' then (x.fields->>'game_changer')::boolean else o.game_changer end as game_changer,
  p.content_hash
from public.card_printings p left join public.oracle_cards o using(oracle_id)
left join public.card_rule_overrides x using(scryfall_id);

-- Acquire the same transaction lock for both writers, so a concurrent Oracle
-- update cannot race an ingest that compared the prior canonical value.
create function public.freeze_printing_rules() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $function$
declare old_fields jsonb; new_fields jsonb; changed text[];
begin
  perform pg_advisory_xact_lock(740512935);
  if tg_op='INSERT' then return new; end if;
  old_fields:=public.card_shared_fields(to_jsonb(old));
  new_fields:=case when tg_op='DELETE' then '{}'::jsonb else public.card_shared_fields(to_jsonb(new)) end;
  if tg_op='UPDATE' and new.oracle_id is distinct from old.oracle_id then
    raise exception 'Oracle identity cannot be changed' using errcode='22023';
  end if;
  select array_agg(key) into changed from jsonb_each(old_fields) where value is distinct from new_fields->key;
  if changed is not null then
    insert into public.card_rule_overrides(scryfall_id,fields)
    select p.scryfall_id, coalesce(x.fields,'{}'::jsonb) || (
      select jsonb_object_agg(k,coalesce(x.fields->k,old_fields->k)) from unnest(changed) k)
    from public.card_printings p left join public.card_rule_overrides x using(scryfall_id)
    where p.oracle_id=old.oracle_id
    on conflict(scryfall_id) do update set fields=excluded.fields;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $function$;
revoke all on function public.freeze_printing_rules() from public,anon,authenticated,service_role,scryfall_loader;
create trigger oracle_cards_preserve_printing_snapshot before insert or update or delete on public.oracle_cards
for each row execute function public.freeze_printing_rules();

do $migration$
begin
  if exists(select 1 from public.cards c join public.card_printings p using(scryfall_id)
    where to_jsonb(c) is distinct from to_jsonb(p)) then
    raise exception 'Printing compatibility parity check failed';
  end if;
end $migration$;
alter table public.card_printings drop column mana_cost;
alter table public.card_printings drop column cmc;
alter table public.card_printings drop column type_line;
alter table public.card_printings drop column oracle_text;
alter table public.card_printings drop column colors;
alter table public.card_printings drop column color_identity;
alter table public.card_printings drop column keywords;
alter table public.card_printings drop column power;
alter table public.card_printings drop column toughness;
alter table public.card_printings drop column loyalty;
alter table public.card_printings drop column produced_mana;
alter table public.card_printings drop column game_changer;
alter table public.card_printings drop column layout;

-- Even source rows skipped by hash planning refresh exceptions after Oracle
-- updates. p_write=false may refresh only existing printing identities.
create or replace function public.ingest_card_printings(p_rows jsonb,p_write boolean default true) returns integer
language plpgsql security definer set search_path=pg_catalog,public as $function$
declare base_rows jsonb; written integer:=0;
begin
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>1000 then
    raise exception 'Expected at most 1000 printing rows' using errcode='22023';
  end if;
  if jsonb_array_length(p_rows)=0 then return 0; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r)<>'object'
    or not r ? 'scryfall_id' or not r ?& array['mana_cost','cmc','type_line','oracle_text','colors','color_identity','keywords','power','toughness','loyalty','produced_mana','game_changer','layout']::text[]) then
    raise exception 'Missing source shared fields' using errcode='22023';
  end if;
  -- Cast every supplied field through the API row type before retaining JSON.
  perform jsonb_populate_record(null::public.cards,r) from jsonb_array_elements(p_rows) r;
  perform pg_advisory_xact_lock(740512935);
  if p_write then
    select jsonb_agg(r-array['mana_cost','cmc','type_line','oracle_text','colors','color_identity','keywords','power','toughness','loyalty','produced_mana','game_changer','layout']::text[]) into base_rows from jsonb_array_elements(p_rows) r;
    written:=public.write_card_printing_batch(base_rows);
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r left join public.card_printings p on p.scryfall_id=(r->>'scryfall_id')::uuid where p.scryfall_id is null) then
    raise exception 'Unknown printing in refresh-only batch' using errcode='22023';
  end if;
  -- Fail if a refresh-only source identity doesn't match its stored printing.
  if exists(select 1 from jsonb_array_elements(p_rows) r join public.card_printings p on p.scryfall_id=(r->>'scryfall_id')::uuid
    where p.oracle_id is distinct from (r->>'oracle_id')::uuid) then
    raise exception 'Printing Oracle identity mismatch' using errcode='22023';
  end if;
  insert into public.card_rule_overrides(scryfall_id,fields)
  select p.scryfall_id,d.fields from jsonb_array_elements(p_rows) r
  join public.card_printings p on p.scryfall_id=(r->>'scryfall_id')::uuid
  left join public.oracle_cards o on o.oracle_id=p.oracle_id
  cross join lateral(select coalesce(jsonb_object_agg(v.key,v.value),'{}'::jsonb) fields
    from jsonb_each(public.card_shared_fields(r)) v
    where o.oracle_id is null or v.value is distinct from to_jsonb(o)->v.key) d
  where d.fields<>'{}'::jsonb
  on conflict(scryfall_id) do update set fields=excluded.fields
  where card_rule_overrides.fields is distinct from excluded.fields;
  delete from public.card_rule_overrides x using jsonb_array_elements(p_rows) r, public.oracle_cards o,public.card_printings p
  where p.scryfall_id=(r->>'scryfall_id')::uuid and x.scryfall_id=p.scryfall_id and o.oracle_id=p.oracle_id
    and public.card_shared_fields(r)=public.card_shared_fields(to_jsonb(o));
  return written;
end $function$;
-- The only catalog writer is the tightly scoped ingest function.
revoke insert,update,delete,truncate on public.card_printings from service_role;
notify pgrst,'reload schema';
