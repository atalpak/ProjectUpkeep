-- Source-snapshot compatibility and catalog writer boundary. No persisted fixtures.
\set ON_ERROR_STOP on
begin;
create temporary table storage_sources(label text primary key, row_data jsonb);
grant select on storage_sources to service_role;
insert into storage_sources values ('canonical', '{
 "scryfall_id":"cafe0000-0000-0000-0000-000000000001",
 "oracle_id":"cafe0000-0000-0000-0000-000000000010",
 "name":"Storage regression card","set_code":"tst","collector_number":"1",
 "mana_cost":"{R}","cmc":1,"type_line":"Creature — Test",
 "oracle_text":"Original rules","colors":["R","G"],"color_identity":["R","G"],
 "keywords":["Flying","Haste"],"power":"1","toughness":"2","loyalty":null,
 "produced_mana":["R","G"],"game_changer":false,"layout":"normal",
 "content_hash":"printing-original","price_usd":1.25,"prices_updated_at":"2026-01-01T00:00:00Z"
}');
insert into public.oracle_cards
select (jsonb_populate_record(null::public.oracle_cards,
 row_data || jsonb_build_object('content_hash','oracle-original','legalities','{}'::jsonb,'updated_at',now()))).*
from storage_sources where label='canonical';
set local role service_role;
select public.ingest_card_printings(jsonb_build_array(row_data)) from storage_sources;
reset role;
do $$ begin
 assert not exists(select 1 from public.card_rule_overrides where scryfall_id='cafe0000-0000-0000-0000-000000000001'), 'identical canonical fields must not allocate an override';
 assert (select oracle_text='Original rules' and colors=array['R','G'] from public.cards where scryfall_id='cafe0000-0000-0000-0000-000000000001'), 'canonical API read changed';
end $$;

-- Explicit null is different from a canonical non-null value, and array order
-- is part of the existing printing snapshot (not a set comparison).
insert into storage_sources select 'different',row_data || '{"scryfall_id":"cafe0000-0000-0000-0000-000000000002","collector_number":"2","oracle_text":null,"colors":["G","R"],"keywords":[],"produced_mana":null}' from storage_sources where label='canonical';
set local role service_role;
select public.ingest_card_printings(jsonb_build_array(row_data)) from storage_sources where label='different';
reset role;
do $$ begin
 assert (select fields ? 'oracle_text' and fields->'oracle_text'='null'::jsonb and fields->'colors'='["G","R"]'::jsonb and fields->'keywords'='[]'::jsonb and fields->'produced_mana'='null'::jsonb from public.card_rule_overrides where scryfall_id='cafe0000-0000-0000-0000-000000000002'), 'null/array differences were lost';
 assert (select oracle_text is null and colors=array['G','R'] and keywords='{}'::text[] and produced_mana is null from public.cards where scryfall_id='cafe0000-0000-0000-0000-000000000002'), 'override API read failed explicit null/array order';
end $$;

-- Both a missing canonical row and a null identity retain all source fields.
insert into storage_sources select 'missing',row_data || '{"scryfall_id":"cafe0000-0000-0000-0000-000000000003","oracle_id":"cafe0000-0000-0000-0000-000000000020","collector_number":"3"}' from storage_sources where label='canonical';
insert into storage_sources select 'null-id',row_data || '{"scryfall_id":"cafe0000-0000-0000-0000-000000000004","oracle_id":null,"collector_number":"4"}' from storage_sources where label='canonical';
set local role service_role;
select public.ingest_card_printings(jsonb_agg(row_data)) from storage_sources where label in ('missing','null-id');
reset role;
do $$ begin
 assert (select count(*)=2 from public.card_rule_overrides where scryfall_id in ('cafe0000-0000-0000-0000-000000000003','cafe0000-0000-0000-0000-000000000004') and (select count(*) from jsonb_object_keys(fields))=13), 'missing Oracle fallback must retain every shared field';
 assert (select count(*)=2 from public.cards where scryfall_id in ('cafe0000-0000-0000-0000-000000000003','cafe0000-0000-0000-0000-000000000004') and oracle_text='Original rules' and mana_cost='{R}' and colors=array['R','G'] and loyalty is null), 'fallback source values changed';
end $$;

-- An Oracle-first update cannot silently change already ingested printings.
update public.oracle_cards set oracle_text='New canonical rules',colors=array['U'],power=null,layout='transform' where oracle_id='cafe0000-0000-0000-0000-000000000010';
do $$ begin
 assert (select oracle_text='Original rules' and colors=array['R','G'] and power='1' and layout='normal' from public.cards where scryfall_id='cafe0000-0000-0000-0000-000000000001'), 'Oracle update did not freeze former canonical printing';
 assert (select oracle_text is null and colors=array['G','R'] and power='1' and layout='normal' from public.cards where scryfall_id='cafe0000-0000-0000-0000-000000000002'), 'Oracle update overwrote preexisting null/array overrides';
end $$;
-- Hash-skipped printing rows must still reconcile overrides, without altering
-- printing hash, prices, or their independent freshness timestamp.
update storage_sources set row_data=row_data || '{"oracle_text":"New canonical rules","colors":["U"],"power":null,"layout":"transform","content_hash":"should-not-write","price_usd":99,"prices_updated_at":"2026-02-01T00:00:00Z"}' where label='canonical';
set local role service_role;
do $$ declare n integer; begin
 select public.ingest_card_printings(jsonb_build_array(row_data),false) into n from storage_sources where label='canonical';
 assert n=0, 'refresh-only must report no base writes';
end $$;
reset role;
do $$ begin
 assert not exists(select 1 from public.card_rule_overrides where scryfall_id='cafe0000-0000-0000-0000-000000000001'), 'refresh-only identical source must clear frozen exceptions';
 assert (select oracle_text='New canonical rules' and power is null and content_hash='printing-original' and price_usd=1.25 and prices_updated_at='2026-01-01T00:00:00Z' from public.cards where scryfall_id='cafe0000-0000-0000-0000-000000000001'), 'refresh-only changed base metadata or failed to advance source';
end $$;

-- Delete freezes even inherited null fields, then a replacement canonical row
-- must not overwrite the preserved printing snapshot.
delete from public.oracle_cards where oracle_id='cafe0000-0000-0000-0000-000000000010';
do $$ begin
 assert (select oracle_text='New canonical rules' and power is null and layout='transform' and colors=array['U'] from public.cards where scryfall_id='cafe0000-0000-0000-0000-000000000001'), 'Oracle deletion lost printing snapshot';
 assert (select fields ? 'power' and fields->'power'='null'::jsonb from public.card_rule_overrides where scryfall_id='cafe0000-0000-0000-0000-000000000001'), 'delete did not freeze inherited null';
end $$;
insert into public.oracle_cards(oracle_id,name,oracle_text,content_hash) values('cafe0000-0000-0000-0000-000000000010','Replacement','Replacement rules','replacement');
do $$ begin
 assert (select oracle_text='New canonical rules' and colors=array['U'] from public.cards where scryfall_id='cafe0000-0000-0000-0000-000000000001'), 'Oracle replacement changed old source snapshot';
end $$;

-- Source-first arrival followed by canonical arrival: keep the source until
-- the next refresh explicitly reconciles its now-identical canonical values.
insert into public.oracle_cards
select (jsonb_populate_record(null::public.oracle_cards,row_data || jsonb_build_object('content_hash','late-oracle','legalities','{}'::jsonb,'updated_at',now()))).*
from storage_sources where label='missing';
do $$ begin
 assert (select oracle_text='Original rules' from public.cards where scryfall_id='cafe0000-0000-0000-0000-000000000003'), 'late Oracle arrival lost source-first printing';
 assert exists(select 1 from public.card_rule_overrides where scryfall_id='cafe0000-0000-0000-0000-000000000003'), 'late Oracle insert unexpectedly rewrote source overrides';
end $$;
set local role service_role;
select public.ingest_card_printings(jsonb_build_array(row_data),false) from storage_sources where label='missing';
reset role;
do $$ begin
 assert not exists(select 1 from public.card_rule_overrides where scryfall_id='cafe0000-0000-0000-0000-000000000003'), 'source-first reconcile must remove identical exceptions';
end $$;

-- Exercise privileges under the actual roles, rather than merely inspecting
-- grants. RPC/helper calls require insufficient_privilege; existing client RLS
-- may instead deny table UPDATE by filtering every row. Other errors fail.
do $$ declare r text; affected integer; begin
 foreach r in array array['anon','authenticated','scryfall_loader'] loop
  execute format('set local role %I',r);
  begin
   perform public.ingest_card_printings('[]'::jsonb);
   raise exception 'Unexpected ingest permission for %',r;
  exception when insufficient_privilege then null; end;
  execute 'reset role';
 end loop;
 foreach r in array array['anon','authenticated','service_role','scryfall_loader'] loop
  execute format('set local role %I',r);
  begin
   perform public.write_card_printing_batch('[]'::jsonb);
   raise exception 'Unexpected helper permission for %',r;
  exception when insufficient_privilege then null; end;
  begin
   perform public.card_shared_fields('{}'::jsonb);
   raise exception 'Unexpected shared helper permission for %',r;
  exception when insufficient_privilege then null; end;
  begin
   update public.card_printings set name='Unauthorized' where scryfall_id='cafe0000-0000-0000-0000-000000000001';
   get diagnostics affected=row_count;
   assert affected=0, 'Unexpected direct printing mutation for ' || r;
   assert r in ('anon','authenticated'), 'Catalog writer retained direct table privilege: ' || r;
  exception when insufficient_privilege then null; end;
  begin
   update public.card_rule_overrides set fields='{}' where scryfall_id='cafe0000-0000-0000-0000-000000000002';
   get diagnostics affected=row_count;
   assert affected=0, 'Unexpected override mutation for ' || r;
   assert r in ('anon','authenticated'), 'Catalog writer retained direct override privilege: ' || r;
  exception when insufficient_privilege then null; end;
  execute 'reset role';
 end loop;
end $$;
rollback;
\echo 'Card storage compatibility and permission tests passed (fixtures rolled back).'
