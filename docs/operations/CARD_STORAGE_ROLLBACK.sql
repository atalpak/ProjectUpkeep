-- Emergency rollback of normalization only. Keep the migration-50 API/writer
-- boundary; the new sync writer continues to work. Run with BOTH printing and
-- Oracle writers paused/idle and an
-- approved maintenance window. This rewrites catalog rows, never customer rows.
-- Do not delete migration history: follow recovery with a corrective migration.
\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
lock table public.oracle_cards, public.card_printings in access exclusive mode;
create temporary table printing_rules_recovery on commit drop as select * from public.cards;
do $rollback$
declare field record; assignment text; projection text;
begin
  for field in select attname,format_type(atttypid,atttypmod) as kind
    from pg_attribute where attrelid='public.cards'::regclass and attnum>0 and not attisdropped
    and attname=any(array['mana_cost','cmc','type_line','oracle_text','colors','color_identity','keywords','power','toughness','loyalty','produced_mana','game_changer','layout'])
  loop
    execute format('alter table public.card_printings add column %I %s',field.attname,field.kind);
  end loop;
  select string_agg(format('%I=r.%I',attname,attname),',') into assignment
    from pg_attribute where attrelid='public.cards'::regclass and attnum>0 and not attisdropped
    and attname=any(array['mana_cost','cmc','type_line','oracle_text','colors','color_identity','keywords','power','toughness','loyalty','produced_mana','game_changer','layout']);
  execute 'update public.card_printings p set '||assignment||' from printing_rules_recovery r where r.scryfall_id=p.scryfall_id';
  select string_agg(format('p.%I',attname),',' order by attnum) into projection
    from pg_attribute where attrelid='public.cards'::regclass and attnum>0 and not attisdropped;
  execute 'create or replace view public.cards with(security_invoker=true) as select '||projection||' from public.card_printings p';
  if exists(select 1 from printing_rules_recovery r full join public.cards c using(scryfall_id) where to_jsonb(r) is distinct from to_jsonb(c)) then
    raise exception 'Rollback printing parity failed';
  end if;
end $rollback$;
create or replace function public.ingest_card_printings(p_rows jsonb,p_write boolean default true) returns integer
language plpgsql security definer set search_path=pg_catalog,public as $function$
begin
  if not p_write then return 0; end if;
  return public.write_card_printing_batch(p_rows);
end $function$;
drop trigger oracle_cards_preserve_printing_snapshot on public.oracle_cards;
drop function public.freeze_printing_rules();
drop function public.card_shared_fields(jsonb);
drop table public.card_rule_overrides;
create index cards_type_line_trgm_idx on public.card_printings using gin(type_line extensions.gin_trgm_ops);
create index cards_oracle_text_trgm_idx on public.card_printings using gin(oracle_text extensions.gin_trgm_ops);
notify pgrst,'reload schema';
commit;
