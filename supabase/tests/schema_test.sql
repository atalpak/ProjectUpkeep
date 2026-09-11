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

-- A Universes Beyond crossover printing: the real card is "Spark Double", but
-- Marvel Super Heroes Commander prints it as "Loki's Double" (migration 26).
insert into public.cards (scryfall_id, oracle_id, name, flavor_name, set_code,
                          collector_number, available_finishes, lang, released_at,
                          image_uri_small)
values
  ('aaaaaaaa-0000-0000-0000-000000000005', 'ffffffff-0000-0000-0000-000000000004',
   'Spark Double', 'Loki''s Double', 'msc', '279', '{nonfoil}', 'en', '2026-01-01', 'https://img/5');

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

-- Searching the printed flavor name ("Loki's Double") must find the card
-- whose real name and rules text are "Spark Double" (migration 26) — the
-- same search a person types when adding a card from the physical printing
-- in their hand, which shows the flavor name, not the game name.
do $$
declare found_name text;
begin
  select name into found_name from public.search_card_names('Loki''s Double', 10);
  assert found_name = 'Spark Double',
    'searching a printed flavor name should surface its real card, got: '
      || coalesce(found_name, '<null>');
end $$;

-- The suggestion itself must also carry the printed name (migration 28) — the
-- dropdown found the right card above, but showing "Spark Double" for
-- something someone typed as "Loki's Double" is its own confusion.
do $$
declare found_flavor text;
begin
  select sample_flavor_name into found_flavor
    from public.search_card_names('Spark Double', 10);
  assert found_flavor = 'Loki''s Double',
    'the suggestion should carry the printed flavor name, got: '
      || coalesce(found_flavor, '<null>');
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
  assert visible = 4, 'cards should be readable by any authenticated user';

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

-- ---------------------------------------------------------------------------
-- trade_items survives its card_instance being deleted (migration 25).
--
-- card_instance_id used to be ON DELETE RESTRICT, so deleting an instance
-- that had ever been part of any trade -- open, declined, or completed years
-- ago -- failed outright. accept_trade() already checks existence itself and
-- migration 23 snapshots card_id/finish precisely so history reads without a
-- live instance, so the RESTRICT was pure friction with nothing depending on
-- it. Deleting should now succeed and simply null out the reference.
-- ---------------------------------------------------------------------------
do $$
declare remaining int; ref_after uuid;
begin
  delete from public.card_instances where id = 'cccccccc-0000-0000-0000-000000000003';

  select count(*) into remaining from public.card_instances
   where id = 'cccccccc-0000-0000-0000-000000000003';
  assert remaining = 0, 'the card_instance should actually be gone';

  select card_instance_id into ref_after from public.trade_items
   where trade_id = 'dddddddd-0000-0000-0000-000000000002';
  assert ref_after is null,
    'deleting a traded card_instance should null the trade_item reference, not block the delete';
end $$;

-- ---------------------------------------------------------------------------
-- collection_entries must not be a hole through RLS.
--
-- A view without security_invoker runs as its owner, which would hand every
-- user's cards to anyone who selected from it. This is the assertion that
-- catches that, because nothing else would: the view looks correct either way
-- until someone else's rows show up in it.
-- ---------------------------------------------------------------------------
do $$
declare
  invoker  boolean;
  mine     int;
  theirs   int;
begin
  select coalesce((
    select option_value = 'true'
      from pg_options_to_table((select reloptions from pg_class where relname = 'collection_entries'))
     where option_name = 'security_invoker'
  ), false) into invoker;

  assert invoker, 'collection_entries must be declared with security_invoker = true';

  -- As user one: their own rows are visible, and only theirs.
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;

  select count(*) into mine
    from public.collection_entries
   where owner_user_id = '11111111-1111-1111-1111-111111111111';

  select count(*) into theirs
    from public.collection_entries
   where owner_user_id <> '11111111-1111-1111-1111-111111111111';

  reset role;

  assert mine > 0, 'the view should return the caller''s own rows, got ' || mine;
  assert theirs = 0,
    'collection_entries leaked ' || theirs || ' rows belonging to another user';
end $$;

-- --------------------------------------------------------------------------
-- 12. The deck list survives one card listed under two printings
--     (migration 20 -- the bug that grew a 100-card deck to 114).
--
-- Section 11 above exercises a single list entry, and every case it covers
-- gives the same answer under migration 20's rule and migration 19's broken
-- one -- so it cannot tell them apart. The corruption needs TWO entries
-- sharing an oracle id: 14 of one Forest art and 6 of another. Migration 19
-- set the *oldest* entry to the full physical count and left its sibling
-- alone, so the list totalled 26 for 20 cards, and every later sleeve
-- inflated it further.
--
-- If this section ever passes with the migration 19 rule restored, it has
-- stopped doing its job.
-- --------------------------------------------------------------------------
insert into public.locations (id, user_id, name, type) values
  ('bbbbbbbb-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   'Two-Art Bolts', 'deck');

-- One card (oracle ffffffff-...0001) listed under two printings on purpose:
-- 14 of the LEA art, 6 of the M10 art. Twenty cards, two entries.
insert into public.deck_cards (deck_id, card_id, quantity) values
  ('bbbbbbbb-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000001', 14),
  ('bbbbbbbb-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000002', 6);

do $$
declare entries int; total int; lea_qty int; m10_qty int;
begin
  -- Sleeve exactly what the list asks for, in two goes.
  insert into public.card_instances
    (owner_user_id, card_id, location_id, condition, finish, language, quantity)
  values
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
     'bbbbbbbb-0000-0000-0000-000000000007', 'NM', 'nonfoil', 'en', 14);

  insert into public.card_instances
    (owner_user_id, card_id, location_id, condition, finish, language, quantity)
  values
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002',
     'bbbbbbbb-0000-0000-0000-000000000007', 'NM', 'nonfoil', 'en', 6);

  select count(*), coalesce(sum(quantity), 0) into entries, total
    from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000007';

  assert entries = 2,
    'both per-printing entries must survive being sleeved (got ' || entries || ')';
  assert total = 20,
    'sleeving exactly the 20 listed copies must leave the list at 20, not inflate it '
    || '(got ' || total || ') -- this is the migration 19 bug';

  select quantity into lea_qty from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000007'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select quantity into m10_qty from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000007'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000002';

  assert lea_qty = 14, 'the LEA entry must keep its own 14 (got ' || lea_qty || ')';
  assert m10_qty = 6,  'the M10 entry must keep its own 6 (got '  || m10_qty || ')';
end $$;

do $$
declare total int; lea_qty int; m10_qty int;
begin
  -- Over-sleeve by one, in the M10 art. Only the shortfall is added, and it
  -- lands on the entry naming that exact printing rather than the oldest one.
  insert into public.card_instances
    (owner_user_id, card_id, location_id, condition, finish, language, quantity)
  values
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002',
     'bbbbbbbb-0000-0000-0000-000000000007', 'LP', 'nonfoil', 'en', 1);

  select coalesce(sum(quantity), 0) into total
    from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000007';

  select quantity into lea_qty from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000007'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select quantity into m10_qty from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000007'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000002';

  assert total = 21,
    'one copy over the list should add exactly one (got ' || total || ')';
  assert m10_qty = 7,
    'the shortfall belongs to the entry naming that printing (got ' || m10_qty || ')';
  assert lea_qty = 14,
    'the other printing''s entry must not move (got ' || lea_qty || ')';
end $$;

-- --------------------------------------------------------------------------
-- 13. accept_trade() actually transfers (migrations 9 -> 12 -> 13).
--
-- Section 8 asserts that a *client* cannot settle a trade. Nothing asserted
-- that the function which can, does. It is the only path in the schema that
-- moves ownership, it has been rewritten three times, and ownership_history
-- rejects UPDATE and DELETE -- so a bug here writes a permanently wrong
-- record. Covered below: the whole-stack move, the partial split, the audit
-- rows, the status change, and the three refusals.
-- --------------------------------------------------------------------------
-- Fresh containers: the fixtures from section 2 are deleted along the way.
insert into public.locations (id, user_id, name, type) values
  ('bbbbbbbb-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   'Alice Trade Binder', 'binder'),
  ('bbbbbbbb-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222',
   'Bob Trade Box', 'box');

insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity)
values
  -- alice offers this whole stack; it is filed, to prove the transfer unfiles it
  ('cccccccc-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000008',
   'NM', 'nonfoil', 'en', 1),
  -- bob offers 1 of 3, so this one splits
  ('cccccccc-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222',
   'aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000009',
   'LP', 'nonfoil', 'en', 3),
  -- for the refusal cases
  ('cccccccc-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000003', null, 'NM', 'nonfoil', 'en', 1),
  ('cccccccc-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000003', null, 'NM', 'nonfoil', 'en', 1);

insert into public.trades (id, proposer_id, recipient_id, status, expires_at) values
  ('dddddddd-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'proposed', now() + interval '7 days'),
  ('dddddddd-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'proposed', now() + interval '7 days'),
  ('dddddddd-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'proposed', now() - interval '1 day');

insert into public.trade_items
  (trade_id, card_instance_id, direction, quantity, card_id, finish)
values
  ('dddddddd-0000-0000-0000-000000000010', 'cccccccc-0000-0000-0000-000000000010',
   'from_proposer',  1, 'aaaaaaaa-0000-0000-0000-000000000001', 'nonfoil'),
  ('dddddddd-0000-0000-0000-000000000010', 'cccccccc-0000-0000-0000-000000000011',
   'from_recipient', 1, 'aaaaaaaa-0000-0000-0000-000000000002', 'nonfoil'),
  ('dddddddd-0000-0000-0000-000000000011', 'cccccccc-0000-0000-0000-000000000012',
   'from_proposer',  1, 'aaaaaaaa-0000-0000-0000-000000000003', 'nonfoil'),
  ('dddddddd-0000-0000-0000-000000000012', 'cccccccc-0000-0000-0000-000000000013',
   'from_proposer',  1, 'aaaaaaaa-0000-0000-0000-000000000003', 'nonfoil');

-- The recipient accepts. Run as `authenticated` with bob's claim so the
-- EXECUTE grant and the auth.uid() check are both exercised for real.
do $$
begin
  perform set_config('request.jwt.claim.sub',
                     '22222222-2222-2222-2222-222222222222', true);
  set local role authenticated;
  perform public.accept_trade('dddddddd-0000-0000-0000-000000000010');
  reset role;
end $$;

do $$
declare
  moved      public.card_instances;
  remainder  public.card_instances;
  received   public.card_instances;
  new_id     uuid;
  hist_rows  int;
  final      text;
begin
  -- (a) The whole stack moved: new owner, and unfiled. This is hard
  --     constraint 6 -- ownership and location stay decoupled -- observed on
  --     the one statement that actually performs a transfer.
  select * into moved from public.card_instances
   where id = 'cccccccc-0000-0000-0000-000000000010';
  assert moved.owner_user_id = '22222222-2222-2222-2222-222222222222',
    'a whole-stack trade must change the owner';
  assert moved.location_id is null,
    'a transferred card must be unfiled -- it is not in the sender''s binder any more';
  assert moved.quantity = 1, 'the whole stack moves intact';

  -- (b) The partial stack split: sender keeps the remainder, in place.
  select * into remainder from public.card_instances
   where id = 'cccccccc-0000-0000-0000-000000000011';
  assert remainder.owner_user_id = '22222222-2222-2222-2222-222222222222',
    'the sender keeps the remainder of a split stack';
  assert remainder.quantity = 2,
    'offering 1 of 3 must leave 2 behind (got ' || remainder.quantity || ')';
  assert remainder.location_id = 'bbbbbbbb-0000-0000-0000-000000000009',
    'the remainder stays where it was filed';

  -- (c) The receiver got a new row for exactly the offered quantity, unfiled,
  --     and the audit log points at it.
  select card_instance_id into new_id from public.ownership_history
   where trade_id = 'dddddddd-0000-0000-0000-000000000010'
     and from_user_id = '22222222-2222-2222-2222-222222222222'
     and to_user_id   = '11111111-1111-1111-1111-111111111111';
  assert new_id is not null, 'the split half must be recorded in ownership_history';

  select * into received from public.card_instances where id = new_id;
  assert received.owner_user_id = '11111111-1111-1111-1111-111111111111',
    'the split half belongs to the receiver';
  assert received.quantity = 1,
    'the receiver gets exactly what was offered (got ' || received.quantity || ')';
  assert received.location_id is null, 'a received card arrives unfiled';
  assert received.card_id = 'aaaaaaaa-0000-0000-0000-000000000002',
    'the split half keeps the printing it was';
  assert received.id <> 'cccccccc-0000-0000-0000-000000000011',
    'a split must create a new row, not rename the sender''s';

  -- (d) One audit row per leg, and no more.
  select count(*) into hist_rows from public.ownership_history
   where trade_id = 'dddddddd-0000-0000-0000-000000000010';
  assert hist_rows = 2,
    'a two-item trade writes exactly two history rows (got ' || hist_rows || ')';

  -- (e) The trade is settled.
  select status into final from public.trades
   where id = 'dddddddd-0000-0000-0000-000000000010';
  assert final = 'completed',
    'accept_trade must close the trade (got ' || final || ')';
end $$;

-- The refusals. Asserted on SQLSTATE, because that is what the function
-- actually raises. Worth knowing that the app does NOT read these codes:
-- acceptTrade in src/app/(app)/trades/actions.ts dispatches on substrings of
-- the exception *message* ("expired", "no longer owned", "Only the
-- recipient"). So the wording of those messages is a live contract too, and
-- rewording one in a later migration silently degrades the user-facing error
-- to a generic failure. Nothing tests that coupling; these assertions at least
-- pin the behaviour the messages describe.
do $$
begin
  perform set_config('request.jwt.claim.sub',
                     '22222222-2222-2222-2222-222222222222', true);
  set local role authenticated;
  begin
    perform public.accept_trade('dddddddd-0000-0000-0000-000000000010');
    assert false, 'accepting an already-completed trade must fail';
  exception when invalid_parameter_value then null;
  end;
  reset role;
end $$;

do $$
declare owner_after uuid; status_after text;
begin
  -- The proposer is not the recipient, so she cannot accept her own offer.
  perform set_config('request.jwt.claim.sub',
                     '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;
  begin
    perform public.accept_trade('dddddddd-0000-0000-0000-000000000011');
    assert false, 'only the recipient may accept a trade';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ...and nothing moved on the way out.
  select owner_user_id into owner_after from public.card_instances
   where id = 'cccccccc-0000-0000-0000-000000000012';
  select status into status_after from public.trades
   where id = 'dddddddd-0000-0000-0000-000000000011';
  assert owner_after = '11111111-1111-1111-1111-111111111111',
    'a refused accept must not transfer the card';
  assert status_after = 'proposed',
    'a refused accept must leave the trade open (got ' || status_after || ')';
end $$;

do $$
declare status_after text;
begin
  -- Expired offer (migration 13): expiry is a derived fact checked here, not a
  -- stored status, so a stale proposal must be refused at accept time.
  perform set_config('request.jwt.claim.sub',
                     '22222222-2222-2222-2222-222222222222', true);
  set local role authenticated;
  begin
    perform public.accept_trade('dddddddd-0000-0000-0000-000000000012');
    assert false, 'an expired trade must not be acceptable';
  exception when invalid_parameter_value then null;
  end;
  reset role;

  select status into status_after from public.trades
   where id = 'dddddddd-0000-0000-0000-000000000012';
  assert status_after = 'proposed',
    'an expired trade stays proposed rather than being rewritten (got ' || status_after || ')';
end $$;

-- Signed out entirely: no claim, no transfer.
do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role authenticated;
  begin
    perform public.accept_trade('dddddddd-0000-0000-0000-000000000011');
    assert false, 'accept_trade must refuse an anonymous caller';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

-- --------------------------------------------------------------------------
-- 14. feedback: own-row RLS, no giveaway, append-only by policy absence.
--     (migration 29)
--
-- PR1 ships the table, the own-row policies and the form. The admin inbox and
-- the SELECT policy it needs are PR2, so nothing about reading across users is
-- asserted here.
--
-- Case (e) pins the whitespace lower bound: feedback_body_length is
-- `body ~ '\S'`, not char_length(btrim(...)) >= 1, so a body of only tabs and
-- newlines is rejected rather than stored as a visually-empty row.
--
-- These fixture inserts run as the table owner with no JWT claim, so
-- auth.uid() is null and the user_id default would violate NOT NULL -- every
-- row names user_id outright.
-- --------------------------------------------------------------------------
insert into public.feedback (user_id, body, page) values
  ('11111111-1111-1111-1111-111111111111', 'Alice cannot find the import button.', '/collection'),
  ('22222222-2222-2222-2222-222222222222', 'Bob would like dark mode on the login page.', '/login');

set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

do $$
declare
  visible    int;
  body_after text;
begin
  -- (a) Alice reads her own row, and Bob's is invisible to her.
  select count(*) into visible from public.feedback;
  assert visible = 1, 'alice should see only her own feedback, saw ' || visible;
  select count(*) into visible from public.feedback
   where user_id = '22222222-2222-2222-2222-222222222222';
  assert visible = 0, 'alice must not see bob''s feedback, saw ' || visible;

  -- (b) Alice cannot file feedback as Bob. The INSERT WITH CHECK raises rather
  --     than silently dropping the row -- same shape as the card_instances
  --     giveaway in section 8.
  begin
    insert into public.feedback (user_id, body)
    values ('22222222-2222-2222-2222-222222222222', 'forged on bob''s behalf');
    assert false, 'RLS WITH CHECK should block filing feedback as another user';
  exception when insufficient_privilege then null;
  end;

  -- (c) There is no UPDATE policy, so an update matches no rows rather than
  --     erroring -- the body must be unchanged. This absence *is* the
  --     append-only mechanism (see the migration header).
  update public.feedback set body = 'edited after the fact'
   where user_id = '11111111-1111-1111-1111-111111111111';
  select body into body_after from public.feedback
   where user_id = '11111111-1111-1111-1111-111111111111';
  assert body_after = 'Alice cannot find the import button.',
    'feedback has no client UPDATE policy; the row must be unchanged (got ' || body_after || ')';

  -- (d) ...and no DELETE policy either: the delete matches nothing and the row
  --     survives.
  delete from public.feedback where user_id = '11111111-1111-1111-1111-111111111111';
  select count(*) into visible from public.feedback
   where user_id = '11111111-1111-1111-1111-111111111111';
  assert visible = 1, 'feedback has no client DELETE policy; the row must survive';

  -- (e) feedback_body_length demands a non-whitespace character. btrim() only
  --     strips spaces, so the check is `body ~ '\S'`: a body of tabs and
  --     newlines raises rather than inserting a visually-empty row. Alice's
  --     user_id defaults to auth.uid(), so the INSERT policy passes and the
  --     CHECK is what rejects this.
  begin
    insert into public.feedback (body) values (E'\t\n   \n');
    assert false, 'feedback_body_length must reject an all-whitespace body';
  exception when check_violation then null;
  end;
end $$;

reset role;

-- --------------------------------------------------------------------------
-- 15. Self-service account deletion (migration 30).
--
-- This is the direct regression test for the bug that motivated the
-- migration: before it, deleting a user who had ever completed a trade
-- aborted outright (trades cascade-deleted -> ownership_history.trade_id went
-- to null as a real UPDATE -> the append-only trigger from migration 6
-- rejected it -> the whole delete rolled back). Case (a) below is exactly that
-- scenario, and it must now succeed.
--
-- Dedicated users (erin / frank / grace) rather than reusing alice / bob, so
-- deleting one of them does not reach back into every earlier section's
-- fixtures and complicate what each assertion is checking.
--
-- One limitation worth stating plainly: _shim_auth.sql stands auth.users up as
-- a plain table with no real privilege model, so everything below proves the
-- FK graph and the RPC's own logic, but it cannot prove that the function
-- owner actually holds DELETE on the real auth.users, which belongs to
-- supabase_auth_admin in a real Supabase project. That was confirmed once, by
-- hand, against the live project (select has_table_privilege('postgres',
-- 'auth.users', 'DELETE') returned true) — this suite cannot re-check it, and
-- a green run here does not mean the live grant is still in place.
-- --------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('77777777-7777-7777-7777-777777777777', 'erin@example.com',  '{"username":"erin"}'),
  ('88888888-8888-8888-8888-888888888888', 'frank@example.com', '{"username":"frank"}'),
  ('99999999-9999-9999-9999-999999999999', 'grace@example.com', '{"username":"grace"}');

insert into public.friendships (requester_id, addressee_id, status) values
  ('77777777-7777-7777-7777-777777777777', '88888888-8888-8888-8888-888888888888', 'accepted');

insert into public.locations (id, user_id, name, type) values
  ('bbbbbbbb-0000-0000-0000-000000000020', '77777777-7777-7777-7777-777777777777',
   'Erin Trade Binder', 'binder'),
  ('bbbbbbbb-0000-0000-0000-000000000021', '77777777-7777-7777-7777-777777777777',
   'Erin Cube', 'deck');

insert into public.deck_cards (deck_id, card_id, quantity) values
  ('bbbbbbbb-0000-0000-0000-000000000021', 'aaaaaaaa-0000-0000-0000-000000000002', 4);

insert into public.want_list (id, user_id, card_id) values
  ('eeeeeeee-0000-0000-0000-000000000020', '77777777-7777-7777-7777-777777777777',
   'aaaaaaaa-0000-0000-0000-000000000003');

insert into public.feedback (user_id, body) values
  ('77777777-7777-7777-7777-777777777777', 'Testing account deletion.');

-- One card erin is about to trade away, and one she keeps -- the second is
-- what proves "her own remaining copies" actually go with the account.
insert into public.card_instances (id, owner_user_id, card_id, location_id, quantity) values
  ('cccccccc-0000-0000-0000-000000000020', '77777777-7777-7777-7777-777777777777',
   'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000020', 1),
  ('cccccccc-0000-0000-0000-000000000021', '77777777-7777-7777-7777-777777777777',
   'aaaaaaaa-0000-0000-0000-000000000002', null, 1);

-- Trade 1: erin -> frank, completed. Run through accept_trade() for real
-- rather than inserted pre-completed, so the ordinary insert/accept triggers
-- fire and leave the notification this section actually checks.
insert into public.trades (id, proposer_id, recipient_id, status) values
  ('dddddddd-0000-0000-0000-000000000020', '77777777-7777-7777-7777-777777777777',
   '88888888-8888-8888-8888-888888888888', 'proposed');

insert into public.trade_items (trade_id, card_instance_id, direction, quantity, card_id, finish)
values
  ('dddddddd-0000-0000-0000-000000000020', 'cccccccc-0000-0000-0000-000000000020',
   'from_proposer', 1, 'aaaaaaaa-0000-0000-0000-000000000001', 'nonfoil');

do $$
begin
  perform set_config('request.jwt.claim.sub',
                     '88888888-8888-8888-8888-888888888888', true);
  set local role authenticated;
  perform public.accept_trade('dddddddd-0000-0000-0000-000000000020');
  reset role;
end $$;

-- Trade 2: erin proposes to grace, still open when erin deletes -- must close
-- as 'cancelled' (erin is the proposer), and grace must be told.
insert into public.trades (id, proposer_id, recipient_id, status) values
  ('dddddddd-0000-0000-0000-000000000021', '77777777-7777-7777-7777-777777777777',
   '99999999-9999-9999-9999-999999999999', 'proposed');

-- Trade 3: frank proposes to erin, still open when erin deletes -- must close
-- as 'declined' (erin is the recipient), and frank must be told.
insert into public.trades (id, proposer_id, recipient_id, status) values
  ('dddddddd-0000-0000-0000-000000000022', '88888888-8888-8888-8888-888888888888',
   '77777777-7777-7777-7777-777777777777', 'proposed');

-- (b) A confirm_username that does not match erin's own must refuse, and
--     must not touch anything -- proved by re-reading her profile afterwards.
do $$
declare still_there int;
begin
  perform set_config('request.jwt.claim.sub',
                     '77777777-7777-7777-7777-777777777777', true);
  set local role authenticated;
  begin
    perform public.delete_own_account('not-erin');
    assert false, 'a wrong confirm_username must refuse the deletion';
  exception when invalid_parameter_value then null;
  end;
  reset role;

  select count(*) into still_there from public.profiles
   where id = '77777777-7777-7777-7777-777777777777';
  assert still_there = 1, 'a refused deletion must not touch the account';
end $$;

-- (c) An anonymous caller must be refused outright.
do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role authenticated;
  begin
    perform public.delete_own_account('erin');
    assert false, 'delete_own_account must refuse an anonymous caller';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

-- (a) The real deletion. This is the direct regression case: erin has a
--     completed trade (dddddddd-...020) behind her, which is exactly the
--     shape that used to roll the whole delete back.
do $$
begin
  perform set_config('request.jwt.claim.sub',
                     '77777777-7777-7777-7777-777777777777', true);
  set local role authenticated;
  perform public.delete_own_account('erin');
  reset role;
end $$;

do $$
declare
  n              int;
  card_owner     uuid;
  card_location  uuid;
  t1_status      text; t1_proposer uuid; t1_recipient uuid;
  t2_status      text; t2_proposer uuid; t2_recipient uuid;
  t3_status      text; t3_proposer uuid; t3_recipient uuid;
  proposed_actor uuid;
  cancel_actor   uuid;
  decline_actor  uuid;
begin
  -- erin herself: gone.
  select count(*) into n from public.profiles
   where id = '77777777-7777-7777-7777-777777777777';
  assert n = 0, 'the deleted user''s profile must be gone';

  select count(*) into n from public.locations
   where user_id = '77777777-7777-7777-7777-777777777777';
  assert n = 0, 'the deleted user''s locations must be gone';

  select count(*) into n from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000021';
  assert n = 0, 'deck_cards must go with the deck it belonged to';

  select count(*) into n from public.want_list
   where user_id = '77777777-7777-7777-7777-777777777777';
  assert n = 0, 'the deleted user''s want list must be gone';

  select count(*) into n from public.friendships
   where requester_id = '77777777-7777-7777-7777-777777777777'
      or addressee_id = '77777777-7777-7777-7777-777777777777';
  assert n = 0, 'the deleted user''s friendships must be gone';

  select count(*) into n from public.feedback
   where user_id = '77777777-7777-7777-7777-777777777777';
  assert n = 0, 'the deleted user''s feedback must be gone';

  -- Her own remaining copy -- never part of any trade -- is gone too.
  select count(*) into n from public.card_instances
   where id = 'cccccccc-0000-0000-0000-000000000021';
  assert n = 0, 'the deleted user''s remaining card_instances must be gone';

  -- (item 3) The card she traded away still exists, still frank's. Ownership
  -- and location are bare columns (hard constraint 6), so this falls out of
  -- the FK graph rather than needing special-case logic anywhere.
  select owner_user_id, location_id into card_owner, card_location
    from public.card_instances where id = 'cccccccc-0000-0000-0000-000000000020';
  assert card_owner = '88888888-8888-8888-8888-888888888888',
    'a card traded away before deletion must still belong to the friend who received it';
  assert card_location is null, 'the transferred card stays unfiled, as accept_trade left it';

  -- (item 4) The completed trade survives, frank's side intact, erin's nulled.
  select status, proposer_id, recipient_id into t1_status, t1_proposer, t1_recipient
    from public.trades where id = 'dddddddd-0000-0000-0000-000000000020';
  assert t1_status = 'completed', 'a completed trade must survive account deletion';
  assert t1_proposer is null, 'the departed party''s id on a surviving trade must be null';
  assert t1_recipient = '88888888-8888-8888-8888-888888888888',
    'the surviving party''s id on that trade must be untouched';

  -- The notification frank got when erin proposed the trade survives too,
  -- with actor_id null -- matching migration 14's own comment on that column.
  -- Existence is checked explicitly first: `select into` on zero rows leaves
  -- the variable at its default null, which would make a missing notification
  -- pass the same assertion as a surviving one with actor_id cleared.
  select count(*) into n from public.notifications
   where trade_id = 'dddddddd-0000-0000-0000-000000000020'
     and user_id = '88888888-8888-8888-8888-888888888888'
     and type = 'trade_proposed';
  assert n = 1, 'frank''s notification of the original proposal must survive';

  select actor_id into proposed_actor from public.notifications
   where trade_id = 'dddddddd-0000-0000-0000-000000000020'
     and user_id = '88888888-8888-8888-8888-888888888888'
     and type = 'trade_proposed';
  assert proposed_actor is null,
    'a surviving notification''s actor_id must be null once the actor''s account is gone';

  -- (item 5, sent side) erin was the proposer of an open trade -> cancelled,
  -- and grace -- who receives that news -- is still named on it.
  select status, proposer_id, recipient_id into t2_status, t2_proposer, t2_recipient
    from public.trades where id = 'dddddddd-0000-0000-0000-000000000021';
  assert t2_status = 'cancelled',
    'an open trade erin proposed must close as cancelled, not be left dangling';
  assert t2_proposer is null, 'erin''s id on it must be null';
  assert t2_recipient = '99999999-9999-9999-9999-999999999999',
    'grace''s id on it must be untouched';

  select count(*) into n from public.notifications
   where trade_id = 'dddddddd-0000-0000-0000-000000000021'
     and user_id = '99999999-9999-9999-9999-999999999999'
     and type = 'trade_cancelled';
  assert n = 1, 'grace must have been notified that erin cancelled';

  select actor_id into cancel_actor from public.notifications
   where trade_id = 'dddddddd-0000-0000-0000-000000000021'
     and user_id = '99999999-9999-9999-9999-999999999999'
     and type = 'trade_cancelled';
  assert cancel_actor is null, 'grace''s cancellation notice must survive with actor_id null';

  -- (item 5, received side) erin was the recipient of an open trade ->
  -- declined, and frank -- who receives that news -- is still named on it.
  select status, proposer_id, recipient_id into t3_status, t3_proposer, t3_recipient
    from public.trades where id = 'dddddddd-0000-0000-0000-000000000022';
  assert t3_status = 'declined',
    'an open trade erin received must close as declined, not be left dangling';
  assert t3_recipient is null, 'erin''s id on it must be null';
  assert t3_proposer = '88888888-8888-8888-8888-888888888888',
    'frank''s id on it must be untouched';

  select count(*) into n from public.notifications
   where trade_id = 'dddddddd-0000-0000-0000-000000000022'
     and user_id = '88888888-8888-8888-8888-888888888888'
     and type = 'trade_declined';
  assert n = 1, 'frank must have been notified that erin declined';

  select actor_id into decline_actor from public.notifications
   where trade_id = 'dddddddd-0000-0000-0000-000000000022'
     and user_id = '88888888-8888-8888-8888-888888888888'
     and type = 'trade_declined';
  assert decline_actor is null, 'frank''s decline notice must survive with actor_id null';
end $$;

rollback;

\echo 'schema_test.sql: all assertions passed'
