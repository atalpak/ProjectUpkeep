-- Read-only production audit for Oracle/printing normalization.
-- No credentials or customer records are selected.
-- Run statements separately through the management API to keep requests bounded.
select pg_size_pretty(pg_database_size(current_database())) as database_size;
select count(*) as printings, count(*) filter (where c.oracle_id is null) as no_oracle_id,
       count(*) filter (where c.oracle_id is not null and o.oracle_id is null) as missing_oracle_printings,
       count(distinct c.oracle_id) filter (where o.oracle_id is null) as missing_oracle_ids
from public.cards c left join public.oracle_cards o using (oracle_id);
select
  count(*) filter (where o.oracle_id is not null and c.mana_cost is distinct from o.mana_cost) as mana_cost_differing_printings,
  count(*) filter (where o.oracle_id is not null and c.cmc is distinct from o.cmc) as cmc_differing_printings,
  count(*) filter (where o.oracle_id is not null and c.type_line is distinct from o.type_line) as type_line_differing_printings,
  count(*) filter (where o.oracle_id is not null and c.oracle_text is distinct from o.oracle_text) as oracle_text_differing_printings,
  count(*) filter (where o.oracle_id is not null and c.colors is distinct from o.colors) as colors_differing_printings,
  count(*) filter (where o.oracle_id is not null and c.color_identity is distinct from o.color_identity) as color_identity_differing_printings,
  count(*) filter (where o.oracle_id is not null and c.keywords is distinct from o.keywords) as keywords_differing_printings,
  count(*) filter (where o.oracle_id is not null and c.power is distinct from o.power) as power_differing_printings,
  count(*) filter (where o.oracle_id is not null and c.toughness is distinct from o.toughness) as toughness_differing_printings,
  count(*) filter (where o.oracle_id is not null and c.loyalty is distinct from o.loyalty) as loyalty_differing_printings,
  count(*) filter (where o.oracle_id is not null and c.produced_mana is distinct from o.produced_mana) as produced_mana_differing_printings,
  count(*) filter (where o.oracle_id is not null and c.game_changer is distinct from o.game_changer) as game_changer_differing_printings,
  count(*) filter (where o.oracle_id is not null and c.layout is distinct from o.layout) as layout_differing_printings
from public.cards c left join public.oracle_cards o using (oracle_id);
select indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) as size, idx_scan
from pg_stat_user_indexes where relname in ('cards', 'oracle_cards') order by pg_relation_size(indexrelid) desc;

select c.relname, pg_relation_size(c.oid) as heap_bytes,
       pg_table_size(c.oid) as table_bytes_including_toast,
       pg_indexes_size(c.oid) as index_bytes,
       pg_total_relation_size(c.oid) as total_relation_bytes
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('cards', 'oracle_cards');
