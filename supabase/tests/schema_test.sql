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
--   * one trade alice proposed to bob, with an item (alice is a party);
--   * one trade bob proposed to a third party — bob is a party, alice is bob's
--     accepted friend but NOT a party. The trades / trade_items SELECT policies
--     are party-only (no are_friends arm), so alice must see none of it. This
--     guards against a regression that wrongly adds are_friends() there;
--   * one trade between two strangers alice is neither party to nor friends with;
--   * ownership_history rows exercising every arm of migration 9's
--     "read own and friends'" policy: alice's own (to_user_id), a friend's
--     inbound transfer (are_friends(to_user_id)), a row where a friend is the
--     *sender* (are_friends(from_user_id)), and a stranger→stranger row (no arm).
--
-- Dedicated stranger pair (carol / dave) so this section does not piggyback on
-- the signup-fallback rows 33333333 / 44444444 created by the username tests
-- above, and does not break if someone edits those tests.
insert into auth.users (id, email, raw_user_meta_data) values
  ('55555555-5555-5555-5555-555555555555', 'carol@example.com', '{"username":"carol"}'),
  ('66666666-6666-6666-6666-666666666666', 'dave@example.com',  '{"username":"dave"}');

-- A throwaway instance owned by a stranger (null location is fine). Gives the
-- stranger trade's item and the stranger ownership_history row a card that a
-- party actually owns — the old fixture pointed the stranger trade_items row at
-- cccccccc-...02, which is bob's card, and read as a mistake even though no
-- CHECK rejects it.
insert into public.card_instances (id, owner_user_id, card_id)
values ('cccccccc-0000-0000-0000-000000000003',
        '55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-000000000003');

-- Neither friendship nor a bare trade exposes anyone's collection: card_instances
-- and locations still need an is_tradable container, which none of these have, so
-- the "alice sees only her own" counts below are unchanged.
insert into public.friendships (requester_id, addressee_id, status) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'accepted');

insert into public.trades (id, proposer_id, recipient_id, status) values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'proposed'),
  -- bob -> a third party: bob is a party, alice is bob's friend but not a party.
  ('dddddddd-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   '55555555-5555-5555-5555-555555555555', 'proposed'),
  -- stranger -> stranger: alice is neither a party nor a friend of either side.
  ('dddddddd-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555',
   '66666666-6666-6666-6666-666666666666', 'proposed');

insert into public.trade_items (trade_id, card_instance_id, direction, quantity) values
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'from_proposer', 1),
  ('dddddddd-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000002', 'from_proposer', 1),
  ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003', 'from_proposer', 1);

insert into public.ownership_history (card_instance_id, from_user_id, to_user_id) values
  -- friend (bob) is the recipient  -> are_friends(to_user_id, alice) arm
  ('cccccccc-0000-0000-0000-000000000002', null, '22222222-2222-2222-2222-222222222222'),
  -- friend (bob) is the sender     -> are_friends(from_user_id, alice) arm
  ('cccccccc-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   '55555555-5555-5555-5555-555555555555'),
  -- stranger -> stranger           -> no arm matches, invisible to alice
  ('cccccccc-0000-0000-0000-000000000003', '55555555-5555-5555-5555-555555555555',
   '66666666-6666-6666-6666-666666666666');

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

  -- ...and so is a trade where an accepted friend (bob) is a party but alice is
  -- not. The trades / trade_items SELECT policies are party-only — no
  -- are_friends() arm — so friendship buys no visibility here. If this ever
  -- returns > 0, someone has widened the trade read policy.
  select count(*) into visible from public.trades
   where id = 'dddddddd-0000-0000-0000-000000000003';
  assert visible = 0, 'a friend who is not a party must not see the trade, saw ' || visible;
  select count(*) into visible from public.trade_items
   where trade_id = 'dddddddd-0000-0000-0000-000000000003';
  assert visible = 0, 'a friend who is not a party must not see the trade items, saw ' || visible;

  select count(*) into visible from public.trades;
  assert visible = 1, 'alice should see exactly her one trade, saw ' || visible;
  select count(*) into visible from public.trade_items;
  assert visible = 1, 'alice should see exactly her one trade item, saw ' || visible;

  -- ownership_history: migration 9's "read own and friends'" policy has four
  -- arms; alice's three visible rows exercise three of them, the invisible row
  -- exercises none.
  --   arm 1: to_user_id = auth.uid()                       -> alice's own row (section 6)
  select count(*) into visible from public.ownership_history
   where to_user_id = '11111111-1111-1111-1111-111111111111';
  assert visible = 1, 'a user should see their own ownership_history row, saw ' || visible;
  --   arm 3: are_friends(to_user_id, auth.uid())           -> friend bob received
  select count(*) into visible from public.ownership_history
   where to_user_id = '22222222-2222-2222-2222-222222222222';
  assert visible = 1, 'a user should see an accepted friend''s inbound ownership_history row, saw ' || visible;
  --   arm 4: from_user_id is not null and are_friends(from_user_id, auth.uid())
  --          -> friend bob sent; this arm had no fixture before.
  select count(*) into visible from public.ownership_history
   where from_user_id = '22222222-2222-2222-2222-222222222222'
     and to_user_id = '55555555-5555-5555-5555-555555555555';
  assert visible = 1, 'a user should see a row where an accepted friend is the sender, saw ' || visible;
  --   no arm: a transfer between two strangers stays invisible.
  select count(*) into visible from public.ownership_history
   where from_user_id = '55555555-5555-5555-5555-555555555555'
     and to_user_id = '66666666-6666-6666-6666-666666666666';
  assert visible = 0, 'a user must not see a stranger-to-stranger ownership_history row, saw ' || visible;
  select count(*) into visible from public.ownership_history;
  assert visible = 3, 'alice should see own + friend-inbound + friend-outbound history, saw ' || visible;

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

-- --------------------------------------------------------------------------
-- 9. want_list.deck_id: must be the same user's deck, and must be a deck.
--    (migration 17)
-- --------------------------------------------------------------------------
insert into public.locations (id, user_id, name, type) values
  ('bbbbbbbb-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'Alice Deck', 'deck');

insert into public.want_list (id, user_id, card_id) values
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001');

do $$
begin
  -- Tagging to your own deck works.
  update public.want_list set deck_id = 'bbbbbbbb-0000-0000-0000-000000000004'
   where id = 'eeeeeeee-0000-0000-0000-000000000001';

  -- Tagging to someone else's location is rejected, even though it exists.
  begin
    update public.want_list set deck_id = 'bbbbbbbb-0000-0000-0000-000000000002' -- Bob's box
     where id = 'eeeeeeee-0000-0000-0000-000000000001';
    assert false, 'tagging a want to another user''s location should have been rejected';
  exception when check_violation then null;
  end;

  -- Tagging to your own location that is not a deck is rejected -- a binder
  -- tag would not mean anything.
  begin
    update public.want_list set deck_id = (
      select id from public.locations
       where user_id = '11111111-1111-1111-1111-111111111111' and name = 'Binder B'
    )
     where id = 'eeeeeeee-0000-0000-0000-000000000001';
    assert false, 'tagging a want to a binder should have been rejected';
  exception when check_violation then null;
  end;
end $$;

-- Deleting the tagged deck detags the want; it does not delete it.
do $$
declare deck_after uuid; still_there int;
begin
  delete from public.locations where id = 'bbbbbbbb-0000-0000-0000-000000000004';

  select deck_id into deck_after from public.want_list
   where id = 'eeeeeeee-0000-0000-0000-000000000001';
  assert deck_after is null, 'deleting a tagged deck should clear deck_id, not the want';

  select count(*) into still_there from public.want_list
   where id = 'eeeeeeee-0000-0000-0000-000000000001';
  assert still_there = 1, 'the want itself must survive its deck being deleted';
end $$;

-- --------------------------------------------------------------------------
-- 10. Commander is keyed on the card, not a physical copy (migration 18) --
--     nominable with zero card_instances, and cleared (not cascaded) when the
--     card goes away.
-- --------------------------------------------------------------------------
insert into public.locations (id, user_id, name, type) values
  ('bbbbbbbb-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'Commander Deck', 'deck');

-- A throwaway printing, not referenced by any card_instances/deck_cards/
-- want_list row, so it can be deleted below without hitting one of those
-- tables' ON DELETE RESTRICT.
insert into public.cards (scryfall_id, oracle_id, name, set_code, collector_number,
                          available_finishes, lang, released_at, image_uri_small)
values
  ('aaaaaaaa-0000-0000-0000-000000000004', 'ffffffff-0000-0000-0000-000000000003',
   'Atarka, World Render', 'ktk', '219', '{nonfoil}', 'en', '2014-09-26', 'https://img/4');

do $$
declare commander_after uuid;
begin
  -- A commander is nominated by naming a card directly. No card_instance for
  -- it exists anywhere in these fixtures, which is the point: this is the bug
  -- migration 18 fixes -- the old commander_instance_id could not do this.
  update public.locations set commander_card_id = 'aaaaaaaa-0000-0000-0000-000000000004'
   where id = 'bbbbbbbb-0000-0000-0000-000000000005';

  select commander_card_id into commander_after from public.locations
   where id = 'bbbbbbbb-0000-0000-0000-000000000005';
  assert commander_after = 'aaaaaaaa-0000-0000-0000-000000000004',
    'a card with no card_instance should be nominable as commander';

  -- A card id that does not exist is rejected by the FK.
  begin
    update public.locations set commander_card_id = '99999999-9999-9999-9999-999999999999'
     where id = 'bbbbbbbb-0000-0000-0000-000000000005';
    assert false, 'nominating a nonexistent card should have been rejected';
  exception when foreign_key_violation then null;
  end;
end $$;

-- Deleting the nominated card clears the nomination; the deck survives.
do $$
declare commander_after uuid; deck_still_there int;
begin
  delete from public.cards where scryfall_id = 'aaaaaaaa-0000-0000-0000-000000000004';

  select commander_card_id into commander_after from public.locations
   where id = 'bbbbbbbb-0000-0000-0000-000000000005';
  assert commander_after is null, 'deleting the commander card should clear the nomination';

  select count(*) into deck_still_there from public.locations
   where id = 'bbbbbbbb-0000-0000-0000-000000000005';
  assert deck_still_there = 1, 'the deck itself must survive its commander card being deleted';
end $$;

-- --------------------------------------------------------------------------
-- 11. The deck list reconciles by oracle id (migration 19). Filing a
--     different printing of a card already on the list bumps that entry
--     rather than adding a second one, and the entry keeps its own printing.
-- --------------------------------------------------------------------------
insert into public.locations (id, user_id, name, type) values
  ('bbbbbbbb-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'Bolt Deck', 'deck');

-- The list wants one Lightning Bolt, drawn as the LEA printing (...0001).
insert into public.deck_cards (deck_id, card_id, quantity) values
  ('bbbbbbbb-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000001', 1);

do $$
declare entry_count int; entry_printing uuid; entry_qty int;
begin
  -- Sleeve a *different* printing (M10, ...0002) of the same card.
  insert into public.card_instances
    (owner_user_id, card_id, location_id, condition, finish, language, quantity)
  values
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002',
     'bbbbbbbb-0000-0000-0000-000000000006', 'NM', 'nonfoil', 'en', 1);

  select count(*) into entry_count
    from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000006';
  assert entry_count = 1,
    'filing a sibling printing must not add a second list entry (got ' || entry_count || ')';

  select card_id, quantity into entry_printing, entry_qty
    from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000006';
  assert entry_printing = 'aaaaaaaa-0000-0000-0000-000000000001',
    'the entry must keep the printing it already named';
  assert entry_qty = 1, 'one copy sleeved against a want of one leaves quantity 1';
end $$;

do $$
declare entry_count int; entry_qty int;
begin
  -- A second sibling copy: still one entry, quantity rises to cover it.
  insert into public.card_instances
    (owner_user_id, card_id, location_id, condition, finish, language, quantity)
  values
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002',
     'bbbbbbbb-0000-0000-0000-000000000006', 'LP', 'nonfoil', 'en', 1);

  select count(*) into entry_count
    from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000006';
  assert entry_count = 1, 'still one entry after a second sibling copy';

  select quantity into entry_qty
    from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000006';
  assert entry_qty = 2,
    'quantity should rise to cover 2 sleeved copies (got ' || entry_qty || ')';
end $$;

do $$
declare entry_count int;
begin
  -- A card with no list entry yet: the first copy filed creates one.
  insert into public.card_instances
    (owner_user_id, card_id, location_id, condition, finish, language, quantity)
  values
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003',
     'bbbbbbbb-0000-0000-0000-000000000006', 'NM', 'nonfoil', 'en', 1);

  select count(*) into entry_count
    from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000006'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000003';

  assert entry_count = 1, 'filing a card with no list entry should create exactly one';
end $$;

rollback;

\echo 'schema_test.sql: all assertions passed'
