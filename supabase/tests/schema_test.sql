-- ---------------------------------------------------------------------------
-- Schema tests. Run via scripts/verify-migrations.sh.
--
-- These assert the behaviour the charter and data model actually care about:
-- that ownership and location stay decoupled, that the atomic transfer shape
-- works, that RLS really isolates two users while opening up exactly the Phase 2
-- trade / ownership_history reads it is meant to (own trades and their items,
-- own + accepted friends' history) and nothing more, that a client still cannot
-- write those tables directly, and that the audit log cannot be edited.
-- Failures raise, so the script exits non-zero.
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
-- 8. RLS actually isolates users, and opens up exactly the Phase 2 reads.
-- --------------------------------------------------------------------------
insert into public.card_instances (id, owner_user_id, card_id)
values ('cccccccc-0000-0000-0000-000000000002',
        '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000003');

-- Phase 2 fixtures, inserted as the table owner (RLS does not apply here):
--
--   * alice and bob are accepted friends;
--   * one trade alice proposed to bob, with an item, plus a trade between two
--     users alice is not party to and not friends with;
--   * ownership_history rows for alice (her own, from section 6), for bob (a
--     friend's inbound transfer), and one between the two strangers.
--
-- Neither friendship nor a bare trade exposes anyone's collection: card_instances
-- and locations still need an is_tradable container, which none of these have, so
-- the "alice sees only her own" counts below are unchanged.
insert into public.friendships (requester_id, addressee_id, status) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'accepted');

insert into public.trades (id, proposer_id, recipient_id, status) values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'proposed'),
  ('dddddddd-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333',
   '44444444-4444-4444-4444-444444444444', 'proposed');

insert into public.trade_items (trade_id, card_instance_id, direction, quantity) values
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'from_proposer', 1),
  ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002', 'from_proposer', 1);

insert into public.ownership_history (card_instance_id, from_user_id, to_user_id) values
  ('cccccccc-0000-0000-0000-000000000002', null, '22222222-2222-2222-2222-222222222222'),
  ('cccccccc-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333',
   '44444444-4444-4444-4444-444444444444');

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

  -- ----------------------------------------------------------------------
  -- Phase 2 posture on trades / trade_items / ownership_history.
  --
  -- Derived from the policies in migration 9 ("trades: read own" L190-194,
  -- "trade_items: read own trades" L219-229, "ownership_history: read own and
  -- friends'" L267-276) and migration 12 ("trades: close own" L56-64).
  -- ----------------------------------------------------------------------

  -- A party reads their own trade and its items...
  select count(*) into visible from public.trades
   where id = 'dddddddd-0000-0000-0000-000000000001';
  assert visible = 1, 'a party should see their own trade, saw ' || visible;
  select count(*) into visible from public.trade_items
   where trade_id = 'dddddddd-0000-0000-0000-000000000001';
  assert visible = 1, 'a party should see their own trade''s items, saw ' || visible;

  -- ...but a stranger's trade and its items are invisible.
  select count(*) into visible from public.trades
   where id = 'dddddddd-0000-0000-0000-000000000002';
  assert visible = 0, 'a non-party must not see a stranger''s trade, saw ' || visible;
  select count(*) into visible from public.trade_items
   where trade_id = 'dddddddd-0000-0000-0000-000000000002';
  assert visible = 0, 'a non-party must not see a stranger''s trade items, saw ' || visible;

  select count(*) into visible from public.trades;
  assert visible = 1, 'alice should see exactly her one trade, saw ' || visible;
  select count(*) into visible from public.trade_items;
  assert visible = 1, 'alice should see exactly her one trade item, saw ' || visible;

  -- ownership_history: own rows and accepted friends' rows are readable; a
  -- transfer between two strangers is not.
  select count(*) into visible from public.ownership_history
   where to_user_id = '11111111-1111-1111-1111-111111111111';
  assert visible = 1, 'a user should see their own ownership_history row, saw ' || visible;
  select count(*) into visible from public.ownership_history
   where to_user_id = '22222222-2222-2222-2222-222222222222';
  assert visible = 1, 'a user should see an accepted friend''s ownership_history row, saw ' || visible;
  select count(*) into visible from public.ownership_history
   where from_user_id = '33333333-3333-3333-3333-333333333333';
  assert visible = 0, 'a user must not see a stranger''s ownership_history row, saw ' || visible;
  select count(*) into visible from public.ownership_history;
  assert visible = 2, 'alice should see exactly own + friend history, saw ' || visible;

  -- Ownership still only moves via accept_trade(): a client cannot complete a
  -- trade itself (WITH CHECK on "trades: close own" allows only the terminal
  -- non-settling statuses), nor insert a trade it did not propose.
  begin
    update public.trades set status = 'completed'
     where id = 'dddddddd-0000-0000-0000-000000000001';
    assert false, 'a client must not be able to mark a trade completed';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.trades (proposer_id, recipient_id, status)
    values ('22222222-2222-2222-2222-222222222222',
            '11111111-1111-1111-1111-111111111111', 'proposed');
    assert false, 'a client must not insert a trade it did not propose';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.trade_items (trade_id, card_instance_id, direction)
    values ('dddddddd-0000-0000-0000-000000000002',
            'cccccccc-0000-0000-0000-000000000001', 'from_proposer');
    assert false, 'a client must not add items to a trade it does not own';
  exception when insufficient_privilege then null;
  end;

  -- ownership_history has no client write policy at all: INSERT is refused
  -- outright, and (section 6) UPDATE/DELETE stay blocked by the append-only
  -- trigger for every role.
  begin
    insert into public.ownership_history (card_instance_id, to_user_id)
    values ('cccccccc-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111');
    assert false, 'a client must not insert into ownership_history';
  exception when insufficient_privilege then null;
  end;

  -- trades / trade_items expose no DELETE policy, so a delete simply matches no
  -- rows rather than erroring — the row must survive.
  delete from public.trades where id = 'dddddddd-0000-0000-0000-000000000001';
  select count(*) into visible from public.trades
   where id = 'dddddddd-0000-0000-0000-000000000001';
  assert visible = 1, 'trades has no client DELETE policy; the row must survive';
end $$;

reset role;

rollback;

\echo 'schema_test.sql: all assertions passed'
