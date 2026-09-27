\set ON_ERROR_STOP on
create or replace function public.upkeep_contract_claim() returns void language sql as $$
select set_config('request.jwt.claim.sub', coalesce(current_setting('request.jwt.claims', true)::jsonb->>'sub', ''), true);
$$;
grant execute on function public.upkeep_contract_claim() to anon, authenticated, service_role;
insert into auth.users(id,email,raw_user_meta_data) values
('de000000-0000-0000-0000-000000000001','contract-owner@example.com','{"username":"contract_owner"}'),
('de000000-0000-0000-0000-000000000002','contract-other@example.com','{"username":"contract_other"}') on conflict do nothing;
insert into public.card_printings(scryfall_id,name,set_code,collector_number,available_finishes) values
('de000000-0000-0000-0000-000000000010','Contract Card','tst','1','{nonfoil}') on conflict do nothing;
insert into public.locations(id,user_id,name,type,commander_card_id) values
('de000000-0000-0000-0000-000000000020','de000000-0000-0000-0000-000000000001','Contract Deck','deck','de000000-0000-0000-0000-000000000010') on conflict do nothing;
insert into public.card_instances(id,owner_user_id,card_id,location_id) values
('de000000-0000-0000-0000-000000000030','de000000-0000-0000-0000-000000000001','de000000-0000-0000-0000-000000000010','de000000-0000-0000-0000-000000000020') on conflict do nothing;
insert into public.deck_cards(id,deck_id,card_id) values
('de000000-0000-0000-0000-000000000040','de000000-0000-0000-0000-000000000020','de000000-0000-0000-0000-000000000010') on conflict do nothing;
insert into public.want_list(id,user_id,card_id) values
('de000000-0000-0000-0000-000000000050','de000000-0000-0000-0000-000000000001','de000000-0000-0000-0000-000000000010') on conflict do nothing;
insert into public.trades(id,proposer_id,recipient_id) values
('de000000-0000-0000-0000-000000000060','de000000-0000-0000-0000-000000000001','de000000-0000-0000-0000-000000000002') on conflict do nothing;
insert into public.trade_items(id,trade_id,card_instance_id,direction,quantity) values
('de000000-0000-0000-0000-000000000070','de000000-0000-0000-0000-000000000060','de000000-0000-0000-0000-000000000030','from_proposer',1) on conflict do nothing;
