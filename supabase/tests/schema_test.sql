-- ---------------------------------------------------------------------------
-- Schema tests. Run via scripts/verify-migrations.sh.
--
-- These assert the behaviour the Phase 1 brief and data model actually care
-- about: that ownership and location stay decoupled, that the Phase 2 transfer
-- shape works today, that RLS really isolates two users, and that the audit log
-- cannot be edited. Failures raise, so the script exits non-zero.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- --------------------------------------------------------------------------
-- Fixtures: two users, one printing.
-- --------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com', '{"username":"alice"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com',   '{"username":"bob"}');

insert into public.cards (scryfall_id, oracle_id, name, set_code, collector_number,
                          available_finishes, lang, released_at, image_uri_small)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001',
   'Lightning Bolt', 'lea', '161', '{nonfoil}', 'en', '1993-08-05', 'https://img/1'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001',
   'Lightning Bolt', 'm10', '146', '{nonfoil,foil}', 'en', '2009-07-17', 'https://img/2'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'ffffffff-0000-0000-0000-000000000002',
   'Thunderbolt Dragon', 'mh2', '999', '{nonfoil}', 'en', '2021-06-18', 'https://img/3');

-- --------------------------------------------------------------------------
-- 1. Signup auto-creates a profile, and username collisions do not 500.
-- --------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.profiles
   where id = '11111111-1111-1111-1111-111111111111' and username = 'alice';
  assert n = 1, 'profile should be auto-created from raw_user_meta_data.username';

  -- Same username again: must succeed with a suffix rather than error.
  insert into auth.users (id, email, raw_user_meta_data)
  values ('33333333-3333-3333-3333-333333333333', 'alice2@example.com', '{"username":"alice"}');

  select count(*) into n from public.profiles
   where id = '33333333-3333-3333-3333-333333333333' and username = 'alice_1';
  assert n = 1, 'colliding username should be suffixed, got: '
    || (select username from public.profiles where id = '33333333-3333-3333-3333-333333333333');

  -- No username supplied at all.
  insert into auth.users (id, email) values
    ('44444444-4444-4444-4444-444444444444', 'nouser@example.com');
  select count(*) into n from public.profiles
   where id = '44444444-4444-4444-4444-444444444444' and username like 'player\_%';
  assert n = 1, 'missing username should fall back to a generated one';
end $$;

-- --------------------------------------------------------------------------
-- 2. Locations: one level of nesting, no cross-user nesting, no cycles.
-- --------------------------------------------------------------------------
insert into public.locations (id, user_id, name, type) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Binder A', 'binder'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Bob Box',  'box');

insert into public.locations (id, user_id, name, parent_location_id) values
  ('bbbbbbbb-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Page 1', 'bbbbbbbb-0000-0000-0000-000000000001');

do $$
begin
  -- Two levels deep must fail.
  begin
    insert into public.locations (user_id, name, parent_location_id)
    values ('11111111-1111-1111-1111-111111111111', 'Slot 3', 'bbbbbbbb-0000-0000-0000-000000000003');
    assert false, 'two levels of nesting should have been rejected';
  exception when check_violation then null;
  end;

  -- Nesting into another user's location must fail.
  begin
    insert into public.locations (user_id, name, parent_location_id)
    values ('11111111-1111-1111-1111-111111111111', 'Sneaky', 'bbbbbbbb-0000-0000-0000-000000000002');
    assert false, 'cross-user nesting should have been rejected';
  exception when check_violation then null;
  end;

  -- Self-parenting must fail.
  begin
    update public.locations set parent_location_id = id
     where id = 'bbbbbbbb-0000-0000-0000-000000000001';
    assert false, 'self-parenting should have been rejected';
  exception when check_violation then null;
  end;

  -- Duplicate name under the same parent must fail...
  begin
    insert into public.locations (user_id, name, parent_location_id)
    values ('11111111-1111-1111-1111-111111111111', 'page 1', 'bbbbbbbb-0000-0000-0000-000000000001');
    assert false, 'duplicate name within a parent should have been rejected';
  exception when unique_violation then null;
  end;
end $$;

-- ...but the same name under a *different* parent is fine.
insert into public.locations (user_id, name, type) values
  ('11111111-1111-1111-1111-111111111111', 'Binder B', 'binder');
insert into public.locations (user_id, name, parent_location_id)
select '11111111-1111-1111-1111-111111111111', 'Page 1', id
  from public.locations
 where user_id = '11111111-1111-1111-1111-111111111111' and name = 'Binder B';

-- --------------------------------------------------------------------------
-- 3. card_instances: location must belong to the owner.
-- --------------------------------------------------------------------------
insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
   'NM', 'foil', 'en', 3);

do $$
begin
  begin
    insert into public.card_instances (owner_user_id, card_id, location_id)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'bbbbbbbb-0000-0000-0000-000000000002');  -- Bob's box
    assert false, 'parking a card in another user''s location should be rejected';
  exception when check_violation then null;
  end;

  begin
    insert into public.card_instances (owner_user_id, card_id, quantity)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 0);
    assert false, 'quantity 0 should be rejected';
  exception when check_violation then null;
  end;
end $$;

-- --------------------------------------------------------------------------
-- 4. THE PHASE 2 SHAPE. The atomic transfer must be a single UPDATE touching
--    only owner and location. If this test ever starts failing, ownership and
--    location have become coupled and the trade engine just got harder.
-- --------------------------------------------------------------------------
do $$
declare owner_after uuid; loc_after uuid; qty_after int; cond_after text;
begin
  update public.card_instances
     set owner_user_id = '22222222-2222-2222-2222-222222222222',
         location_id   = null
   where id = 'cccccccc-0000-0000-0000-000000000001';

  select owner_user_id, location_id, quantity, condition
    into owner_after, loc_after, qty_after, cond_after
    from public.card_instances where id = 'cccccccc-0000-0000-0000-000000000001';

  assert owner_after = '22222222-2222-2222-2222-222222222222', 'ownership should have transferred';
  assert loc_after is null, 'received cards should land unsorted';
  assert qty_after = 3 and cond_after = 'NM', 'transfer must not disturb unrelated fields';

  -- And transferring without nulling the location is refused, with a message
  -- that names the fix.
  update public.card_instances set owner_user_id = '11111111-1111-1111-1111-111111111111',
         location_id = 'bbbbbbbb-0000-0000-0000-000000000001'
   where id = 'cccccccc-0000-0000-0000-000000000001';

  begin
    update public.card_instances set owner_user_id = '22222222-2222-2222-2222-222222222222'
     where id = 'cccccccc-0000-0000-0000-000000000001';
    assert false, 'changing owner while keeping a stale location should be rejected';
  exception when check_violation then null;
  end;
end $$;

-- --------------------------------------------------------------------------
-- 5. Deleting a location unsorts its cards and promotes its children.
-- --------------------------------------------------------------------------
do $$
declare loc_after uuid; parent_after uuid;
begin
  delete from public.locations where id = 'bbbbbbbb-0000-0000-0000-000000000001';

  select location_id into loc_after
    from public.card_instances where id = 'cccccccc-0000-0000-0000-000000000001';
  assert loc_after is null, 'deleting a location should unsort its cards, not delete them';

  select parent_location_id into parent_after
    from public.locations where id = 'bbbbbbbb-0000-0000-0000-000000000003';
  assert parent_after is null, 'deleting a parent should promote children to top level';
end $$;

-- --------------------------------------------------------------------------
-- 6. ownership_history is append-only, even for the table owner.
-- --------------------------------------------------------------------------
insert into public.ownership_history (card_instance_id, from_user_id, to_user_id)
values ('cccccccc-0000-0000-0000-000000000001', null, '11111111-1111-1111-1111-111111111111');

do $$
begin
  begin
    update public.ownership_history set to_user_id = '22222222-2222-2222-2222-222222222222';
    assert false, 'ownership_history must reject UPDATE';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.ownership_history;
    assert false, 'ownership_history must reject DELETE';
  exception when insufficient_privilege then null;
  end;
end $$;

-- --------------------------------------------------------------------------
-- 7. Card name search: prefix matches rank above substring matches.
-- --------------------------------------------------------------------------
do $$
declare first_name text; n bigint;
begin
  select name into first_name from public.search_card_names('bolt', 10) limit 1;
  assert first_name = 'Lightning Bolt',
    'expected the shorter/prefix-ish match first, got: ' || coalesce(first_name, '<null>');

  select printing_count into n
    from public.search_card_names('Lightning Bolt', 10) where name = 'Lightning Bolt';
  assert n = 2, 'both Lightning Bolt printings should collapse to one suggestion, count=' || n;
end $$;

-- --------------------------------------------------------------------------
-- 8. RLS actually isolates users.
-- --------------------------------------------------------------------------
insert into public.card_instances (owner_user_id, card_id)
values ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000003');

set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

do $$
declare visible int;
begin
  select count(*) into visible from public.card_instances;
  assert visible = 1, 'alice should see only her own instances, saw ' || visible;

  select count(*) into visible from public.locations;
  assert visible = 3, 'alice should see only her own locations, saw ' || visible;

  -- Cards are public reference data.
  select count(*) into visible from public.cards;
  assert visible = 3, 'cards should be readable by any authenticated user';

  -- Cannot hand a card to someone else by editing owner_user_id. The WITH
  -- CHECK clause raises rather than silently filtering, which is what we want:
  -- a failed giveaway should be loud.
  begin
    update public.card_instances set owner_user_id = '22222222-2222-2222-2222-222222222222';
    assert false, 'RLS WITH CHECK should block reassigning ownership directly';
  exception when insufficient_privilege then null;
  end;

  -- Trading tables are deny-all until Phase 2.
  select count(*) into visible from public.trades;
  assert visible = 0, 'trades must be deny-all in Phase 1';
  select count(*) into visible from public.ownership_history;
  assert visible = 0, 'ownership_history must be deny-all in Phase 1';
end $$;

reset role;

rollback;

\echo 'schema_test.sql: all assertions passed'
