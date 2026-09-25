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

-- --------------------------------------------------------------------------
-- 16. Deck visibility: a public deck shares its list, never its cards
--     (migration 35).
--
-- Alice gets two decks: one public, one private, each with a list entry and
-- one physical copy sleeved into it. Bob is already alice's accepted friend
-- (section 8); carol (55555555...) exists and is a stranger to alice, so she
-- covers the "not a friend at all" case without new fixtures.
--
-- The critical assertion is the card_instances negative: bob must see the
-- public deck's `locations` row and its `deck_cards`, but not the
-- card_instances row sleeved inside it. That boundary is the entire point of
-- the migration, and per this project's standing rule it was proved capable of
-- failing before being trusted, twice, against a real Postgres:
--
--   * commenting out the `is_public` guard on the "locations: read friends'
--     public decks" policy made bob see alice's *private* deck's `locations`
--     row too, and assertion (a) below caught it with "saw 1"; restoring the
--     guard turned the suite green again. (Dropping the same guard from the
--     deck_cards policy alone changes nothing, because that policy's EXISTS
--     subquery over `locations` is itself filtered by `locations`' own RLS —
--     the same defense-in-depth migration 10 already documents.)
--   * temporarily adding the exact policy this migration deliberately does
--     NOT add — a card_instances SELECT policy keyed on
--     `is_public and type = 'deck' and are_friends(...)`, the tradable-binder
--     shape from migration 9 applied to decks instead — made bob see the
--     sleeved card, and assertion (c) below caught it with "saw 1"; removing
--     that policy again turned the suite green.
-- --------------------------------------------------------------------------
insert into public.locations (id, user_id, name, type, is_public) values
  ('bbbbbbbb-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
   'Alice''s Public Deck', 'deck', true),
  ('bbbbbbbb-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111',
   'Alice''s Private Deck', 'deck', false);

insert into public.deck_cards (deck_id, card_id, quantity) values
  ('bbbbbbbb-0000-0000-0000-000000000010', 'aaaaaaaa-0000-0000-0000-000000000001', 4),
  ('bbbbbbbb-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-000000000001', 4);

-- One physical copy sleeved into the public deck. If a friend could ever read
-- this through the deck being public, that would be the leak migration 35
-- exists to prevent.
insert into public.card_instances (id, owner_user_id, card_id, location_id) values
  ('cccccccc-0000-0000-0000-000000000030', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000010');

set local role authenticated;
set local "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222'; -- bob, alice's friend

do $$
declare visible int;
begin
  -- (a) bob sees the public deck's locations row, not the private one's.
  select count(*) into visible from public.locations
   where id = 'bbbbbbbb-0000-0000-0000-000000000010';
  assert visible = 1, 'a friend should see a public deck''s locations row, saw ' || visible;
  select count(*) into visible from public.locations
   where id = 'bbbbbbbb-0000-0000-0000-000000000011';
  assert visible = 0, 'a friend must not see a private deck''s locations row, saw ' || visible;

  -- (b) same split for deck_cards.
  select count(*) into visible from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000010';
  assert visible = 1, 'a friend should see a public deck''s deck_cards, saw ' || visible;
  select count(*) into visible from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000011';
  assert visible = 0, 'a friend must not see a private deck''s deck_cards, saw ' || visible;

  -- (c) THE critical negative: card_instances stays invisible even though the
  --     deck holding it is public. Sharing a decklist is not sharing the
  --     physical cards.
  select count(*) into visible from public.card_instances
   where id = 'cccccccc-0000-0000-0000-000000000030';
  assert visible = 0,
    'a friend must not see card_instances sleeved in a public deck, saw ' || visible;

  -- (d) a friend cannot write to a public deck's list either -- read-only
  --     sharing, not co-editing. No INSERT/UPDATE/DELETE policy grants this to
  --     anyone but the owner (migration 10), and migration 35 adds no write
  --     policy at all.
  begin
    insert into public.deck_cards (deck_id, card_id, quantity)
    values ('bbbbbbbb-0000-0000-0000-000000000010', 'aaaaaaaa-0000-0000-0000-000000000002', 1);
    assert false, 'a friend must not be able to insert into a public deck''s list';
  exception when insufficient_privilege then null;
  end;

  update public.deck_cards set quantity = 99
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000010';
  select quantity into visible from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000010';
  assert visible = 4, 'deck_cards has no friend UPDATE policy; the row must be unchanged, saw ' || visible;

  delete from public.deck_cards where deck_id = 'bbbbbbbb-0000-0000-0000-000000000010';
  select count(*) into visible from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000010';
  assert visible = 1, 'deck_cards has no friend DELETE policy; the row must survive, saw ' || visible;
end $$;

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555'; -- carol, a stranger to alice

do $$
declare visible int;
begin
  -- (e) a stranger sees neither deck, nor either one's list.
  select count(*) into visible from public.locations
   where id in ('bbbbbbbb-0000-0000-0000-000000000010', 'bbbbbbbb-0000-0000-0000-000000000011');
  assert visible = 0, 'a stranger must not see either of alice''s decks, saw ' || visible;

  select count(*) into visible from public.deck_cards
   where deck_id in ('bbbbbbbb-0000-0000-0000-000000000010', 'bbbbbbbb-0000-0000-0000-000000000011');
  assert visible = 0, 'a stranger must not see either deck''s list, saw ' || visible;
end $$;

reset role;

-- --------------------------------------------------------------------------
-- 14. apply_stack_addition() (migration 36): atomic, idempotent stack merges.
--
-- Fresh users and fixtures, deliberately isolated from every section above —
-- alice/bob's rows have been mutated by tests along the way, and this section
-- should not depend on their state at this point in the file.
-- --------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('e0000000-0000-0000-0000-000000000001', 'uma@example.com',    '{"username":"uma"}'),
  ('e0000000-0000-0000-0000-000000000002', 'victor@example.com', '{"username":"victor"}');

insert into public.friendships (requester_id, addressee_id, status) values
  ('e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'accepted');

insert into public.locations (id, user_id, name, type, is_tradable) values
  ('e1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Uma Box', 'box', false),
  ('e1000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 'Uma Trade Binder', 'binder', true),
  ('e1000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000001', 'Uma Other Box', 'box', false);

-- instance 1: an ordinary, non-tradable stack uma will merge into repeatedly.
-- instance 2: sits in uma's tradable binder, so migration 9 makes it
-- genuinely readable by an accepted friend — the case section 5 below needs.
insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity) values
  ('e2000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'NM', 'nonfoil', 'en', 3),
  ('e2000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002',
   'NM', 'nonfoil', 'en', 5);

set local role authenticated;
set local "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000001'; -- uma

do $$
declare
  r_result   record;
  v_qty      integer;
  v_owner    uuid;
  v_location uuid;
begin
  -- (1) Two calls with the same operation id and the same fingerprint add the
  -- quantity once, not twice: the first actually merges (3 + 2 = 5)...
  select * into r_result from public.apply_stack_addition(
    'e4000000-0000-0000-0000-000000000001'::uuid, 'e2000000-0000-0000-0000-000000000001'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'NM', 'nonfoil', 'en',
    'e1000000-0000-0000-0000-000000000001'::uuid, 2, null);
  assert r_result.result_quantity = 5 and r_result.replayed = false,
    'first apply should merge 3+2=5 and not be a replay, got quantity ' ||
    r_result.result_quantity || ', replayed ' || r_result.replayed::text;

  -- ...and the retry with the identical id and payload returns the recorded
  -- result instead of merging again.
  select * into r_result from public.apply_stack_addition(
    'e4000000-0000-0000-0000-000000000001'::uuid, 'e2000000-0000-0000-0000-000000000001'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'NM', 'nonfoil', 'en',
    'e1000000-0000-0000-0000-000000000001'::uuid, 2, null);
  assert r_result.result_quantity = 5 and r_result.replayed = true,
    'a replay of the same operation id and payload must return the recorded ' ||
    'result, not re-apply — got quantity ' || r_result.result_quantity ||
    ', replayed ' || r_result.replayed::text;

  -- (2) A replay with a different fingerprint/payload is rejected outright.
  begin
    perform public.apply_stack_addition(
      'e4000000-0000-0000-0000-000000000001'::uuid, 'e2000000-0000-0000-0000-000000000001'::uuid,
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'NM', 'nonfoil', 'en',
      'e1000000-0000-0000-0000-000000000001'::uuid, 99, null);
    assert false, 'a replay with a different payload must be rejected';
  exception when invalid_parameter_value then null;
  end;

  select quantity into v_qty from public.card_instances
   where id = 'e2000000-0000-0000-0000-000000000001';
  assert v_qty = 5, 'a rejected mismatched replay must not change the row, saw ' || v_qty;

  -- (3) The merge is additive under a stale read, not absolute: two further
  -- decided additions, each with its own operation id, applied one after the
  -- other, land at 5 -> 7 -> 9 — never an overwrite of a precomputed total.
  -- This is a stand-in for genuine concurrent sessions, which psql cannot
  -- easily express within a single script; the real guarantee is the atomic
  -- `quantity = quantity + p_quantity ... for update` in migration 36, which
  -- this only exercises sequentially.
  select * into r_result from public.apply_stack_addition(
    'e4000000-0000-0000-0000-000000000002'::uuid, 'e2000000-0000-0000-0000-000000000001'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'NM', 'nonfoil', 'en',
    'e1000000-0000-0000-0000-000000000001'::uuid, 2, null);
  assert r_result.result_quantity = 7,
    'second decided addition should be additive (5+2=7), got ' || r_result.result_quantity;

  select * into r_result from public.apply_stack_addition(
    'e4000000-0000-0000-0000-000000000003'::uuid, 'e2000000-0000-0000-0000-000000000001'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'NM', 'nonfoil', 'en',
    'e1000000-0000-0000-0000-000000000001'::uuid, 2, null);
  assert r_result.result_quantity = 9,
    'third decided addition should be additive (7+2=9), got ' || r_result.result_quantity;

  -- (7) Only quantity moved. Owner and location are exactly what they were
  -- before any of this ran — hard constraint 6, restated for this write path.
  select owner_user_id, location_id, quantity into v_owner, v_location, v_qty
    from public.card_instances where id = 'e2000000-0000-0000-0000-000000000001';
  assert v_owner = 'e0000000-0000-0000-0000-000000000001'
     and v_location = 'e1000000-0000-0000-0000-000000000001'
     and v_qty = 9,
    'a merge must only move quantity; owner_user_id/location_id must be unchanged';

  -- (4) A stale target — the row moved location since the decision was made,
  -- the same as an edit or a different move happening in between — is
  -- refused, not silently merged into whatever moved there or merged as if
  -- nothing changed.
  update public.card_instances set location_id = 'e1000000-0000-0000-0000-000000000003'
   where id = 'e2000000-0000-0000-0000-000000000001';

  begin
    perform public.apply_stack_addition(
      'e4000000-0000-0000-0000-000000000004'::uuid, 'e2000000-0000-0000-0000-000000000001'::uuid,
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'NM', 'nonfoil', 'en',
      'e1000000-0000-0000-0000-000000000001'::uuid, -- stale: the row is no longer here
      2, null);
    assert false, 'a stale target (moved since the decision) must be refused';
  exception when no_data_found then null;
  end;

  select quantity into v_qty from public.card_instances
   where id = 'e2000000-0000-0000-0000-000000000001';
  assert v_qty = 9, 'a refused stale-target call must not change the row, saw ' || v_qty;
end $$;

reset role;

-- (5) Cross-user refusal, including the case migration 9 makes genuinely
-- readable: victor is uma's accepted friend, and the target instance sits in
-- a location uma marked tradable, so victor can SELECT it via the "card_
-- instances: read friends' tradable" policy (migration 9) — but
-- apply_stack_addition's owner_user_id = auth.uid() predicate must still
-- refuse to merge into it. Removing that predicate is exactly the kind of
-- "cleanup" hard constraint 3 exists to catch.
set local role authenticated;
set local "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000002'; -- victor

do $$
declare visible int;
begin
  select count(*) into visible from public.card_instances
   where id = 'e2000000-0000-0000-0000-000000000002';
  assert visible = 1,
    'victor should be able to read uma''s tradable-binder instance via migration 9''s policy, saw ' || visible;

  begin
    perform public.apply_stack_addition(
      'e4000000-0000-0000-0000-000000000005'::uuid, 'e2000000-0000-0000-0000-000000000002'::uuid,
      'aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'NM', 'nonfoil', 'en',
      'e1000000-0000-0000-0000-000000000002'::uuid, 2, null);
    assert false, 'a caller must not be able to merge into another owner''s instance, even one they can read';
  exception when no_data_found then null;
  end;
end $$;

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = 'e0000000-0000-0000-0000-000000000001'; -- uma

do $$
declare
  v_qty   integer;
  v_owner uuid;
begin
  select quantity, owner_user_id into v_qty, v_owner from public.card_instances
   where id = 'e2000000-0000-0000-0000-000000000002';
  assert v_qty = 5 and v_owner = 'e0000000-0000-0000-0000-000000000001',
    'a cross-user attempt must leave the target row untouched, saw quantity ' || v_qty;

  -- (6) The ledger row cannot be rewritten once its result is recorded, even
  -- by the account that owns it — ownership_history-style append-only
  -- discipline (migration 6), narrowed here to the one legitimate write
  -- (recording the result) that this table's own function needs to make.
  begin
    update public.collection_write_ops set result_quantity = 999999
     where id = 'e4000000-0000-0000-0000-000000000001';
    assert false, 'a recorded ledger result must not be rewritable';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- --------------------------------------------------------------------------
-- 17. The deck-list trigger also fires on a plain quantity change (migration
--     37), not just insert or a location move.
--
-- Fresh fixtures, isolated from every section above. Mirrors section 12's
-- two-printings setup (14 of one Forest art, 6 of another) because that is
-- the shape that told migration 19's broken rule apart from migration 20's
-- fix -- a single-entry case gives the same answer either way and proves
-- nothing here either.
--
-- Falsified by temporarily dropping card_instances_list_in_deck_on_quantity_
-- change and confirming the total wrongly stays at 20 -- see this migration's
-- own do-block comment below for how that was checked.
-- --------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000000-0000-0000-0000-000000000001', 'walt@example.com', '{"username":"walt"}');

insert into public.locations (id, user_id, name, type) values
  ('d1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'Walt Two-Art Bolts', 'deck');

insert into public.deck_cards (deck_id, card_id, quantity) values
  ('d1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 14),
  ('d1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 6);

insert into public.card_instances (id, owner_user_id, card_id, location_id, condition, finish, language, quantity)
values
  ('d2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001',
   'NM', 'nonfoil', 'en', 14),
  ('d2000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001',
   'NM', 'nonfoil', 'en', 6);

do $$
declare total int; lea_qty int; m10_qty int;
begin
  -- Sanity: the fixture above sleeved exactly what the list already asked
  -- for, so nothing should have inflated yet (this is section 12's own
  -- assertion, repeated here only as a precondition for what follows).
  select coalesce(sum(quantity), 0) into total from public.deck_cards
   where deck_id = 'd1000000-0000-0000-0000-000000000001';
  assert total = 20, 'fixture precondition: list should start at 20, got ' || total;

  -- The case migration 16/19's triggers could never see: a pure quantity
  -- increment on a row that is already sitting in the deck -- no insert, no
  -- location_id change. This is exactly what apply_stack_move's merge branch
  -- does when sleeving into an already-sleeved stack.
  update public.card_instances
     set quantity = quantity + 1
   where id = 'd2000000-0000-0000-0000-000000000001';

  select coalesce(sum(quantity), 0) into total from public.deck_cards
   where deck_id = 'd1000000-0000-0000-0000-000000000001';
  assert total = 21,
    'a quantity-only sleeve must still grow the list -- this is the gap migration 37 closes '
    || '(got ' || total || ')';

  select quantity into lea_qty from public.deck_cards
   where deck_id = 'd1000000-0000-0000-0000-000000000001'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select quantity into m10_qty from public.deck_cards
   where deck_id = 'd1000000-0000-0000-0000-000000000001'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000002';

  assert lea_qty = 15, 'the shortfall belongs to the entry naming the exact printing sleeved (got ' || lea_qty || ')';
  assert m10_qty = 6,  'the other printing''s entry must not move (got ' || m10_qty || ')';
end $$;

-- This was run once by hand with the new trigger dropped, to confirm the
-- assertion above actually discriminates (per this project's standard: a
-- green run without having watched the covering case fail first is not
-- evidence). With
--   drop trigger card_instances_list_in_deck_on_quantity_change on public.card_instances;
-- run just before the do-block above, the list total assertion fails with
-- "got 20" instead of raising cleanly for an unrelated reason -- confirming
-- this section only passes because the new trigger exists, not by accident.

-- --------------------------------------------------------------------------
-- 18. apply_stack_move() (migration 38): atomic, idempotent, conservative
--     stack moves.
--
-- Fresh fixtures, isolated from every section above for the same reason
-- section 14 gives.
-- --------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('f0000000-0000-0000-0000-000000000001', 'xena@example.com', '{"username":"xena"}'),
  ('f0000000-0000-0000-0000-000000000002', 'yara@example.com', '{"username":"yara"}');

insert into public.friendships (requester_id, addressee_id, status) values
  ('f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'accepted');

insert into public.locations (id, user_id, name, type, is_tradable) values
  ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'Xena Box', 'box', false),
  ('f1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'Xena Deck', 'deck', false),
  ('f1000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 'Xena Tradable Binder', 'binder', true),
  ('f1000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000002', 'Yara Box', 'box', false);

-- instance 1: the move source, a spare stack in a plain box.
-- instance 2: an identical stack already sleeved in the deck -- the merge
--             target a decided move will land on.
-- instance 3: sits in xena's tradable binder, so migration 9 makes it
--             genuinely readable by yara (an accepted friend) -- the cross-
--             user case below needs a row that is readable but must still be
--             unmovable by anyone but its owner.
insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity) values
  ('f2000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001',
   'NM', 'nonfoil', 'en', 5),
  ('f2000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002',
   'NM', 'nonfoil', 'en', 3),
  ('f2000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000003',
   'NM', 'nonfoil', 'en', 4);

set local role authenticated;
set local "request.jwt.claim.sub" = 'f0000000-0000-0000-0000-000000000001'; -- xena

do $$
declare
  r_result    record;
  v_total     int;
  v_owner1    uuid; v_location1 uuid; v_qty1 int;
  v_owner2    uuid; v_location2 uuid; v_qty2 int;
  v_history   int;
begin
  -- Conservation, checked before any move: 5 + 3 = 8 copies of this printing,
  -- owned by xena, across every location.
  select coalesce(sum(quantity), 0) into v_total from public.card_instances
   where owner_user_id = 'f0000000-0000-0000-0000-000000000001'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert v_total = 8, 'fixture precondition: 8 total copies expected, got ' || v_total;

  -- (1) A decided merge: move 2 from the box (instance 1) into the deck's
  -- already-sleeved stack (instance 2). Additive, not an overwrite: 3 + 2 = 5.
  select * into r_result from public.apply_stack_move(
    'f4000000-0000-0000-0000-000000000001'::uuid,
    'f2000000-0000-0000-0000-000000000001'::uuid, -- source
    2,
    'f1000000-0000-0000-0000-000000000002'::uuid, -- destination: the deck
    'f2000000-0000-0000-0000-000000000002'::uuid  -- decided merge target
  );
  assert r_result.result_quantity = 5 and r_result.replayed = false,
    'merge branch should land the destination at 3+2=5, got quantity ' ||
    r_result.result_quantity || ', replayed ' || r_result.replayed::text;

  -- Conservation across the move: the total across all of xena's locations
  -- for this printing must be exactly what it was before -- 8, not 10 (the
  -- shortfall this whole function exists to prevent) and not 6 (a lost
  -- decrement would be just as bad the other way).
  select coalesce(sum(quantity), 0) into v_total from public.card_instances
   where owner_user_id = 'f0000000-0000-0000-0000-000000000001'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert v_total = 8, 'a move must conserve the total copies owned, got ' || v_total;

  -- Ownership and location stay decoupled (hard constraint 6, restated for
  -- this write path): both touched rows kept their own owner_user_id, and
  -- each row's location_id is exactly the box/deck it was already in or
  -- moved to -- nothing about ownership changed on either side of a move.
  select owner_user_id, location_id, quantity into v_owner1, v_location1, v_qty1
    from public.card_instances where id = 'f2000000-0000-0000-0000-000000000001';
  select owner_user_id, location_id, quantity into v_owner2, v_location2, v_qty2
    from public.card_instances where id = 'f2000000-0000-0000-0000-000000000002';
  assert v_owner1 = 'f0000000-0000-0000-0000-000000000001' and v_location1 = 'f1000000-0000-0000-0000-000000000001' and v_qty1 = 3,
    'the source must keep its own owner and location, only lose quantity, got owner ' || v_owner1 || ' location ' || v_location1 || ' qty ' || v_qty1;
  assert v_owner2 = 'f0000000-0000-0000-0000-000000000001' and v_location2 = 'f1000000-0000-0000-0000-000000000002' and v_qty2 = 5,
    'the destination must keep its own owner and location, only gain quantity, got owner ' || v_owner2 || ' location ' || v_location2 || ' qty ' || v_qty2;

  -- A move is not a trade: no ownership_history row exists for either row --
  -- hard constraint 7's audit log only ever records an owner_user_id change,
  -- and neither row's owner changed.
  select count(*) into v_history from public.ownership_history
   where card_instance_id in ('f2000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000002');
  assert v_history = 0, 'a move must never write to ownership_history, saw ' || v_history || ' rows';

  -- (2) Idempotent replay: the identical call again returns the recorded
  -- result rather than moving anything a second time. Conservation still
  -- holds -- if this silently re-applied, the total would rise to 10.
  select * into r_result from public.apply_stack_move(
    'f4000000-0000-0000-0000-000000000001'::uuid,
    'f2000000-0000-0000-0000-000000000001'::uuid,
    2,
    'f1000000-0000-0000-0000-000000000002'::uuid,
    'f2000000-0000-0000-0000-000000000002'::uuid
  );
  assert r_result.result_quantity = 5 and r_result.replayed = true,
    'a replay of the same operation id and payload must return the recorded result, got quantity ' ||
    r_result.result_quantity || ', replayed ' || r_result.replayed::text;

  select coalesce(sum(quantity), 0) into v_total from public.card_instances
   where owner_user_id = 'f0000000-0000-0000-0000-000000000001'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert v_total = 8, 'a replay must not move anything a second time, got total ' || v_total;

  -- (3) A replay with a different payload (here, a different quantity) under
  -- the same operation id is rejected outright, not silently re-applied with
  -- the new details.
  begin
    perform public.apply_stack_move(
      'f4000000-0000-0000-0000-000000000001'::uuid,
      'f2000000-0000-0000-0000-000000000001'::uuid,
      1,
      'f1000000-0000-0000-0000-000000000002'::uuid,
      'f2000000-0000-0000-0000-000000000002'::uuid
    );
    assert false, 'a replay with a different payload must be rejected';
  exception when invalid_parameter_value then null;
  end;

  -- (4) Stale source refused: the source row changes (here, its quantity
  -- drops below what is about to be requested) between the decision and the
  -- call. The function must raise and move nothing -- not move a partial
  -- amount, not treat it as a fresh smaller stack.
  update public.card_instances set quantity = 1
   where id = 'f2000000-0000-0000-0000-000000000001';

  begin
    perform public.apply_stack_move(
      'f4000000-0000-0000-0000-000000000002'::uuid,
      'f2000000-0000-0000-0000-000000000001'::uuid, -- stale: only 1 left, 2 requested
      2,
      'f1000000-0000-0000-0000-000000000002'::uuid,
      'f2000000-0000-0000-0000-000000000002'::uuid
    );
    assert false, 'a stale source (insufficient quantity since the decision) must be refused';
  exception when no_data_found then null;
  end;

  select quantity into v_qty1 from public.card_instances where id = 'f2000000-0000-0000-0000-000000000001';
  select quantity into v_qty2 from public.card_instances where id = 'f2000000-0000-0000-0000-000000000002';
  assert v_qty1 = 1 and v_qty2 = 5,
    'a refused stale-source call must leave both rows untouched, saw source ' || v_qty1 || ' destination ' || v_qty2;
end $$;

reset role;

-- (5) Cross-user refusal, including the case migration 9 makes genuinely
-- readable: yara is xena's accepted friend, and instance 3 sits in a location
-- xena marked tradable, so yara can SELECT it via migration 9's policy -- but
-- apply_stack_move's owner_user_id = auth.uid() predicates, on both the
-- source lock and the destination merge lookup, must still refuse to move it
-- or merge into it. This is the same "readable through RLS is not the same as
-- yours to write" case hard constraint 3 exists to catch, restated for a move.
set local role authenticated;
set local "request.jwt.claim.sub" = 'f0000000-0000-0000-0000-000000000002'; -- yara

insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity) values
  ('f2000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000004',
   'NM', 'nonfoil', 'en', 2);

do $$
declare visible int;
begin
  select count(*) into visible from public.card_instances
   where id = 'f2000000-0000-0000-0000-000000000003';
  assert visible = 1,
    'yara should be able to read xena''s tradable-binder instance via migration 9''s policy, saw ' || visible;

  -- 5a: yara tries to use xena's (readable) instance as the SOURCE of a move.
  begin
    perform public.apply_stack_move(
      'f4000000-0000-0000-0000-000000000003'::uuid,
      'f2000000-0000-0000-0000-000000000003'::uuid, -- xena's row, merely readable to yara
      1,
      'f1000000-0000-0000-0000-000000000004'::uuid, -- yara's own box
      null
    );
    assert false, 'a caller must not be able to move another owner''s instance, even one they can read';
  exception when no_data_found then null;
  end;

  -- 5b: yara tries to merge her own card into xena's (readable) instance as
  -- the decided DESTINATION target.
  begin
    perform public.apply_stack_move(
      'f4000000-0000-0000-0000-000000000004'::uuid,
      'f2000000-0000-0000-0000-000000000004'::uuid, -- yara's own row
      1,
      'f1000000-0000-0000-0000-000000000003'::uuid, -- xena's tradable binder
      'f2000000-0000-0000-0000-000000000003'::uuid  -- xena's row as the merge target
    );
    assert false, 'a caller must not be able to merge into another owner''s instance, even one they can read';
  exception when no_data_found then null;
  end;
end $$;

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = 'f0000000-0000-0000-0000-000000000001'; -- xena

do $$
declare v_qty int; v_owner uuid;
begin
  select quantity, owner_user_id into v_qty, v_owner from public.card_instances
   where id = 'f2000000-0000-0000-0000-000000000003';
  assert v_qty = 4 and v_owner = 'f0000000-0000-0000-0000-000000000001',
    'a cross-user attempt must leave the target row completely untouched, saw quantity ' || v_qty;
end $$;

-- (6) The insert branch (no decided merge target) was, until now, never
-- exercised against a real database -- every case above passes a non-null
-- p_destination_target_instance_id. Confirmed to matter, not just theoretical:
-- temporarily changing the insert's VALUES clause to `p_quantity + 1` (a
-- conservation bug that manufactures one extra copy on every fresh-destination
-- move) left the suite fully green before this case existed. This is a fresh
-- location holding no matching stack, so the destination side must insert
-- rather than merge -- and the assertion that would have caught the injected
-- bug is the before/after total, not either row's quantity in isolation.
insert into public.locations (id, user_id, name, type, is_tradable) values
  ('f1000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000001', 'Xena Empty Binder', 'binder', false);

insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity, notes) values
  ('f2000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000001',
   'LP', 'nonfoil', 'en', 3, 'signed by artist');

do $$
declare
  r_result     record;
  v_total_before int;
  v_total_after  int;
  v_source_qty   int;
  v_new_owner    uuid;
  v_new_location uuid;
  v_new_cond     text;
  v_new_finish   text;
  v_new_lang     text;
  v_new_notes    text;
begin
  select coalesce(sum(quantity), 0) into v_total_before from public.card_instances
   where owner_user_id = 'f0000000-0000-0000-0000-000000000001'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000003';
  assert v_total_before = 3, 'fixture precondition: 3 copies expected before the insert-branch move, got ' || v_total_before;

  -- Partial move to a location with nothing already there: the destination
  -- target is null, so this exercises both halves at once -- the source
  -- decrements (it keeps 1) and the destination is a fresh insert (it gets 2).
  select * into r_result from public.apply_stack_move(
    'f4000000-0000-0000-0000-000000000005'::uuid,
    'f2000000-0000-0000-0000-000000000005'::uuid, -- source
    2,
    'f1000000-0000-0000-0000-000000000005'::uuid, -- destination: the empty binder
    null                                            -- no existing matching stack there
  );
  assert r_result.result_quantity = 2 and r_result.replayed = false,
    'insert branch should create a fresh row holding the moved quantity, got quantity ' ||
    r_result.result_quantity || ', replayed ' || r_result.replayed::text;

  -- This is the assertion reviewer's injected +1 bug could not survive: total
  -- copies of this printing, owned by xena, must be exactly what they were
  -- before the move -- 3, not 4.
  select coalesce(sum(quantity), 0) into v_total_after from public.card_instances
   where owner_user_id = 'f0000000-0000-0000-0000-000000000001'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000003';
  assert v_total_after = v_total_before,
    'a fresh-destination move must conserve the total copies owned, had ' || v_total_before || ', now ' || v_total_after;

  select quantity into v_source_qty from public.card_instances
   where id = 'f2000000-0000-0000-0000-000000000005';
  assert v_source_qty = 1, 'the source must keep the un-moved remainder, saw ' || v_source_qty;

  -- The insert branch must carry over the source row's stack attributes and
  -- notes verbatim, not just its quantity.
  select owner_user_id, location_id, condition, finish, language, notes
    into v_new_owner, v_new_location, v_new_cond, v_new_finish, v_new_lang, v_new_notes
    from public.card_instances where id = r_result.result_instance_id;
  assert v_new_owner = 'f0000000-0000-0000-0000-000000000001'
     and v_new_location = 'f1000000-0000-0000-0000-000000000005'
     and v_new_cond = 'LP' and v_new_finish = 'nonfoil' and v_new_lang = 'en'
     and v_new_notes = 'signed by artist',
    'the inserted row must carry over the source''s owner, destination, condition, finish, language and notes, saw owner ' ||
    v_new_owner || ' location ' || v_new_location || ' condition ' || v_new_cond || ' finish ' || v_new_finish ||
    ' language ' || v_new_lang || ' notes ' || coalesce(v_new_notes, '<null>');
end $$;

-- (7) A stale DESTINATION target: the decided merge target's stack key
-- changes (here, its condition) between the decision and the call, the same
-- way test (4) above stales the source. Confirmed to matter, not just
-- theoretical: temporarily removing the destination re-verification `perform
-- ... for update` block left the suite fully green, because the later
-- `update ... where id = p_destination_target_instance_id and owner_user_id =
-- v_uid` only ever catches a different *owner*, not a changed stack key --
-- it would have silently merged into a row that no longer matches what was
-- decided.
insert into public.locations (id, user_id, name, type, is_tradable) values
  ('f1000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-000000000001', 'Xena Merge Box', 'box', false);

insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity) values
  ('f2000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001',
   'NM', 'nonfoil', 'en', 5),
  ('f2000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000006',
   'NM', 'nonfoil', 'en', 2);

do $$
declare
  v_total_before int;
  v_total_after  int;
  v_source_qty   int;
  v_dest_qty     int;
  v_dest_cond    text;
begin
  select coalesce(sum(quantity), 0) into v_total_before from public.card_instances
   where owner_user_id = 'f0000000-0000-0000-0000-000000000001'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000001';

  -- The decision was made when this row's condition was still 'NM', matching
  -- the source. Simulate an edit landing between the decision and the call --
  -- the same row id, now a different stack key.
  update public.card_instances set condition = 'LP'
   where id = 'f2000000-0000-0000-0000-000000000007';

  begin
    perform public.apply_stack_move(
      'f4000000-0000-0000-0000-000000000006'::uuid,
      'f2000000-0000-0000-0000-000000000006'::uuid, -- source
      3,
      'f1000000-0000-0000-0000-000000000006'::uuid, -- destination location
      'f2000000-0000-0000-0000-000000000007'::uuid  -- decided target, now stale
    );
    assert false, 'a stale destination target (stack key changed since the decision) must be refused';
  exception when no_data_found then null;
  end;

  -- The refusal must be transactional: the source must not have been
  -- decremented before the (failed) merge was attempted, and the destination
  -- must not have been merged into.
  select quantity into v_source_qty from public.card_instances
   where id = 'f2000000-0000-0000-0000-000000000006';
  select quantity, condition into v_dest_qty, v_dest_cond from public.card_instances
   where id = 'f2000000-0000-0000-0000-000000000007';
  assert v_source_qty = 5, 'a refused stale-destination call must leave the source untouched, saw ' || v_source_qty;
  assert v_dest_qty = 2 and v_dest_cond = 'LP',
    'a refused stale-destination call must leave the destination exactly as the concurrent edit left it, saw quantity ' ||
    v_dest_qty || ' condition ' || v_dest_cond;

  select coalesce(sum(quantity), 0) into v_total_after from public.card_instances
   where owner_user_id = 'f0000000-0000-0000-0000-000000000001'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert v_total_after = v_total_before,
    'a refused stale-destination call must conserve the total copies owned, had ' || v_total_before || ', now ' || v_total_after;
end $$;

reset role;

-- --------------------------------------------------------------------------
-- 19. apply_stack_reprint() (migration 39): changing which printing an owned
--     copy is, atomically -- and in an order that cannot inflate a deck list.
--
-- The hazard this section exists for: the merge branch increments a
-- destination stack's quantity, which fires
-- card_instances_list_in_deck_on_quantity_change (migration 37). If that
-- increment happens BEFORE the source row gives its copies up, the trigger
-- sees a physical total inflated by the reprinted quantity against an
-- unchanged listed total, computes a shortfall, and raises deck_cards
-- permanently -- the migration 20 corruption, reached through a new door.
--
-- Cases 1 and 2 are written to fail if the two sides are swapped. If this
-- section ever passes with the destination incremented first, it has stopped
-- doing its job. It was confirmed red that way before being allowed to pass.
--
-- Fresh fixtures, isolated from every section above for the same reason
-- sections 14 and 18 give.
-- --------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-0000-0000-000000000001', 'zara@example.com', '{"username":"zara"}'),
  ('c0000000-0000-0000-0000-000000000002', 'wren@example.com', '{"username":"wren"}');

-- The open-trade case below needs a real trade, and trades may only be
-- proposed between friends (migration 9's insert policy).
insert into public.friendships (requester_id, addressee_id, status) values
  ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'accepted');

insert into public.locations (id, user_id, name, type) values
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Merge Deck',   'deck'),
  ('c1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'Partial Deck', 'deck'),
  ('c1000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'Solo Deck',    'deck'),
  ('c1000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001', 'Zara Box',     'box');

-- Each deck lists exactly what will be sleeved into it, so the list starts
-- reconciled and any movement in it afterwards is the reprint's doing.
insert into public.deck_cards (deck_id, card_id, quantity) values
  ('c1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 4),
  ('c1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 2),
  ('c1000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 4),
  ('c1000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 2),
  ('c1000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 1);

set local role authenticated;
set local "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000001'; -- zara

-- Sleeved as the signed-in user so the inserts run under the same RLS the app
-- runs under. LEA (aaaa...0001) is {nonfoil}; M10 (aaaa...0002) is
-- {nonfoil,foil} -- the finish gate below depends on that difference.
insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity) values
  ('c2000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'NM', 'nonfoil', 'en', 4),
  ('c2000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'NM', 'nonfoil', 'en', 2),
  ('c2000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'NM', 'nonfoil', 'en', 4),
  ('c2000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 'NM', 'nonfoil', 'en', 2),
  ('c2000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', 'NM', 'nonfoil', 'en', 1),
  ('c2000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000004', 'NM', 'nonfoil', 'en', 3);

-- (1) WHOLE-STACK MERGE inside a deck. The ordering case.
do $$
declare
  r_result record;
  v_entries int; v_total int; v_lea int; v_m10 int;
  v_dest_qty int; v_dest_owner uuid; v_dest_loc uuid;
  v_source_exists int; v_physical int;
begin
  select count(*), coalesce(sum(quantity), 0) into v_entries, v_total
    from public.deck_cards where deck_id = 'c1000000-0000-0000-0000-000000000001';
  assert v_entries = 2 and v_total = 6,
    'fixture precondition: the merge deck should list 4+2=6 across 2 entries, saw '
    || v_entries || ' entries totalling ' || v_total;

  -- All four LEA copies turn out to be the M10 printing, merging into the
  -- M10 stack already sleeved in the same deck.
  select * into r_result from public.apply_stack_reprint(
    'c4000000-0000-0000-0000-000000000001'::uuid,
    'c2000000-0000-0000-0000-000000000001'::uuid, -- source: the 4 LEA
    'aaaaaaaa-0000-0000-0000-000000000002'::uuid, -- to the M10 printing
    'nonfoil',
    'c2000000-0000-0000-0000-000000000002'::uuid, -- decided merge target
    4
  );
  assert r_result.result_quantity = 6 and r_result.replayed = false,
    'the merge target should land at 2+4=6, got ' || r_result.result_quantity;

  -- THE ASSERTION THIS SECTION EXISTS FOR. Nothing physically entered the
  -- deck -- six cards went in and six are still there -- so the list must not
  -- move. Increment the destination before clearing the source and the
  -- trigger sees 10 against 6, adds a shortfall of 4, and this reads 10.
  select count(*), coalesce(sum(quantity), 0) into v_entries, v_total
    from public.deck_cards where deck_id = 'c1000000-0000-0000-0000-000000000001';
  assert v_total = 6,
    'a reprint moves no card into the deck, so the list must stay at 6 -- got '
    || v_total || ' (destination incremented before the source was cleared?)';
  assert v_entries = 2,
    'both list entries must survive a reprint (got ' || v_entries || ')';

  select quantity into v_lea from public.deck_cards
   where deck_id = 'c1000000-0000-0000-0000-000000000001'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select quantity into v_m10 from public.deck_cards
   where deck_id = 'c1000000-0000-0000-0000-000000000001'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000002';
  assert v_lea = 4, 'the deck list line does not follow a reprint: LEA stays 4, got ' || v_lea;
  assert v_m10 = 2, 'the deck list line does not follow a reprint: M10 stays 2, got ' || v_m10;

  -- The physical side did change, and conserves.
  select quantity, owner_user_id, location_id into v_dest_qty, v_dest_owner, v_dest_loc
    from public.card_instances where id = 'c2000000-0000-0000-0000-000000000002';
  assert v_dest_qty = 6, 'the destination stack should hold 6, got ' || v_dest_qty;
  assert v_dest_owner = 'c0000000-0000-0000-0000-000000000001'
     and v_dest_loc = 'c1000000-0000-0000-0000-000000000001',
    'a reprint must not touch ownership or location (hard constraint 6)';

  select count(*) into v_source_exists from public.card_instances
   where id = 'c2000000-0000-0000-0000-000000000001';
  assert v_source_exists = 0, 'a whole-stack merge must remove the emptied source row';

  select coalesce(sum(ci.quantity), 0) into v_physical
    from public.card_instances ci join public.cards c on c.scryfall_id = ci.card_id
   where ci.location_id = 'c1000000-0000-0000-0000-000000000001'
     and c.oracle_id = 'ffffffff-0000-0000-0000-000000000001';
  assert v_physical = 6, 'six physical copies went in and six must remain, got ' || v_physical;
end $$;

-- (2) PARTIAL MERGE. One of four. The off-by-one is harder to spot in
-- production than case 1, so this matters more.
do $$
declare
  r_result record;
  v_total int; v_lea int; v_m10 int; v_src int;
begin
  select * into r_result from public.apply_stack_reprint(
    'c4000000-0000-0000-0000-000000000002'::uuid,
    'c2000000-0000-0000-0000-000000000003'::uuid, -- source: the 4 LEA
    'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
    'nonfoil',
    'c2000000-0000-0000-0000-000000000004'::uuid, -- merge into the M10 stack
    1
  );
  assert r_result.result_quantity = 3, 'the merge target should land at 2+1=3, got ' || r_result.result_quantity;

  select coalesce(sum(quantity), 0) into v_total
    from public.deck_cards where deck_id = 'c1000000-0000-0000-0000-000000000002';
  assert v_total = 6,
    'a partial reprint moves no card into the deck either -- the list must stay at 6, got '
    || v_total || ' (7 means the destination was incremented first)';

  select quantity into v_lea from public.deck_cards
   where deck_id = 'c1000000-0000-0000-0000-000000000002'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select quantity into v_m10 from public.deck_cards
   where deck_id = 'c1000000-0000-0000-0000-000000000002'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000002';
  assert v_lea = 4 and v_m10 = 2,
    'neither list entry follows a partial reprint, got LEA ' || v_lea || ' M10 ' || v_m10;

  select quantity into v_src from public.card_instances
   where id = 'c2000000-0000-0000-0000-000000000003';
  assert v_src = 3, 'the source stack keeps the 3 copies that were not reprinted, got ' || v_src;
end $$;

-- (3) NO MERGE TARGET: the row is updated in place and keeps its id.
do $$
declare
  r_result record;
  v_entries int; v_total int; v_card uuid; v_acquired timestamptz; v_acquired_after timestamptz;
begin
  select acquired_at into v_acquired from public.card_instances
   where id = 'c2000000-0000-0000-0000-000000000005';

  select * into r_result from public.apply_stack_reprint(
    'c4000000-0000-0000-0000-000000000003'::uuid,
    'c2000000-0000-0000-0000-000000000005'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
    'nonfoil',
    null,                                          -- nothing to merge into
    1
  );

  -- Delete-and-reinsert would return a different id, lose acquired_at and
  -- break any trade_items row pointing at this copy.
  assert r_result.result_instance_id = 'c2000000-0000-0000-0000-000000000005',
    'a reprint with no merge target must keep the row id, got ' || r_result.result_instance_id;

  select card_id, acquired_at into v_card, v_acquired_after
    from public.card_instances where id = 'c2000000-0000-0000-0000-000000000005';
  assert v_card = 'aaaaaaaa-0000-0000-0000-000000000002', 'the printing should have changed';
  assert v_acquired_after = v_acquired, 'acquired_at must survive a reprint';

  select count(*), coalesce(sum(quantity), 0) into v_entries, v_total
    from public.deck_cards where deck_id = 'c1000000-0000-0000-0000-000000000003';
  assert v_entries = 1 and v_total = 1,
    'an in-place reprint fires no trigger, so the list stays one entry of 1, saw '
    || v_entries || ' entries totalling ' || v_total;
end $$;

-- (4) The refusals.
do $$
declare
  r_result record;
  v_trade uuid := 'c5000000-0000-0000-0000-000000000001';
  v_qty_before int; v_qty_after int; v_raised boolean;
begin
  -- Same-card rule: a different oracle id is not a reprint, it is a different card.
  begin
    select * into r_result from public.apply_stack_reprint(
      'c4000000-0000-0000-0000-000000000004'::uuid,
      'c2000000-0000-0000-0000-000000000006'::uuid,
      'aaaaaaaa-0000-0000-0000-000000000003'::uuid, -- Thunderbolt Dragon
      'nonfoil', null, 1);
    assert false, 'reprinting onto a different card must be refused';
  exception when invalid_parameter_value then null;
  end;

  -- Finish gate: the LEA printing is {nonfoil}, so foil is impossible on it.
  begin
    select * into r_result from public.apply_stack_reprint(
      'c4000000-0000-0000-0000-000000000005'::uuid,
      'c2000000-0000-0000-0000-000000000006'::uuid,
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'foil', null, 1);
    assert false, 'a finish the target printing does not come in must be refused';
  exception when invalid_parameter_value then null;
  end;

  -- Merging a copy into itself would delete the row and then increment it.
  begin
    select * into r_result from public.apply_stack_reprint(
      'c4000000-0000-0000-0000-000000000006'::uuid,
      'c2000000-0000-0000-0000-000000000006'::uuid,
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'nonfoil',
      'c2000000-0000-0000-0000-000000000006'::uuid,
      1);
    assert false, 'merging a copy into itself must be refused';
  exception when invalid_parameter_value then null;
  end;

  -- More copies than the stack holds.
  begin
    select * into r_result from public.apply_stack_reprint(
      'c4000000-0000-0000-0000-000000000007'::uuid,
      'c2000000-0000-0000-0000-000000000006'::uuid,
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'nonfoil', null, 99);
    assert false, 'reprinting more copies than the stack holds must be refused';
  exception when no_data_found then null;
  end;

  -- Every refusal above must have left the copy exactly as it was.
  select quantity into v_qty_after from public.card_instances
   where id = 'c2000000-0000-0000-0000-000000000006';
  assert v_qty_after = 3, 'a refused reprint must not touch the copy, saw ' || v_qty_after;

  -- THE OPEN-TRADE BLOCK. Without it, accept_trade hands the counterparty a
  -- printing they never agreed to, while the trade screen still shows them
  -- the one that was offered (migration 23's snapshot is not re-read).
  insert into public.trades (id, proposer_id, recipient_id, status)
  values (v_trade, 'c0000000-0000-0000-0000-000000000001',
          'c0000000-0000-0000-0000-000000000002', 'proposed');
  insert into public.trade_items (trade_id, card_instance_id, direction, quantity)
  values (v_trade, 'c2000000-0000-0000-0000-000000000006', 'from_proposer', 1);

  begin
    select * into r_result from public.apply_stack_reprint(
      'c4000000-0000-0000-0000-000000000008'::uuid,
      'c2000000-0000-0000-0000-000000000006'::uuid,
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'nonfoil', null, 3);
    assert false, 'a copy committed to an open trade must not be reprintable';
  exception when invalid_parameter_value then null;
  end;

  -- ...but a settled trade does not block it. The same copy, once the trade is
  -- no longer open, reprints normally.
  update public.trades set status = 'cancelled' where id = v_trade;

  select * into r_result from public.apply_stack_reprint(
    'c4000000-0000-0000-0000-000000000009'::uuid,
    'c2000000-0000-0000-0000-000000000006'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'nonfoil', null, 3);
  assert r_result.result_instance_id = 'c2000000-0000-0000-0000-000000000006'
     and r_result.result_quantity = 3,
    'a cancelled trade must not keep blocking the reprint';
end $$;

-- (5) Idempotency: the same operation id replays rather than reprinting twice.
do $$
declare r_result record; v_qty int;
begin
  select * into r_result from public.apply_stack_reprint(
    'c4000000-0000-0000-0000-000000000009'::uuid,
    'c2000000-0000-0000-0000-000000000006'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    'nonfoil', null, 3);
  assert r_result.replayed = true,
    'replaying an operation id must be reported as a replay, not done again';

  select quantity into v_qty from public.card_instances
   where id = 'c2000000-0000-0000-0000-000000000006';
  assert v_qty = 3, 'a replay must not change anything, saw ' || v_qty;

  -- The same id with different details is a bug in the caller, not a replay.
  begin
    select * into r_result from public.apply_stack_reprint(
      'c4000000-0000-0000-0000-000000000009'::uuid,
      'c2000000-0000-0000-0000-000000000006'::uuid,
      'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
      'nonfoil', null, 1);
    assert false, 'a reused operation id with different details must be refused';
  exception when invalid_parameter_value then null;
  end;
end $$;

reset role;

-- --------------------------------------------------------------------------
-- 20. bulkMerge's write order cannot inflate a deck list either
--     (src/app/(app)/collection/bulk-actions.ts, fixed 2026-09-23).
--
-- Same hazard as section 19, reached through a different door: bulkMerge
-- combines identical stacks by raising the kept row's quantity and deleting
-- the absorbed ones as two separate client requests -- no atomic RPC covers
-- this path (it predates apply_stack_addition/move/reprint). If the quantity
-- update ran first, migration 37's trigger would see the kept row's new
-- combined total PLUS the still-present absorbed rows -- a physical count
-- higher than the deck's listed total -- and raise deck_cards to match, a
-- rise the trigger never reverses (migration 20 is monotone-up by design).
-- Deleting the absorbed rows first means the trigger only ever sees the
-- correct final total. This section replicates bulkMerge's exact
-- two-statement sequence under RLS, and was confirmed red with the
-- statements swapped before being allowed to pass.
-- --------------------------------------------------------------------------
insert into public.locations (id, user_id, name, type) values
  ('a3000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'Merge Order Deck', 'deck');

insert into public.deck_cards (deck_id, card_id, quantity) values
  ('a3000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 4);

set local role authenticated;
set local "request.jwt.claim.sub" = 'c0000000-0000-0000-0000-000000000001'; -- zara

-- Two identical stacks of the listed card, sleeved in the same deck, sharing
-- every stack attribute -- exactly what "Merge duplicates" groups together.
insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity) values
  ('a3000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'NM', 'nonfoil', 'en', 2),
  ('a3000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'NM', 'nonfoil', 'en', 2);

do $$
declare v_total int;
begin
  select coalesce(sum(quantity), 0) into v_total from public.deck_cards
   where deck_id = 'a3000000-0000-0000-0000-000000000001';
  assert v_total = 4, 'fixture precondition: the deck should list 4, saw ' || v_total;

  -- bulkMerge's own order: the absorbed row is deleted first, the kept row's
  -- quantity is raised second.
  delete from public.card_instances where id = 'a3000000-0000-0000-0000-000000000003';

  update public.card_instances set quantity = 4
   where id = 'a3000000-0000-0000-0000-000000000002';

  -- THE ASSERTION THIS SECTION EXISTS FOR. Nothing physically entered the
  -- deck -- four cards went in and four are still there -- so the list must
  -- not move. Raise the kept row's quantity before deleting the absorbed row
  -- and the trigger sees 6 against 4, adds a shortfall of 2, and this reads 6.
  select coalesce(sum(quantity), 0) into v_total from public.deck_cards
   where deck_id = 'a3000000-0000-0000-0000-000000000001';
  assert v_total = 4,
    'merging two stacks moves no card into the deck, so the list must stay at 4 -- got '
    || v_total || ' (kept row raised before the absorbed row was cleared?)';
end $$;

reset role;

-- --------------------------------------------------------------------------
-- 21. apply_stack_rekey() (migration 41): the shared atomic re-file behind
--     updateCardInstance, bulkMove, bulkSetField, sleeve/unsleeve,
--     remove-from-deck and bulkMerge.
--
-- Mirrors section 19's red-before-green discipline: written, confirmed to
-- fail against a deliberately-reintroduced increment-before-decrement in the
-- merge branch, then confirmed to pass against the real migration.
--
-- Fresh fixtures, isolated from every section above for the same reason
-- sections 14, 18 and 19 give.
-- --------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000001', 'quinn@example.com', '{"username":"quinn"}'),
  ('10000000-0000-0000-0000-000000000002', 'rex@example.com', '{"username":"rex"}');

-- The open-trade case below needs a real trade, and trades may only be
-- proposed between friends (migration 9's insert policy).
insert into public.friendships (requester_id, addressee_id, status) values
  ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'accepted');

insert into public.locations (id, user_id, name, type, is_tradable) values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Quinn Box',              'box',    false),
  ('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Quinn Merge Deck',       'deck',   false),
  ('11000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Quinn Partial Deck',     'deck',   false),
  ('11000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Quinn Two Printing Deck','deck',   false),
  ('11000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Quinn Solo Box',         'box',    false),
  ('11000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'Quinn LP Binder',        'binder', false),
  ('11000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'Quinn Tradable Binder',  'binder', true),
  ('11000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000002', 'Rex Box',              'box',    false),
  ('11000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'Quinn Stale Box',        'box',    false);

-- (A) WHOLE-PILE MERGE INSIDE A DECK. The ordering case, restated for rekey:
-- a merge branch's destination increment must never run before the source
-- gives its copies up.
insert into public.deck_cards (deck_id, card_id, quantity) values
  ('11000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 6);

insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity) values
  ('12000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', 'NM', 'nonfoil', 'en', 4),
  ('12000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', 'LP', 'nonfoil', 'en', 2);

set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001'; -- quinn

do $$
declare
  r_result   record;
  v_entries  int;
  v_total    int;
  v_src_gone int;
  v_dst_qty  int;
begin
  select * into r_result from public.apply_stack_rekey(
    '14000000-0000-0000-0000-000000000001'::uuid,
    jsonb_build_array(jsonb_build_object(
      'mode', 'rekey',
      'source_instance_id', '12000000-0000-0000-0000-000000000001',
      'quantity', 4,
      'condition', 'LP',
      'finish', 'nonfoil',
      'language', 'en',
      'location_id', '11000000-0000-0000-0000-000000000002',
      'notes', null,
      'target_instance_id', '12000000-0000-0000-0000-000000000002'
    ))
  );
  assert r_result.result_quantity = 6 and r_result.replayed = false,
    'the merge target should land at 2+4=6, got ' || r_result.result_quantity;

  -- THE ASSERTION THIS CASE EXISTS FOR. Nothing physically entered the deck --
  -- six cards went in and six are still there -- so the list must not move.
  -- Increment the destination before clearing the source and the trigger sees
  -- 10 against 6, adds a shortfall of 4, and this reads 10.
  select count(*), coalesce(sum(quantity), 0) into v_entries, v_total
    from public.deck_cards where deck_id = '11000000-0000-0000-0000-000000000002';
  assert v_entries = 1 and v_total = 6,
    'a rekey moves no card into the deck, so the list must stay at 6 -- got '
    || v_total || ' across ' || v_entries || ' entries (destination incremented before the source was cleared?)';

  select count(*) into v_src_gone from public.card_instances
   where id = '12000000-0000-0000-0000-000000000001';
  assert v_src_gone = 0, 'a whole-stack merge must remove the emptied source row';

  select quantity into v_dst_qty from public.card_instances
   where id = '12000000-0000-0000-0000-000000000002';
  assert v_dst_qty = 6, 'the destination stack should hold 6, got ' || v_dst_qty;
end $$;

-- (B) PARTIAL MERGE. The off-by-one is harder to spot than the whole-pile
-- case, so it gets its own fixtures.
insert into public.deck_cards (deck_id, card_id, quantity) values
  ('11000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 6);

insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity) values
  ('12000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000003', 'NM', 'nonfoil', 'en', 4),
  ('12000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000003', 'LP', 'nonfoil', 'en', 2);

do $$
declare
  r_result  record;
  v_total   int;
  v_src_qty int;
begin
  select * into r_result from public.apply_stack_rekey(
    '14000000-0000-0000-0000-000000000002'::uuid,
    jsonb_build_array(jsonb_build_object(
      'mode', 'rekey',
      'source_instance_id', '12000000-0000-0000-0000-000000000003',
      'quantity', 1,
      'condition', 'LP',
      'finish', 'nonfoil',
      'language', 'en',
      'location_id', '11000000-0000-0000-0000-000000000003',
      'notes', null,
      'target_instance_id', '12000000-0000-0000-0000-000000000004'
    ))
  );
  assert r_result.result_quantity = 3, 'the merge target should land at 2+1=3, got ' || r_result.result_quantity;

  select coalesce(sum(quantity), 0) into v_total
    from public.deck_cards where deck_id = '11000000-0000-0000-0000-000000000003';
  assert v_total = 6,
    'a partial rekey moves no card into the deck either -- the list must stay at 6, got '
    || v_total || ' (7 means the destination was incremented first)';

  select quantity into v_src_qty from public.card_instances
   where id = '12000000-0000-0000-0000-000000000003';
  assert v_src_qty = 3, 'the source stack keeps the 3 copies that were not rekeyed, got ' || v_src_qty;
end $$;

-- (C) TWO PRINTINGS IN ONE DECK. A rekey that genuinely brings NEW physical
-- copies into a deck (merging a spare stack in from a box) must add the
-- resulting shortfall to the entry naming the exact printing, never to a
-- different printing's entry for the same card -- migration 20's rule,
-- reached through this new write path.
insert into public.deck_cards (deck_id, card_id, quantity) values
  ('11000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 4),
  ('11000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002', 2);

insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity) values
  ('12000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000004', 'NM', 'nonfoil', 'en', 4),
  ('12000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000004', 'NM', 'nonfoil', 'en', 2),
  ('12000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'NM', 'nonfoil', 'en', 2);

do $$
declare
  r_result  record;
  v_lea     int;
  v_m10     int;
  v_total   int;
  v_entries int;
begin
  select coalesce(sum(quantity), 0) into v_total
    from public.deck_cards where deck_id = '11000000-0000-0000-0000-000000000004';
  assert v_total = 6, 'fixture precondition: the two-printing deck should list 4+2=6, got ' || v_total;

  -- Two spare LEA copies move in from the box, merging into the LEA stack
  -- already sleeved -- a real physical addition, unlike cases A and B.
  select * into r_result from public.apply_stack_rekey(
    '14000000-0000-0000-0000-000000000003'::uuid,
    jsonb_build_array(jsonb_build_object(
      'mode', 'rekey',
      'source_instance_id', '12000000-0000-0000-0000-000000000007',
      'quantity', 2,
      'condition', 'NM',
      'finish', 'nonfoil',
      'language', 'en',
      'location_id', '11000000-0000-0000-0000-000000000004',
      'notes', null,
      'target_instance_id', '12000000-0000-0000-0000-000000000005'
    ))
  );
  assert r_result.result_quantity = 6, 'the LEA stack in the deck should land at 4+2=6, got ' || r_result.result_quantity;

  select count(*), coalesce(sum(quantity), 0) into v_entries, v_total
    from public.deck_cards where deck_id = '11000000-0000-0000-0000-000000000004';
  select quantity into v_lea from public.deck_cards
   where deck_id = '11000000-0000-0000-0000-000000000004' and card_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select quantity into v_m10 from public.deck_cards
   where deck_id = '11000000-0000-0000-0000-000000000004' and card_id = 'aaaaaaaa-0000-0000-0000-000000000002';

  assert v_entries = 2, 'both list entries must survive, got ' || v_entries;
  assert v_lea = 6, 'the shortfall must land on the entry naming the exact printing (LEA), got ' || v_lea;
  assert v_m10 = 2, 'the M10 entry must not absorb a shortfall that belongs to LEA, got ' || v_m10;
  assert v_total = 8, 'two physical copies genuinely entered the deck, so the list total should rise to 8, got ' || v_total;
end $$;

-- (D) THE KEEP-THE-ROW BRANCH: a whole-stack rekey with nothing to merge into
-- updates in place and keeps the row's id and acquired_at -- delete-and-
-- reinsert would lose both and break any trade_items row pointing at it.
insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity) values
  ('12000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000005', 'NM', 'nonfoil', 'en', 3);

do $$
declare
  r_result         record;
  v_acquired       timestamptz;
  v_acquired_after timestamptz;
  v_condition      text;
  v_location       uuid;
begin
  select acquired_at into v_acquired from public.card_instances
   where id = '12000000-0000-0000-0000-000000000008';

  select * into r_result from public.apply_stack_rekey(
    '14000000-0000-0000-0000-000000000004'::uuid,
    jsonb_build_array(jsonb_build_object(
      'mode', 'rekey',
      'source_instance_id', '12000000-0000-0000-0000-000000000008',
      'quantity', 3,
      'condition', 'LP',
      'finish', 'nonfoil',
      'language', 'en',
      'location_id', '11000000-0000-0000-0000-000000000006',
      'notes', null,
      'target_instance_id', null
    ))
  );

  assert r_result.result_instance_id = '12000000-0000-0000-0000-000000000008',
    'a rekey with no merge target must keep the row id, got ' || r_result.result_instance_id;

  select condition, location_id, acquired_at into v_condition, v_location, v_acquired_after
    from public.card_instances where id = '12000000-0000-0000-0000-000000000008';
  assert v_condition = 'LP' and v_location = '11000000-0000-0000-0000-000000000006',
    'the in-place branch must apply the new key, got condition ' || v_condition || ' location ' || v_location;
  assert v_acquired_after = v_acquired, 'acquired_at must survive an in-place rekey';
end $$;

-- (E) ALL-OR-NOTHING: a later step in the same call failing must roll back an
-- earlier step that already wrote something -- the one hazard unique to this
-- function's list-of-steps shape, since every sibling in this family applies
-- exactly one logical change.
insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity) values
  ('12000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'NM', 'nonfoil', 'en', 5),
  ('12000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000009', 'NM', 'nonfoil', 'en', 1);

-- Simulates the decided target's stack key changing between the decision and
-- the call, the same way section 19's case 7 stales a reprint's target.
update public.card_instances set condition = 'LP'
 where id = '12000000-0000-0000-0000-000000000010';

do $$
declare v_qty int;
begin
  begin
    perform public.apply_stack_rekey(
      '14000000-0000-0000-0000-000000000005'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'mode', 'set_quantity',
          'source_instance_id', '12000000-0000-0000-0000-000000000009',
          'quantity', 3
        ),
        jsonb_build_object(
          'mode', 'rekey',
          'source_instance_id', '12000000-0000-0000-0000-000000000009',
          'quantity', 3,
          'condition', 'NM',
          'finish', 'nonfoil',
          'language', 'en',
          'location_id', '11000000-0000-0000-0000-000000000009',
          'notes', null,
          'target_instance_id', '12000000-0000-0000-0000-000000000010'
        )
      )
    );
    assert false, 'a stale later step must fail the whole call';
  exception when no_data_found then null;
  end;

  -- THE ASSERTION THIS CASE EXISTS FOR: step 1 (the quantity change to 3)
  -- must not have survived step 2's failure -- the whole call is one
  -- transaction, or a caller retrying after a reported failure would be
  -- retrying against a half-applied state it never asked for.
  select quantity into v_qty from public.card_instances
   where id = '12000000-0000-0000-0000-000000000009';
  assert v_qty = 5, 'a failed later step must roll back an earlier step in the same call, saw quantity ' || v_qty;
end $$;

-- The failed attempt above must not have left a ledger row behind that blocks
-- a retry under the same operation id: since the whole function raised, its
-- own ledger insert rolled back with everything else.
update public.card_instances set condition = 'NM'
 where id = '12000000-0000-0000-0000-000000000010';

do $$
declare r_result record; v_qty int;
begin
  select * into r_result from public.apply_stack_rekey(
    '14000000-0000-0000-0000-000000000005'::uuid,
    jsonb_build_array(
      jsonb_build_object(
        'mode', 'set_quantity',
        'source_instance_id', '12000000-0000-0000-0000-000000000009',
        'quantity', 3
      ),
      jsonb_build_object(
        'mode', 'rekey',
        'source_instance_id', '12000000-0000-0000-0000-000000000009',
        'quantity', 3,
        'condition', 'NM',
        'finish', 'nonfoil',
        'language', 'en',
        'location_id', '11000000-0000-0000-0000-000000000009',
        'notes', null,
        'target_instance_id', '12000000-0000-0000-0000-000000000010'
      )
    )
  );

  -- Step 1 set the pile to an absolute 3 (not "reduce by 3"), so step 2's
  -- whole-stack merge (quantity 3 = the entire updated pile) consumes the
  -- source row entirely, the same as case A above.
  select count(*) into v_qty from public.card_instances where id = '12000000-0000-0000-0000-000000000009';
  assert v_qty = 0, 'the retried call''s whole-stack merge must remove the emptied source row, saw ' || v_qty || ' remaining';

  select quantity into v_qty from public.card_instances where id = '12000000-0000-0000-0000-000000000010';
  assert v_qty = 4, 'the retried call should merge the 3 moved copies into the target (1+3=4), got ' || v_qty;
end $$;

-- (F) THE FINISH CHECK: refused when the finish is actually changing to
-- something the printing does not come in, but never refused merely for
-- keeping whatever finish the row already has -- even a finish the catalog
-- would call impossible (owner decision, 2026-09-22).
insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity) values
  ('12000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'NM', 'nonfoil', 'en', 2);

-- Simulates a copy whose finish is already odd relative to the catalog --
-- LEA's available_finishes is {nonfoil} only. The edit form must still allow
-- saving an unrelated change without being forced to fix this first.
update public.card_instances set finish = 'foil'
 where id = '12000000-0000-0000-0000-000000000011';

do $$
declare r_result record; v_condition text;
begin
  -- Changing the finish to something impossible IS refused.
  begin
    perform public.apply_stack_rekey(
      '14000000-0000-0000-0000-000000000006'::uuid,
      jsonb_build_array(jsonb_build_object(
        'mode', 'rekey',
        'source_instance_id', '12000000-0000-0000-0000-000000000011',
        'quantity', 2,
        'condition', 'LP',
        'finish', 'etched',
        'language', 'en',
        'location_id', '11000000-0000-0000-0000-000000000001',
        'notes', null,
        'target_instance_id', null
      ))
    );
    assert false, 'changing to a finish the printing does not come in must be refused';
  exception when invalid_parameter_value then null;
  end;

  -- Keeping the existing (already-odd) finish untouched, while changing
  -- something else, must succeed.
  select * into r_result from public.apply_stack_rekey(
    '14000000-0000-0000-0000-000000000007'::uuid,
    jsonb_build_array(jsonb_build_object(
      'mode', 'rekey',
      'source_instance_id', '12000000-0000-0000-0000-000000000011',
      'quantity', 2,
      'condition', 'LP',
      'finish', 'foil',
      'language', 'en',
      'location_id', '11000000-0000-0000-0000-000000000001',
      'notes', null,
      'target_instance_id', null
    ))
  );

  select condition into v_condition from public.card_instances
   where id = '12000000-0000-0000-0000-000000000011';
  assert v_condition = 'LP',
    'keeping an already-odd finish untouched must not block an unrelated change, got condition ' || v_condition;
end $$;

-- (G) OTHER REFUSALS, and the transactional guarantee that each leaves
-- everything exactly as it was.
insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity) values
  ('12000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'NM', 'nonfoil', 'en', 4);

do $$
declare r_result record; v_qty int;
begin
  -- Unknown mode.
  begin
    perform public.apply_stack_rekey(
      '14000000-0000-0000-0000-000000000008'::uuid,
      jsonb_build_array(jsonb_build_object(
        'mode', 'delete_it',
        'source_instance_id', '12000000-0000-0000-0000-000000000012',
        'quantity', 1
      ))
    );
    assert false, 'an unknown step mode must be refused';
  exception when invalid_parameter_value then null;
  end;

  -- Empty steps array.
  begin
    perform public.apply_stack_rekey('14000000-0000-0000-0000-000000000009'::uuid, '[]'::jsonb);
    assert false, 'an empty step list must be refused';
  exception when invalid_parameter_value then null;
  end;

  -- Self-merge would delete the row and then increment it.
  begin
    perform public.apply_stack_rekey(
      '14000000-0000-0000-0000-000000000010'::uuid,
      jsonb_build_array(jsonb_build_object(
        'mode', 'rekey',
        'source_instance_id', '12000000-0000-0000-0000-000000000012',
        'quantity', 1,
        'condition', 'NM',
        'finish', 'nonfoil',
        'language', 'en',
        'location_id', '11000000-0000-0000-0000-000000000001',
        'notes', null,
        'target_instance_id', '12000000-0000-0000-0000-000000000012'
      ))
    );
    assert false, 'merging a copy into itself must be refused';
  exception when invalid_parameter_value then null;
  end;

  -- More copies than the stack holds.
  begin
    perform public.apply_stack_rekey(
      '14000000-0000-0000-0000-000000000011'::uuid,
      jsonb_build_array(jsonb_build_object(
        'mode', 'rekey',
        'source_instance_id', '12000000-0000-0000-0000-000000000012',
        'quantity', 99,
        'condition', 'NM',
        'finish', 'nonfoil',
        'language', 'en',
        'location_id', '11000000-0000-0000-0000-000000000001',
        'notes', null,
        'target_instance_id', null
      ))
    );
    assert false, 'rekeying more copies than the stack holds must be refused';
  exception when no_data_found then null;
  end;

  select quantity into v_qty from public.card_instances where id = '12000000-0000-0000-0000-000000000012';
  assert v_qty = 4, 'every refusal above must leave the copy untouched, saw ' || v_qty;

  -- Reusing an operation id with a different payload is a caller bug, not a
  -- replay.
  select * into r_result from public.apply_stack_rekey(
    '14000000-0000-0000-0000-000000000012'::uuid,
    jsonb_build_array(jsonb_build_object(
      'mode', 'set_quantity',
      'source_instance_id', '12000000-0000-0000-0000-000000000012',
      'quantity', 4
    ))
  );
  assert r_result.replayed = false;

  begin
    perform public.apply_stack_rekey(
      '14000000-0000-0000-0000-000000000012'::uuid,
      jsonb_build_array(jsonb_build_object(
        'mode', 'set_quantity',
        'source_instance_id', '12000000-0000-0000-0000-000000000012',
        'quantity', 1
      ))
    );
    assert false, 'a reused operation id with a different payload must be refused';
  exception when invalid_parameter_value then null;
  end;

  -- The identical call again is a genuine replay, not a second write.
  select * into r_result from public.apply_stack_rekey(
    '14000000-0000-0000-0000-000000000012'::uuid,
    jsonb_build_array(jsonb_build_object(
      'mode', 'set_quantity',
      'source_instance_id', '12000000-0000-0000-0000-000000000012',
      'quantity', 4
    ))
  );
  assert r_result.replayed = true, 'the identical call again must be reported as a replay';

  select quantity into v_qty from public.card_instances where id = '12000000-0000-0000-0000-000000000012';
  assert v_qty = 4, 'a replay must not change anything, saw ' || v_qty;
end $$;

reset role;

-- (H) CROSS-USER REFUSAL, including the case migration 9 makes genuinely
-- readable: rex is quinn's accepted friend, and Quinn Tradable Binder is marked
-- tradable, so a copy sitting in it is genuinely SELECT-able by rex -- but
-- apply_stack_rekey's owner_user_id = auth.uid() predicates must still refuse
-- to rekey it or merge into it. The same "readable through RLS is not the
-- same as yours to write" case hard constraint 3 exists to catch, restated
-- for rekey -- and this is also the exact gap the impact map found in
-- addToDeck's source read and bulkMerge's read, both missing this filter.
insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity) values
  ('12000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000007', 'NM', 'nonfoil', 'en', 3);

set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000002'; -- rex

insert into public.card_instances
  (id, owner_user_id, card_id, location_id, condition, finish, language, quantity) values
  ('12000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000008', 'NM', 'nonfoil', 'en', 2);

do $$
declare visible int;
begin
  select count(*) into visible from public.card_instances
   where id = '12000000-0000-0000-0000-000000000013';
  assert visible = 1,
    'rex should be able to read quinn''s tradable-binder instance via migration 9''s policy, saw ' || visible;

  -- rex tries to use quinn's (readable) instance as the SOURCE of a rekey.
  begin
    perform public.apply_stack_rekey(
      '14000000-0000-0000-0000-000000000013'::uuid,
      jsonb_build_array(jsonb_build_object(
        'mode', 'rekey',
        'source_instance_id', '12000000-0000-0000-0000-000000000013',
        'quantity', 1,
        'condition', 'NM',
        'finish', 'nonfoil',
        'language', 'en',
        'location_id', '11000000-0000-0000-0000-000000000008',
        'notes', null,
        'target_instance_id', null
      ))
    );
    assert false, 'a caller must not be able to rekey another owner''s instance, even one they can read';
  exception when no_data_found then null;
  end;

  -- rex tries to merge her own card into quinn's (readable) instance as the
  -- decided destination target.
  begin
    perform public.apply_stack_rekey(
      '14000000-0000-0000-0000-000000000014'::uuid,
      jsonb_build_array(jsonb_build_object(
        'mode', 'rekey',
        'source_instance_id', '12000000-0000-0000-0000-000000000014',
        'quantity', 1,
        'condition', 'NM',
        'finish', 'nonfoil',
        'language', 'en',
        'location_id', '11000000-0000-0000-0000-000000000007',
        'notes', null,
        'target_instance_id', '12000000-0000-0000-0000-000000000013'
      ))
    );
    assert false, 'a caller must not be able to merge into another owner''s instance, even one they can read';
  exception when no_data_found then null;
  end;
end $$;

reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001'; -- quinn

do $$
declare v_qty int; v_owner uuid;
begin
  select quantity, owner_user_id into v_qty, v_owner from public.card_instances
   where id = '12000000-0000-0000-0000-000000000013';
  assert v_qty = 3 and v_owner = '10000000-0000-0000-0000-000000000001',
    'a cross-user attempt must leave the target row completely untouched, saw quantity ' || v_qty;
end $$;

-- (I) THE OPEN-TRADE GATE: blocks a merge or a split, but -- unlike
-- apply_stack_reprint, which changes card_id on every branch -- does NOT
-- block a whole-stack rekey that keeps the same row (owner decision,
-- 2026-09-22).
insert into public.trades (id, proposer_id, recipient_id, status)
values ('15000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000002', 'proposed');
insert into public.trade_items (trade_id, card_instance_id, direction, quantity)
values ('15000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000013', 'from_proposer', 3);

do $$
declare r_result record; v_qty int; v_condition text; v_location uuid;
begin
  -- A MERGE step against a traded copy is refused.
  begin
    perform public.apply_stack_rekey(
      '14000000-0000-0000-0000-000000000015'::uuid,
      jsonb_build_array(jsonb_build_object(
        'mode', 'rekey',
        'source_instance_id', '12000000-0000-0000-0000-000000000013',
        'quantity', 3,
        'condition', 'NM',
        'finish', 'nonfoil',
        'language', 'en',
        'location_id', '11000000-0000-0000-0000-000000000001',
        'notes', null,
        'target_instance_id', '12000000-0000-0000-0000-000000000012'
      ))
    );
    assert false, 'a merge of a copy committed to an open trade must be refused';
  exception when invalid_parameter_value then null;
  end;

  -- A SPLIT step (partial quantity, no merge target) against a traded copy is
  -- also refused.
  begin
    perform public.apply_stack_rekey(
      '14000000-0000-0000-0000-000000000016'::uuid,
      jsonb_build_array(jsonb_build_object(
        'mode', 'rekey',
        'source_instance_id', '12000000-0000-0000-0000-000000000013',
        'quantity', 1,
        'condition', 'LP',
        'finish', 'nonfoil',
        'language', 'en',
        'location_id', '11000000-0000-0000-0000-000000000001',
        'notes', null,
        'target_instance_id', null
      ))
    );
    assert false, 'a split of a copy committed to an open trade must be refused';
  exception when invalid_parameter_value then null;
  end;

  select quantity into v_qty from public.card_instances where id = '12000000-0000-0000-0000-000000000013';
  assert v_qty = 3, 'both refused attempts must leave the traded copy untouched, saw ' || v_qty;

  -- A whole-stack rekey with NOTHING to merge into -- staying in the same
  -- row -- is allowed even while the trade is open: accept_trade still reads
  -- the same card_instances.id it always did, holding the same card.
  select * into r_result from public.apply_stack_rekey(
    '14000000-0000-0000-0000-000000000017'::uuid,
    jsonb_build_array(jsonb_build_object(
      'mode', 'rekey',
      'source_instance_id', '12000000-0000-0000-0000-000000000013',
      'quantity', 3,
      'condition', 'LP',
      'finish', 'nonfoil',
      'language', 'en',
      'location_id', '11000000-0000-0000-0000-000000000009',
      'notes', null,
      'target_instance_id', null
    ))
  );
  assert r_result.result_instance_id = '12000000-0000-0000-0000-000000000013',
    'a same-row rekey must be allowed under an open trade and must keep the row id';

  select condition, location_id into v_condition, v_location from public.card_instances
   where id = '12000000-0000-0000-0000-000000000013';
  assert v_condition = 'LP' and v_location = '11000000-0000-0000-0000-000000000009',
    'the allowed same-row rekey must actually have applied, got condition ' || v_condition;
end $$;

reset role;

-- --------------------------------------------------------------------------
-- 22. Migration 20's deck-list shortfall trigger: the 2nd and 3rd tiers named
--     in its header but never directly asserted. Section 12 above only
--     exercises tier 1 -- an entry naming the exact printing sleeved.
--
--       tier 2: no entry names the exact printing, so the shortfall lands on
--               the OLDEST entry for the card (any printing). Genuinely new
--               coverage -- falsified below by reversing the ORDER BY in a
--               scratch copy of the migration, which broke only this
--               section's assertion, nothing earlier.
--       tier 3: no entry exists for the card at all, so a brand-new
--               deck_cards row is inserted. Section 11 already exercises this
--               code path incidentally (a first-time-filed card with no list
--               entry), which is why disabling the insert branch in the same
--               falsification broke section 11 before ever reaching this one.
--               Kept here anyway, alongside tier 2, so migration 20's own
--               three tiers are named and asserted together in one place,
--               against a deck that also has other, unrelated entries on its
--               list -- section 11's deck does not.
--
-- The "oldest entry" tie-break is nondeterministic inside one transaction --
-- this whole file runs inside a single `begin`, so now() (deck_cards'
-- created_at default) is frozen and identical across every insert here,
-- which would make "oldest" fall through to comparing random uuids instead.
-- created_at is set explicitly below for exactly this reason -- see
-- .claude/rules/migrations.md's "Known unresolved" section, which named this
-- as the reason tier 2 had no test yet.
-- --------------------------------------------------------------------------

-- A third Lightning Bolt printing sharing section 12's oracle id
-- (ffffffff-...0001), never named by any deck_cards entry below -- this is
-- what forces the trigger past tier 1 and into tier 2's fallback.
insert into public.cards (scryfall_id, oracle_id, name, set_code, collector_number,
                          available_finishes, lang, released_at, image_uri_small)
values
  ('aaaaaaaa-0000-0000-0000-000000000006', 'ffffffff-0000-0000-0000-000000000001',
   'Lightning Bolt', '2ed', '150', '{nonfoil}', 'en', '1993-10-04', 'https://img/6');

insert into public.locations (id, user_id, name, type) values
  ('bbbbbbbb-0000-0000-0000-000000000022', '11111111-1111-1111-1111-111111111111',
   'Shortfall Tiers', 'deck');

-- Two entries for the same oracle id (LEA, M10 -- section 12's printings),
-- neither of them the 2ED printing tier 2 will sleeve. created_at is explicit
-- and distinct so "oldest" is deterministic regardless of statement order or
-- id generation.
insert into public.deck_cards (deck_id, card_id, quantity, created_at) values
  ('bbbbbbbb-0000-0000-0000-000000000022', 'aaaaaaaa-0000-0000-0000-000000000001', 5,
   '2020-01-01T00:00:00Z'),
  ('bbbbbbbb-0000-0000-0000-000000000022', 'aaaaaaaa-0000-0000-0000-000000000002', 5,
   '2020-06-01T00:00:00Z');

do $$
declare entries int; total int; lea_qty int; m10_qty int; twoed_qty int;
begin
  -- Tier 2: sleeve 11 copies of the UNLISTED 2ED printing. Physical (11)
  -- exceeds listed (10) by 1, and no entry names 2ED, so the shortfall must
  -- fall back to the oldest entry (LEA, 2020-01-01) rather than the newer
  -- M10 entry or a fresh row for 2ED itself.
  insert into public.card_instances
    (owner_user_id, card_id, location_id, condition, finish, language, quantity)
  values
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000006',
     'bbbbbbbb-0000-0000-0000-000000000022', 'NM', 'nonfoil', 'en', 11);

  select count(*), coalesce(sum(quantity), 0) into entries, total
    from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000022';

  select quantity into lea_qty from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000022'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select quantity into m10_qty from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000022'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000002';
  select quantity into twoed_qty from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000022'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000006';

  assert entries = 2,
    'tier 2 must not create a new row for the unlisted printing (got ' || entries || ' entries)';
  assert total = 11,
    'one copy over the list should add exactly one, regardless of which printing (got ' || total || ')';
  assert lea_qty = 6,
    'the shortfall must land on the OLDEST entry (LEA) when no entry names the sleeved '
    || 'printing (got ' || lea_qty || ')';
  assert m10_qty = 5, 'the newer entry (M10) must not move (got ' || m10_qty || ')';
  assert twoed_qty is null,
    'tier 2 must reuse an existing entry, never create one for the printing actually sleeved';
end $$;

do $$
declare entries int; total int; dragon_qty int; dragon_card text;
begin
  -- Tier 3: sleeve a card from a DIFFERENT oracle group entirely
  -- (Thunderbolt Dragon, ffffffff-...0002 -- section 1's fixture) with no
  -- deck_cards entry at all in this deck. Listed total for that oracle id is
  -- 0, so the whole physical count is the shortfall, and there is no entry
  -- to fall back to -- a fresh row must be inserted naming the exact
  -- printing sleeved.
  insert into public.card_instances
    (owner_user_id, card_id, location_id, condition, finish, language, quantity)
  values
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003',
     'bbbbbbbb-0000-0000-0000-000000000022', 'NM', 'nonfoil', 'en', 3);

  select count(*), coalesce(sum(quantity), 0) into entries, total
    from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000022';

  select quantity, card_id into dragon_qty, dragon_card from public.deck_cards
   where deck_id = 'bbbbbbbb-0000-0000-0000-000000000022'
     and card_id = 'aaaaaaaa-0000-0000-0000-000000000003';

  assert entries = 3,
    'tier 3 must insert a brand-new row when no entry exists for the card at all (got '
    || entries || ' entries)';
  assert total = 14, 'the deck total must include the new row (got ' || total || ')';
  assert dragon_qty = 3,
    'the new row must hold the full physical count, since nothing was listed for it (got '
    || coalesce(dragon_qty::text, 'null') || ')';
  assert dragon_card = 'aaaaaaaa-0000-0000-0000-000000000003',
    'the new row must name the exact printing sleeved, not some other printing of the same card';
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- 23. Migration 42: the cards indexes the sync's write cost depends on.
--
-- These assert what must NOT exist as much as what must. Each dropped index
-- was carrying write cost for nothing, and cards_price_usd_idx in particular
-- is what made a price change a non-HOT update; a later migration quietly
-- recreating any of them would bring the sync's timeouts back with no other
-- signal. The trigram indexes are asserted present because card search runs
-- on them and migration 42 promised to leave them alone.
-- Falsified, each against a scratch copy of migration 42, by making the block
-- fail on exactly the assertion it names:
--   - re-adding `create index cards_price_usd_idx ... (price_usd desc nulls
--     last)`                                  -> "cards_price_usd_idx must stay dropped"
--   - declaring content_hash `not null default ''`
--                                            -> "content_hash must be nullable"
--   - declaring it `varchar(60)` (not text)  -> "must exist as text"
--   - adding `create index on public.cards (content_hash)`
--                                            -> "must not be indexed"
-- Same method for the other index assertions: recreate each dropped index, and
-- drop each surviving one, and the matching message fires.
-- ---------------------------------------------------------------------------
do $$
declare col record;
begin
  assert not exists (select 1 from pg_indexes where schemaname = 'public'
                      and indexname = 'cards_price_usd_idx'),
    'cards_price_usd_idx must stay dropped: it makes every price update non-HOT';
  assert not exists (select 1 from pg_indexes where schemaname = 'public'
                      and indexname = 'cards_name_lower_idx'),
    'cards_name_lower_idx must stay dropped: nothing filters on lower(name)';
  assert not exists (select 1 from pg_indexes where schemaname = 'public'
                      and indexname = 'cards_set_code_number_idx'),
    'cards_set_code_number_idx must stay dropped: duplicate of cards_set_collector_idx';

  assert exists (select 1 from pg_indexes where schemaname = 'public'
                  and indexname = 'cards_set_collector_idx'),
    'cards_set_collector_idx is the surviving (set_code, collector_number) index';
  assert exists (select 1 from pg_indexes where schemaname = 'public'
                  and indexname = 'cards_name_idx'),
    'cards_name_idx serves the exact-name lookups in import and printings';
  assert (select count(*) from pg_indexes where schemaname = 'public'
             and indexname in ('cards_name_trgm_idx', 'cards_type_line_trgm_idx',
                               'cards_oracle_text_trgm_idx')) = 3,
    'the three trigram search indexes must be left in place';

  select data_type, is_nullable into col from information_schema.columns
   where table_schema = 'public' and table_name = 'cards' and column_name = 'content_hash';
  assert col.data_type = 'text', 'cards.content_hash must exist as text';
  assert col.is_nullable = 'YES',
    'cards.content_hash must be nullable: null means never fingerprinted, so the sync rewrites the row';

  -- Any index touching content_hash would put the write cost straight back.
  assert not exists (
    select 1 from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
     where i.indrelid = 'public.cards'::regclass and a.attname = 'content_hash'),
    'cards.content_hash must not be indexed';
end $$;

-- ---------------------------------------------------------------------------
-- 24. Migration 42: prices_as_of(), the one window into scryfall_sync_runs.
--
-- The table stays unreadable to end users (RLS on, no policies); this function
-- is SECURITY DEFINER and so is exactly the kind of thing that must not leak.
-- Asserts: a signed-in user gets the finished_at of the newest SUCCEEDED run
-- (not a newer skipped, failed or running one), still sees zero rows if they
-- select from the table directly, and anon cannot call it at all. The catalog
-- bookkeeping columns default to "nothing needed, nothing published".
-- Falsified against scratch copies of migration 42 by, in turn: granting
-- execute to anon, dropping the `revoke ... from public, anon` line, removing
-- the status filter, and adding a select policy on scryfall_sync_runs.
-- ---------------------------------------------------------------------------
begin;

insert into public.scryfall_sync_runs (bulk_type, status, started_at, finished_at) values
  ('default_cards', 'succeeded', '2026-09-01 09:00+00', '2026-09-01 09:20+00'),
  ('default_cards', 'succeeded', '2026-09-02 09:00+00', '2026-09-02 09:25+00'),
  ('default_cards', 'skipped',   '2026-09-03 09:00+00', '2026-09-03 09:00+00'),
  ('default_cards', 'failed',    '2026-09-04 09:00+00', '2026-09-04 09:10+00'),
  ('default_cards', 'running',   '2026-09-05 09:00+00', null);

do $$
declare got timestamptz; visible int; needs boolean; published timestamptz;
begin
  select catalog_needs_publish, catalog_published_at into needs, published
    from public.scryfall_sync_runs order by id limit 1;
  assert needs = false and published is null,
    'a new run must default to catalog_needs_publish = false, catalog_published_at null';

  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;

  got := public.prices_as_of();
  assert got = '2026-09-02 09:25+00',
    'prices_as_of() must return the newest SUCCEEDED run finished_at, not a later skipped/failed/running one (got '
    || coalesce(got::text, 'null') || ')';

  select count(*) into visible from public.scryfall_sync_runs;
  assert visible = 0,
    'a signed-in user must still see no rows of scryfall_sync_runs directly (saw ' || visible || ')';

  reset role;
end $$;

do $$
begin
  set local role anon;
  begin
    perform public.prices_as_of();
    reset role;
    raise exception 'anon must not be able to execute prices_as_of()';
  exception when insufficient_privilege then
    reset role;
  end;
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- 25. Migrations 43 + 44: oracle_cards is read-only to every client, and
-- scryfall_loader can write exactly what the loader needs and nothing more.
--
-- Three separate claims, tested separately because each has a way of being
-- silently untrue:
--
--   a. No client role can write oracle_cards. Checked as PRIVILEGES as well as
--      behaviour: this schema's default privileges hand every new table to
--      anon/authenticated/service_role, so with the migration's `revoke all`
--      missing, RLS (no write policy) still blocks the write and a purely
--      behavioural test stays green. The privilege check is what catches that.
--   b. scryfall_loader can really write, under RLS. It has no BYPASSRLS, so a
--      grant without policies yields "permission granted, zero rows", and an
--      ON CONFLICT DO UPDATE needs select + insert + update policies at once.
--      Rowcounts are asserted, not just the absence of an error.
--   c. It can do nothing else: no delete or truncate, no user tables, and the
--      role is NOLOGIN, not superuser and not BYPASSRLS as shipped.
--
-- FALSIFICATION: the sabotages actually run against scratch copies of
-- migrations 43/44 are recorded in the commit that added this section, each
-- with the assertion it tripped.
-- ---------------------------------------------------------------------------
begin;

-- Runs one statement as a role. True if it was refused (insufficient_privilege
-- covers both "permission denied" and "violates row-level security"), false if
-- it ran. Anything else it raises propagates, so a typo cannot pass as a denial.
create function pg_temp.denied(as_role text, stmt text) returns boolean
language plpgsql as $f$
begin
  execute format('set local role %I', as_role);
  begin
    execute stmt;
  exception when insufficient_privilege then
    reset role;
    return true;
  end;
  reset role;
  return false;
end $f$;

-- Runs one statement as a role and returns how many rows it touched, so a
-- policy that silently filters everything shows up as 0 instead of as success.
create function pg_temp.rows_affected(as_role text, stmt text) returns bigint
language plpgsql as $f$
declare n bigint;
begin
  execute format('set local role %I', as_role);
  execute stmt;
  get diagnostics n = row_count;
  reset role;
  return n;
end $f$;

insert into public.oracle_cards (oracle_id, name, type_line, oracle_text, content_hash)
values ('cccccccc-0000-0000-0000-000000000001', 'Lightning Bolt', 'Instant',
        'Lightning Bolt deals 3 damage to any target.', 'seed');

-- A printings run the loader must not be able to see, change or imitate.
insert into public.scryfall_sync_runs (bulk_type, status, finished_at, catalog_needs_publish)
values ('default_cards', 'succeeded', '2026-09-01 09:20+00', true);

-- a. Clients ---------------------------------------------------------------
do $$
declare r text; p text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    foreach p in array array['insert', 'update', 'delete', 'truncate'] loop
      assert not has_table_privilege(r, 'public.oracle_cards', p),
        r || ' must not hold ' || p || ' on oracle_cards (the revoke in migration 43 is what removes the schema default; service_role is included on purpose, since the printings sync never writes oracle_cards)';
    end loop;
  end loop;

  assert has_table_privilege('anon', 'public.oracle_cards', 'select')
     and has_table_privilege('authenticated', 'public.oracle_cards', 'select'),
    'oracle_cards must stay readable by anon and authenticated';

  assert (select relrowsecurity from pg_class where oid = 'public.oracle_cards'::regclass),
    'oracle_cards must have row level security on';

  -- Only the loader may have a policy that is not a select.
  assert not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'oracle_cards'
       and cmd <> 'SELECT' and roles <> array['scryfall_loader']::name[]),
    'no client role may have a write policy on oracle_cards';
end $$;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    assert pg_temp.denied(r, $q$insert into public.oracle_cards (oracle_id, name, content_hash)
                                values ('cccccccc-0000-0000-0000-0000000000ff', 'X', 'x')$q$),
      r || ' must not be able to insert into oracle_cards';
    assert pg_temp.denied(r, $q$update public.oracle_cards set name = 'Hacked'$q$),
      r || ' must not be able to update oracle_cards';
    assert pg_temp.denied(r, $q$delete from public.oracle_cards$q$),
      r || ' must not be able to delete from oracle_cards';
  end loop;

  assert pg_temp.rows_affected('anon', 'select * from public.oracle_cards') = 1
     and pg_temp.rows_affected('authenticated', 'select * from public.oracle_cards') = 1,
    'anon and authenticated must be able to read oracle_cards';
end $$;

-- b. The loader works under RLS ---------------------------------------------
do $$
begin
  -- A brand-new oracle id, and a conflicting one: the statement shape the
  -- loader runs, which needs select, insert and update policies together.
  assert pg_temp.rows_affected('scryfall_loader', $q$
    insert into public.oracle_cards (oracle_id, name, type_line, legalities, content_hash)
    values ('cccccccc-0000-0000-0000-000000000002', 'Counterspell', 'Instant',
            '{"legacy":"legal","vintage":"restricted"}', 'h2')
    on conflict (oracle_id) do update set name = excluded.name, content_hash = excluded.content_hash
  $q$) = 1, 'the loader must be able to INSERT into oracle_cards under RLS (insert policy)';

  assert pg_temp.rows_affected('scryfall_loader', $q$
    insert into public.oracle_cards (oracle_id, name, type_line, content_hash)
    values ('cccccccc-0000-0000-0000-000000000001', 'Lightning Bolt', 'Instant', 'seed-2')
    on conflict (oracle_id) do update set content_hash = excluded.content_hash, updated_at = now()
  $q$) = 1, 'the loader must be able to UPDATE an existing oracle_cards row via ON CONFLICT (update + select policies)';

  assert (select content_hash from public.oracle_cards
           where oracle_id = 'cccccccc-0000-0000-0000-000000000001') = 'seed-2',
    'the loader''s upsert must actually have changed the row';

  -- The staging table the loader builds is `like` the real one, in the session.
  assert not has_schema_privilege('scryfall_loader', 'public', 'create'),
    'the loader must not be able to create objects in public';
  assert not pg_temp.denied('scryfall_loader',
    'create temp table oracle_stage (like public.oracle_cards including defaults)'),
    'the loader must be able to create its temp staging table';
end $$;

do $$
begin
  -- The run record: open, then close, on the identity column with no sequence grant.
  assert pg_temp.rows_affected('scryfall_loader', $q$
    insert into public.scryfall_sync_runs (bulk_type, status) values ('oracle_cards', 'running')
  $q$) = 1, 'the loader must be able to open a sync run (and use the identity column without a sequence grant)';
  assert pg_temp.rows_affected('scryfall_loader', $q$
    update public.scryfall_sync_runs set status = 'succeeded', finished_at = now()
     where bulk_type = 'oracle_cards' and status = 'running'
  $q$) = 1, 'the loader must be able to close its sync run (update policy)';
  assert pg_temp.rows_affected('scryfall_loader', $q$
    select 1 from public.scryfall_sync_runs where bulk_type = 'oracle_cards'
  $q$) = 1, 'the loader must be able to read sync runs (select policy)';
end $$;

-- c. ...and nothing else ----------------------------------------------------
do $$
declare t text;
begin
  -- `cards` is not the oracle loader's: the printings load still goes through
  -- PostgREST, and moving it to COPY adds its own grants in its own migration.
  assert pg_temp.denied('scryfall_loader', 'select 1 from public.cards limit 1'),
    'the loader must not be able to read cards';
  assert pg_temp.denied('scryfall_loader', $q$
    insert into public.cards (scryfall_id, oracle_id, name, set_code, collector_number,
                              available_finishes, lang)
    values ('aaaaaaaa-0000-0000-0000-0000000000c1', 'cccccccc-0000-0000-0000-000000000001',
            'Lightning Bolt', 'tst', '1', '{nonfoil}', 'en')$q$),
    'the loader must not be able to insert into cards';
  assert pg_temp.denied('scryfall_loader', $q$update public.cards set name = 'x'$q$),
    'the loader must not be able to update cards';

  -- Run history: the loader can write oracle_cards rows and nothing that
  -- reaches the printings sync or the catalog publish.
  assert pg_temp.denied('scryfall_loader', $q$
    insert into public.scryfall_sync_runs (bulk_type, status, finished_at)
    values ('default_cards', 'succeeded', now())$q$),
    'the loader must not be able to forge a default_cards run';
  assert pg_temp.denied('scryfall_loader', $q$
    insert into public.scryfall_sync_runs (bulk_type, status, catalog_needs_publish)
    values ('oracle_cards', 'succeeded', true)$q$),
    'the loader must not be able to set catalog_needs_publish';
  assert pg_temp.denied('scryfall_loader', $q$
    insert into public.scryfall_sync_runs (bulk_type, status, catalog_published_at)
    values ('oracle_cards', 'succeeded', now())$q$),
    'the loader must not be able to set catalog_published_at on insert';
  assert pg_temp.denied('scryfall_loader', $q$
    update public.scryfall_sync_runs set catalog_published_at = now() where bulk_type = 'oracle_cards'$q$),
    'the loader must not be able to stamp catalog_published_at';
  assert pg_temp.denied('scryfall_loader', $q$
    update public.scryfall_sync_runs set bulk_type = 'default_cards' where bulk_type = 'oracle_cards'$q$),
    'the loader must not be able to rewrite a run into another bulk_type';
  assert pg_temp.rows_affected('scryfall_loader', $q$
    select 1 from public.scryfall_sync_runs where bulk_type = 'default_cards'$q$) = 0,
    'the loader must not be able to see printings runs';
  assert pg_temp.rows_affected('scryfall_loader', $q$
    update public.scryfall_sync_runs set status = 'failed'$q$) = 1,
    'an unconditional loader update must reach only the oracle_cards run, never the printings run (UPDATE policy USING; no WHERE, so the select policy is not what hides it)';
  assert (select status from public.scryfall_sync_runs where bulk_type = 'default_cards') = 'succeeded',
    'the printings run must be untouched';

  assert pg_temp.denied('scryfall_loader', 'delete from public.oracle_cards'),
    'the loader must not be able to delete from oracle_cards';
  assert pg_temp.denied('scryfall_loader', 'delete from public.cards'),
    'the loader must not be able to delete from cards';
  assert pg_temp.denied('scryfall_loader', 'delete from public.scryfall_sync_runs'),
    'the loader must not be able to delete from scryfall_sync_runs';
  assert pg_temp.denied('scryfall_loader', 'truncate public.oracle_cards'),
    'the loader must not be able to truncate oracle_cards';
  assert pg_temp.denied('scryfall_loader', 'truncate public.cards'),
    'the loader must not be able to truncate cards';

  -- No user data at all, and no ownership history.
  foreach t in array array['card_instances', 'locations', 'profiles', 'trades',
                           'trade_items', 'ownership_history', 'want_list', 'friendships',
                           'deck_cards', 'feedback', 'notifications'] loop
    assert pg_temp.denied('scryfall_loader', format('select * from public.%I', t)),
      'the loader must not be able to read public.' || t;
  end loop;
  assert pg_temp.denied('scryfall_loader', 'select * from auth.users'),
    'the loader must not be able to read auth.users';
  assert pg_temp.denied('scryfall_loader',
    $q$insert into public.profiles (id, username) values (gen_random_uuid(), 'nope')$q$),
    'the loader must not be able to write profiles';

  -- The role as shipped: cannot log in until the owner enables it by hand,
  -- and carries no attribute that would make its grants beside the point.
  assert (select not rolcanlogin from pg_roles where rolname = 'scryfall_loader'),
    'scryfall_loader must be created NOLOGIN: the owner enables it, the migration never does';
  assert (select not rolsuper and not rolbypassrls and not rolcreaterole and not rolcreatedb
            from pg_roles where rolname = 'scryfall_loader'),
    'scryfall_loader must not be superuser, bypassrls, createrole or createdb';
  assert not exists (
    select 1 from pg_auth_members m
     where m.member = 'scryfall_loader'::regrole),
    'scryfall_loader must not be a member of any role (that would inherit its grants)';
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- 26. Migration 45: prices_as_of() ignores every run that is not a printings run.
--
-- The oracle loader records runs in the same table. Without the bulk_type
-- filter, a night where the printings sync failed but the oracle load
-- succeeded would report today as "prices as of". The oracle run below is
-- deliberately NEWER than the default_cards one.
-- Falsified against a scratch copy of migration 45 with the
-- `r.bulk_type = 'default_cards'` line removed: the assertion below fails.
-- ---------------------------------------------------------------------------
begin;

insert into auth.users (id, email, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111', 'alice26@example.com', '{"username":"alice26"}');

insert into public.scryfall_sync_runs (bulk_type, status, started_at, finished_at) values
  ('default_cards', 'succeeded', '2026-09-01 09:00+00', '2026-09-01 09:20+00'),
  ('oracle_cards',  'succeeded', '2026-09-02 09:00+00', '2026-09-02 09:05+00');

do $$
declare got timestamptz;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;
  got := public.prices_as_of();
  reset role;
  assert got = '2026-09-01 09:20+00',
    'prices_as_of() must return the newest succeeded default_cards run, not a newer oracle_cards one (got '
    || coalesce(got::text, 'null') || ')';
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- 27. Migration 46: playtest_sessions is owner-only, tied to the owner's OWN
--     deck, bounded, and cannot be moved or read by anyone else.
--
-- The threat this section exists for: migration 35 makes a friend's PUBLIC
-- deck readable to friends, so bob can see alice's deck_id. A plain foreign key
-- only checks the deck EXISTS, so without migration 46's trigger bob could
-- save a "game" against alice's deck. Nothing about deck visibility may imply
-- session access, in either direction.
--
--   a. alice can insert, read, rename and delete her own session
--   b. bob (alice's accepted friend, public deck visible) sees NONE of them
--   c. bob inserting owner=bob deck=alice's public deck is a CHECK violation
--   d. bob inserting owner=alice is an RLS refusal; against a private deck it
--      is refused as "does not exist"
--   e. bob's update and delete of alice's row touch zero rows (verified as alice)
--   f. alice cannot save against her own binder (type <> 'deck')
--   g. deck_id / owner_user_id cannot be changed by a client (column grants)
--   h. a 300KB snapshot is refused; the cap is on text length
--   i. schema_version / fingerprint must match the snapshot (incl. a missing key)
--   j. the 11th save on one deck and the 31st for one user are refused
--   k. deleting a deck (and an account) removes its sessions, and only its own
--   l. anon gets a permission error, not an empty result
--   m. grants are exactly as written: service_role has nothing
--
-- FALSIFICATION. Every assertion was proved capable of failing by breaking the
-- migration in the way named and re-running (each run failed on the stated
-- assertion, and the suite was green again once restored):
--   a  drop `grant select, insert, delete` -> (a) "alice must be able to insert"
--   b  add a friend-read policy (using are_friends(...)) -> (b) "saw 1"
--   c  remove the `deck_owner <> new.owner_user_id` test -> (c) "must be refused"
--   d  `with check (true)` on the insert policy -> (d) "owner=alice must be refused"
--   e  `using (true)` on the delete policy ALONE passes, by design: a row you
--      cannot SELECT cannot be deleted either, so two policies guard it. With
--      both the select and delete policies loosened and block (b) (which trips
--      first) cut from a scratch copy of this file, (e) fails with "touched 1"
--   f  remove the `deck_type <> 'deck'` test -> (f) "binder must be refused"
--   g  `grant update on public.playtest_sessions` (all columns) -> (g) "deck_id"
--   h  drop constraint playtest_sessions_snapshot_size -> (h) "300KB"
--   i  drop constraint playtest_sessions_version_matches -> (i) "version mismatch"
--   j  drop trigger playtest_sessions_enforce_quota -> (j) "11th"
--   k  deck_id FK `on delete restrict` -> (k) the deck delete raises
--   l  `grant select ... to anon` -> (l) "anon must be refused"
--   m  `grant select ... to service_role` -> (m) "service_role"
-- ---------------------------------------------------------------------------
begin;

create function pg_temp.attempt(uid uuid, role_name text, stmt text) returns text
language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute format('set local role %I', role_name);
  begin
    execute stmt;
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'ok';
end $f$;

create function pg_temp.touched(uid uuid, role_name text, stmt text) returns bigint
language plpgsql as $f$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute format('set local role %I', role_name);
  execute stmt;
  get diagnostics n = row_count;
  reset role;
  return n;
end $f$;

create function pg_temp.snap(fp text default repeat('a', 64), ver int default 2, pad int default 0) returns jsonb
language sql as $f$
  select jsonb_build_object('schemaVersion', ver, 'source', jsonb_build_object('fingerprint', fp), 'pad', repeat('x', pad));
$f$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a2700000-0000-0000-0000-000000000001', 'alice27@example.com', '{"username":"alice27"}'),
  ('a2700000-0000-0000-0000-000000000002', 'bob27@example.com',   '{"username":"bob27"}'),
  ('a2700000-0000-0000-0000-000000000003', 'carol27@example.com', '{"username":"carol27"}');

insert into public.friendships (requester_id, addressee_id, status) values
  ('a2700000-0000-0000-0000-000000000001', 'a2700000-0000-0000-0000-000000000002', 'accepted');

-- alice: a public deck, a private deck, two more decks (for the quota), a binder.
-- bob: his own deck.
insert into public.locations (id, user_id, name, type, is_public) values
  ('a2710000-0000-0000-0000-000000000001', 'a2700000-0000-0000-0000-000000000001', 'Alice public deck',  'deck',   true),
  ('a2710000-0000-0000-0000-000000000002', 'a2700000-0000-0000-0000-000000000001', 'Alice private deck', 'deck',   false),
  ('a2710000-0000-0000-0000-000000000003', 'a2700000-0000-0000-0000-000000000001', 'Alice third deck',   'deck',   false),
  ('a2710000-0000-0000-0000-000000000004', 'a2700000-0000-0000-0000-000000000001', 'Alice fourth deck',  'deck',   false),
  ('a2710000-0000-0000-0000-000000000005', 'a2700000-0000-0000-0000-000000000001', 'Alice binder',       'binder', false),
  ('a2710000-0000-0000-0000-000000000006', 'a2700000-0000-0000-0000-000000000002', 'Bob deck',           'deck',   false),
  ('a2710000-0000-0000-0000-000000000007', 'a2700000-0000-0000-0000-000000000003', 'Carol deck',         'deck',   false);

-- Sanity for the whole section: bob really can see alice's public deck (the
-- precondition that makes (c) meaningful) and really cannot see her private one.
do $$
declare seen int;
begin
  perform set_config('request.jwt.claim.sub', 'a2700000-0000-0000-0000-000000000002', true);
  set local role authenticated;
  select count(*) into seen from public.locations where id = 'a2710000-0000-0000-0000-000000000001';
  assert seen = 1, 'precondition: a friend can see a public deck (migration 35), saw ' || seen;
  select count(*) into seen from public.locations where id = 'a2710000-0000-0000-0000-000000000002';
  assert seen = 0, 'precondition: a friend cannot see a private deck, saw ' || seen;
  reset role;
end $$;

-- (a) alice's own lifecycle.
do $$
declare
  alice uuid := 'a2700000-0000-0000-0000-000000000001';
  outcome text;
  n bigint;
begin
  outcome := pg_temp.attempt(alice, 'authenticated', format(
    $q$insert into public.playtest_sessions (id, owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2720000-0000-0000-0000-000000000001', %L, 'a2710000-0000-0000-0000-000000000001', 'My first save', 2, %L, %L, '{"turn":3}')$q$,
    alice, repeat('a', 64), pg_temp.snap()::text));
  assert outcome = 'ok', 'alice must be able to insert her own session, got ' || outcome;

  n := pg_temp.touched(alice, 'authenticated', $q$select * from public.playtest_sessions where id = 'a2720000-0000-0000-0000-000000000001'$q$);
  assert n = 1, 'alice must read her own session, saw ' || n;

  n := pg_temp.touched(alice, 'authenticated', $q$update public.playtest_sessions set title = 'Renamed' where id = 'a2720000-0000-0000-0000-000000000001'$q$);
  assert n = 1, 'alice must be able to rename her own session, touched ' || n;
  assert (select title from public.playtest_sessions where id = 'a2720000-0000-0000-0000-000000000001') = 'Renamed', 'the rename must stick';

  -- Overwrite: the five updatable columns together.
  n := pg_temp.touched(alice, 'authenticated', format(
    $q$update public.playtest_sessions set snapshot = %L, source_fingerprint = %L, schema_version = 2, preview = '{"turn":9}' where id = 'a2720000-0000-0000-0000-000000000001'$q$,
    pg_temp.snap(repeat('b', 64))::text, repeat('b', 64)));
  assert n = 1, 'alice must be able to overwrite her own session, touched ' || n;
end $$;

-- A session for bob too, on his own deck, so (e)/(k) have a bystander.
insert into public.playtest_sessions (id, owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
values ('a2720000-0000-0000-0000-000000000002', 'a2700000-0000-0000-0000-000000000002', 'a2710000-0000-0000-0000-000000000006',
        'Bob save', 2, repeat('c', 64), pg_temp.snap(repeat('c', 64)), '{"turn":1}');

-- (b) bob is alice's friend and can see her public deck: he sees no sessions.
do $$
declare n bigint;
begin
  n := pg_temp.touched('a2700000-0000-0000-0000-000000000002', 'authenticated',
    $q$select * from public.playtest_sessions where owner_user_id = 'a2700000-0000-0000-0000-000000000001'$q$);
  assert n = 0, 'a friend must see none of alice''s sessions, saw ' || n;
  n := pg_temp.touched('a2700000-0000-0000-0000-000000000002', 'authenticated',
    $q$select * from public.playtest_sessions where deck_id = 'a2710000-0000-0000-0000-000000000001'$q$);
  assert n = 0, 'a public deck must not expose the sessions saved against it, saw ' || n;
  n := pg_temp.touched('a2700000-0000-0000-0000-000000000003', 'authenticated', $q$select * from public.playtest_sessions$q$);
  assert n = 0, 'a stranger must see no sessions at all, saw ' || n;
  n := pg_temp.touched('a2700000-0000-0000-0000-000000000002', 'authenticated', $q$select * from public.playtest_sessions$q$);
  assert n = 1, 'bob must see exactly his own session, saw ' || n;
end $$;

-- (c) THE KEY ASSERTION: bob saving against alice's public deck.
do $$
declare outcome text;
begin
  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000002', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000002', 'a2710000-0000-0000-0000-000000000001', 'sneaky', 2, %L, %L, '{}')$q$,
    repeat('a', 64), pg_temp.snap()::text));
  assert outcome = '23514', 'a friend saving against alice''s public deck must be refused as a check violation, got ' || outcome;
end $$;

-- (d) owner=alice from bob's session: RLS refuses. A private deck: not visible.
do $$
declare outcome text;
begin
  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000002', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000001', 'forged', 2, %L, %L, '{}')$q$,
    repeat('a', 64), pg_temp.snap()::text));
  assert outcome = '42501', 'inserting with owner=alice as bob must be refused (owner=alice must be refused), got ' || outcome;

  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000002', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000002', 'a2710000-0000-0000-0000-000000000002', 'private?', 2, %L, %L, '{}')$q$,
    repeat('a', 64), pg_temp.snap()::text));
  assert outcome = '23503', 'a deck the caller cannot see is refused as nonexistent, got ' || outcome;
end $$;

-- (e) bob cannot change or delete alice's row; verified as alice afterwards.
do $$
declare n bigint;
begin
  n := pg_temp.touched('a2700000-0000-0000-0000-000000000002', 'authenticated',
    $q$update public.playtest_sessions set title = 'hijacked' where id = 'a2720000-0000-0000-0000-000000000001'$q$);
  assert n = 0, 'a friend''s update of alice''s session must touch 0 rows, touched ' || n;
  n := pg_temp.touched('a2700000-0000-0000-0000-000000000002', 'authenticated',
    $q$delete from public.playtest_sessions where id = 'a2720000-0000-0000-0000-000000000001'$q$);
  assert n = 0, 'a friend''s delete of alice''s session must touch 0 rows, touched ' || n;
  n := pg_temp.touched('a2700000-0000-0000-0000-000000000001', 'authenticated',
    $q$select * from public.playtest_sessions where id = 'a2720000-0000-0000-0000-000000000001' and title = 'Renamed'$q$);
  assert n = 1, 'alice''s session must be exactly as she left it, saw ' || n;
end $$;

-- (f) alice cannot save against her own binder.
do $$
declare outcome text;
begin
  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000005', 'binder', 2, %L, %L, '{}')$q$,
    repeat('a', 64), pg_temp.snap()::text));
  assert outcome = '23514', 'a save against a binder must be refused (binder must be refused), got ' || outcome;
end $$;

-- (g) deck_id and owner_user_id are immutable to a client.
do $$
declare outcome text;
begin
  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000001', 'authenticated',
    $q$update public.playtest_sessions set deck_id = 'a2710000-0000-0000-0000-000000000002' where id = 'a2720000-0000-0000-0000-000000000001'$q$);
  assert outcome = '42501', 'moving a session to another deck must be a permission error (deck_id), got ' || outcome;
  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000001', 'authenticated',
    $q$update public.playtest_sessions set owner_user_id = 'a2700000-0000-0000-0000-000000000002' where id = 'a2720000-0000-0000-0000-000000000001'$q$);
  assert outcome = '42501', 'giving a session away must be a permission error (owner_user_id), got ' || outcome;
  assert not has_column_privilege('authenticated', 'public.playtest_sessions', 'deck_id', 'UPDATE'), 'deck_id must not be updatable';
  assert not has_column_privilege('authenticated', 'public.playtest_sessions', 'owner_user_id', 'UPDATE'), 'owner_user_id must not be updatable';
  assert has_column_privilege('authenticated', 'public.playtest_sessions', 'title', 'UPDATE'), 'title must be updatable';
end $$;

-- (h) size: 300KB refused, a large-but-legal snapshot accepted.
do $$
declare outcome text;
begin
  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000003', 'huge', 2, %L, %L, '{}')$q$,
    repeat('a', 64), pg_temp.snap(pad => 300000)::text));
  assert outcome = '23514', 'a 300KB snapshot must be refused (300KB), got ' || outcome;
  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_sessions (id, owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2720000-0000-0000-0000-000000000009', 'a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000003', 'big but legal', 2, %L, %L, '{}')$q$,
    repeat('a', 64), pg_temp.snap(pad => 200000)::text));
  assert outcome = 'ok', 'a 200KB snapshot is within the cap, got ' || outcome;
  delete from public.playtest_sessions where id = 'a2720000-0000-0000-0000-000000000009';

  -- A repetitive blob compresses tiny in storage but is still 300KB of text:
  -- the cap is on text length, which is why pg_column_size is not used.
  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000003', 'compressible', 2, %L, %L, %L)$q$,
    repeat('a', 64), pg_temp.snap(pad => 900000)::text, jsonb_build_object('p', 'p')::text));
  assert outcome = '23514', 'a compressible oversize snapshot must still be refused, got ' || outcome;

  -- The preview has its own 2KB cap.
  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000003', 'pv', 2, %L, %L, %L)$q$,
    repeat('a', 64), pg_temp.snap()::text, jsonb_build_object('p', repeat('p', 5000))::text));
  assert outcome = '23514', 'an oversize preview must be refused, got ' || outcome;
end $$;

-- (i) the columns must agree with the blob.
do $$
declare outcome text;
begin
  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000003', 'v', 3, %L, %L, '{}')$q$,
    repeat('a', 64), pg_temp.snap(ver => 2)::text));
  assert outcome = '23514', 'a schema_version that differs from the snapshot must be refused (version mismatch), got ' || outcome;

  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000003', 'v', 2, %L, %L, '{}')$q$,
    repeat('b', 64), pg_temp.snap(fp => repeat('a', 64))::text));
  assert outcome = '23514', 'a fingerprint that differs from the snapshot must be refused, got ' || outcome;

  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000003', 'v', 2, %L, '{"source":{"fingerprint":"%s"}}', '{}')$q$,
    repeat('a', 64), repeat('a', 64)));
  assert outcome = '23514', 'a snapshot MISSING schemaVersion must be refused (a NULL comparison must not pass), got ' || outcome;

  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000003', 'v', 2, %L, '{"schemaVersion":"2","source":{"fingerprint":"%s"}}', '{}')$q$,
    repeat('a', 64), repeat('a', 64)));
  assert outcome = '23514', 'a string schemaVersion must be a check violation and not a cast error, got ' || outcome;

  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000003', '   ', 2, %L, %L, '{}')$q$,
    repeat('a', 64), pg_temp.snap()::text));
  assert outcome = '23514', 'a blank title must be refused, got ' || outcome;
  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000003', %L, 2, %L, %L, '{}')$q$,
    repeat('t', 101), repeat('a', 64), pg_temp.snap()::text));
  assert outcome = '23514', 'a 101-character title must be refused, got ' || outcome;
end $$;

-- (j) quotas: 10 per deck, 30 per user. Seeded as the table owner (the quota
--     trigger fires for everyone), then the next insert is tried as alice.
insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
select 'a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000002', 'q' || g, 2, repeat('a', 64), pg_temp.snap(), '{}'
  from generate_series(1, 10) g;

do $$
declare outcome text;
begin
  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000002', 'the 11th', 2, %L, %L, '{}')$q$,
    repeat('a', 64), pg_temp.snap()::text));
  assert outcome = '23514', 'the 11th session on one deck must be refused (11th), got ' || outcome;
end $$;

-- alice now has 1 (public deck, from (a)) + 10 (private deck). Fill the third
-- and fourth decks to reach 30, then the 31st must be refused for the USER cap.
insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
select 'a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000003', 'r' || g, 2, repeat('a', 64), pg_temp.snap(), '{}'
  from generate_series(1, 10) g;
insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
select 'a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000004', 's' || g, 2, repeat('a', 64), pg_temp.snap(), '{}'
  from generate_series(1, 9) g;

do $$
declare
  outcome text;
  msg text;
begin
  assert (select count(*) from public.playtest_sessions where owner_user_id = 'a2700000-0000-0000-0000-000000000001') = 30, 'alice should be at exactly 30';
  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000001', 'the 31st', 2, %L, %L, '{}')$q$,
    repeat('a', 64), pg_temp.snap()::text));
  assert outcome = '23514', 'the 31st session for one user must be refused (31st), got ' || outcome;

  begin
    insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
    values ('a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000001', 'x', 2, repeat('a', 64), pg_temp.snap(), '{}');
  exception when check_violation then
    get stacked diagnostics msg = message_text;
    assert msg like 'playtest_sessions_quota_user%', 'the message must carry the fixed prefix errors.ts maps, got ' || msg;
  end;

  -- Another user is not affected by alice's quota.
  outcome := pg_temp.attempt('a2700000-0000-0000-0000-000000000003', 'authenticated', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000003', 'a2710000-0000-0000-0000-000000000007', 'carol ok', 2, %L, %L, '{}')$q$,
    repeat('a', 64), pg_temp.snap()::text));
  assert outcome = 'ok', 'carol must be unaffected by alice''s quota, got ' || outcome;
end $$;

-- (k) deleting a deck removes its sessions and only its own; so does an account.
do $$
declare before_count bigint;
begin
  before_count := (select count(*) from public.playtest_sessions where owner_user_id = 'a2700000-0000-0000-0000-000000000001');
  delete from public.locations where id = 'a2710000-0000-0000-0000-000000000004';
  assert (select count(*) from public.playtest_sessions where deck_id = 'a2710000-0000-0000-0000-000000000004') = 0,
    'deleting a deck must delete its sessions';
  assert (select count(*) from public.playtest_sessions where owner_user_id = 'a2700000-0000-0000-0000-000000000001') = before_count - 9,
    'only that deck''s sessions may go';
  assert (select count(*) from public.playtest_sessions where id = 'a2720000-0000-0000-0000-000000000002') = 1,
    'bob''s session on his own deck must survive alice''s deck deletion';

  delete from auth.users where id = 'a2700000-0000-0000-0000-000000000003';
  assert (select count(*) from public.playtest_sessions where owner_user_id = 'a2700000-0000-0000-0000-000000000003') = 0,
    'deleting an account must delete its sessions';
end $$;

-- (l) anon: a permission error, not an empty result.
do $$
declare outcome text;
begin
  outcome := pg_temp.attempt(null, 'anon', $q$select * from public.playtest_sessions$q$);
  assert outcome = '42501', 'anon must be refused with a permission error (anon must be refused), got ' || outcome;
  outcome := pg_temp.attempt(null, 'anon', format(
    $q$insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
       values ('a2700000-0000-0000-0000-000000000001', 'a2710000-0000-0000-0000-000000000001', 'anon', 2, %L, %L, '{}')$q$,
    repeat('a', 64), pg_temp.snap()::text));
  assert outcome = '42501', 'anon insert must be refused, got ' || outcome;
end $$;

-- (m) the grants are exactly as written.
do $$
begin
  assert not has_table_privilege('service_role', 'public.playtest_sessions', 'SELECT'), 'service_role must have no SELECT on playtest_sessions (service_role)';
  assert not has_table_privilege('service_role', 'public.playtest_sessions', 'INSERT'), 'service_role must have no INSERT on playtest_sessions';
  assert not has_table_privilege('anon', 'public.playtest_sessions', 'SELECT'), 'anon must have no SELECT on playtest_sessions';
  assert has_table_privilege('authenticated', 'public.playtest_sessions', 'SELECT')
     and has_table_privilege('authenticated', 'public.playtest_sessions', 'INSERT')
     and has_table_privilege('authenticated', 'public.playtest_sessions', 'DELETE'), 'authenticated keeps select, insert and delete';
  assert (select relrowsecurity from pg_class where oid = 'public.playtest_sessions'::regclass), 'RLS must be on';
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- 28. Migration 47: playtest_shares is readable by signed-in link holders only,
--     through one narrow function, and never exposes an owner or a deck.
--
-- The owner chose "signed-in users with the link" (option B) over an open
-- link. What that means mechanically, and what this section pins:
--
--   a. a client cannot choose its own token: supplying one is a permission error
--   b. anon cannot select the table, and cannot call get_playtest_share()
--   c. a signed-in non-owner with a valid token gets the projection, and the
--      result has EXACTLY the keys title / projection / updatedAt / expiresAt
--      (no owner_user_id, no deck_id, no token, no username)
--   d. an expired share returns null
--   e. a revoked (deleted) share returns null
--   f. malformed tokens return null and cannot be used to inject
--   g. bob (alice's friend, her public deck visible) cannot create a share
--      against it, and cannot read or enumerate her shares
--   h. oversize projection, expiry beyond 90 days and a version mismatch are
--      check violations
--   i. 10 unexpired shares per user; expired ones do not count
--   j. deleting a deck or an account removes its shares
--   k. deck_id / token / owner are immutable to a client, and the owner can
--      still edit title, projection and expiry
--   l. the function is SECURITY DEFINER with an empty search_path, and its
--      execute grant is authenticated-only (nobody via PUBLIC, anon or
--      service_role)
--
-- FALSIFICATION. Each assertion was proved capable of failing by breaking the
-- migration as named and re-running (it failed on the stated assertion; green
-- again once restored):
--   a  add `token` to the insert grant -> (a) "supplying a token"
--   b1 `grant select ... to anon` -> (b) "anon must be refused" on the table
--   b2 `grant execute ... to anon` -> (b) "anon must not be able to call"
--   c  return `to_jsonb(s)` (the whole row) -> (c) the key-set assertion
--   d  drop `and s.expires_at > now()` -> (d) "expired"
--   e  n/a as a break: (e) fails if the function ever caches or ignores deletes
--   g  remove the `deck_owner <> new.owner_user_id` test -> (g) "must be refused"
--   h  drop constraint playtest_shares_projection_size -> (h) "oversize"
--      drop constraint playtest_shares_expiry_cap -> (h) "91 days"
--   i  drop trigger playtest_shares_enforce_quota -> (i) "11th"
--   j  deck_id FK `on delete restrict` -> (j) the deck delete raises
--   k  `grant update on public.playtest_shares` (all columns) -> (k) "token"
--   l  drop `security definer` / `set search_path` / re-grant to public -> (l)
-- ---------------------------------------------------------------------------
begin;

create function pg_temp.attempt(uid uuid, role_name text, stmt text) returns text
language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute format('set local role %I', role_name);
  begin
    execute stmt;
  exception when others then
    reset role;
    return sqlstate;
  end;
  reset role;
  return 'ok';
end $f$;

create function pg_temp.touched(uid uuid, role_name text, stmt text) returns bigint
language plpgsql as $f$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute format('set local role %I', role_name);
  execute stmt;
  get diagnostics n = row_count;
  reset role;
  return n;
end $f$;

-- Reads a share as a role and returns the jsonb (or null).
create function pg_temp.read_share(uid uuid, role_name text, tok text) returns jsonb
language plpgsql as $f$
declare result jsonb;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute format('set local role %I', role_name);
  select public.get_playtest_share(tok) into result;
  reset role;
  return result;
end $f$;

create function pg_temp.proj(ver int default 1, pad int default 0) returns jsonb
language sql as $f$
  select jsonb_build_object('version', ver, 'turn', 4, 'note', repeat('x', pad));
$f$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a2800000-0000-0000-0000-000000000001', 'alice28@example.com', '{"username":"alice28"}'),
  ('a2800000-0000-0000-0000-000000000002', 'bob28@example.com',   '{"username":"bob28"}'),
  ('a2800000-0000-0000-0000-000000000003', 'carol28@example.com', '{"username":"carol28"}');

insert into public.friendships (requester_id, addressee_id, status) values
  ('a2800000-0000-0000-0000-000000000001', 'a2800000-0000-0000-0000-000000000002', 'accepted');

insert into public.locations (id, user_id, name, type, is_public) values
  ('a2810000-0000-0000-0000-000000000001', 'a2800000-0000-0000-0000-000000000001', 'Alice public deck', 'deck',   true),
  ('a2810000-0000-0000-0000-000000000002', 'a2800000-0000-0000-0000-000000000001', 'Alice second deck', 'deck',   false),
  ('a2810000-0000-0000-0000-000000000003', 'a2800000-0000-0000-0000-000000000001', 'Alice binder',      'binder', false),
  ('a2810000-0000-0000-0000-000000000004', 'a2800000-0000-0000-0000-000000000003', 'Carol deck',        'deck',   false);

-- (a) alice creates a share; the database mints the token; a supplied one is refused.
do $$
declare
  alice uuid := 'a2800000-0000-0000-0000-000000000001';
  outcome text;
  minted text;
begin
  outcome := pg_temp.attempt(alice, 'authenticated', format(
    $q$insert into public.playtest_shares (id, owner_user_id, deck_id, title, projection, projection_version)
       values ('a2820000-0000-0000-0000-000000000001', %L, 'a2810000-0000-0000-0000-000000000001', 'My table', %L, 1)$q$,
    alice, pg_temp.proj()::text));
  assert outcome = '42501', 'a client supplying its own id must be refused too (id is minted by the database), got ' || outcome;

  outcome := pg_temp.attempt(alice, 'authenticated', format(
    $q$insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version, token)
       values (%L, 'a2810000-0000-0000-0000-000000000001', 'My table', %L, 1, %L)$q$,
    alice, pg_temp.proj()::text, repeat('0', 32)));
  assert outcome = '42501', 'supplying a token must be a permission error (supplying a token), got ' || outcome;

  outcome := pg_temp.attempt(alice, 'authenticated', format(
    $q$insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version, show_hand)
       values (%L, 'a2810000-0000-0000-0000-000000000001', 'My table', %L, 1, false)$q$,
    alice, pg_temp.proj()::text));
  assert outcome = 'ok', 'alice must be able to create a share, got ' || outcome;

  select token into minted from public.playtest_shares where owner_user_id = alice;
  assert minted ~ '^[0-9a-f]{32}$', 'the database must mint a 32-hex token, got ' || coalesce(minted, 'null');
  assert (select expires_at from public.playtest_shares where owner_user_id = alice) between now() + interval '29 days' and now() + interval '31 days',
    'expiry defaults to about 30 days';
end $$;

-- Tokens are unique and random enough to differ.
insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version)
values ('a2800000-0000-0000-0000-000000000001', 'a2810000-0000-0000-0000-000000000002', 'Second', pg_temp.proj(), 1);

do $$
begin
  assert (select count(distinct token) from public.playtest_shares) = 2, 'tokens must differ';
end $$;

-- (b) anon.
do $$
declare
  outcome text;
  tok text := (select token from public.playtest_shares where title = 'My table');
begin
  outcome := pg_temp.attempt(null, 'anon', $q$select * from public.playtest_shares$q$);
  assert outcome = '42501', 'anon must be refused with a permission error on the table (anon must be refused), got ' || outcome;
  outcome := pg_temp.attempt(null, 'anon', format($q$select public.get_playtest_share(%L)$q$, tok));
  assert outcome = '42501', 'anon must not be able to call get_playtest_share (anon must not be able to call), got ' || outcome;
  outcome := pg_temp.attempt(null, 'service_role', format($q$select public.get_playtest_share(%L)$q$, tok));
  assert outcome = '42501', 'service_role must not be able to call get_playtest_share either, got ' || outcome;
end $$;

-- (c) a signed-in NON-owner with the token: bob (friend) and carol (stranger).
do $$
declare
  tok text := (select token from public.playtest_shares where title = 'My table');
  got jsonb;
  keys text[];
begin
  foreach got in array array[
    pg_temp.read_share('a2800000-0000-0000-0000-000000000002', 'authenticated', tok),
    pg_temp.read_share('a2800000-0000-0000-0000-000000000003', 'authenticated', tok),
    pg_temp.read_share('a2800000-0000-0000-0000-000000000001', 'authenticated', tok)
  ] loop
    assert got is not null, 'a signed-in reader with a valid token must get the projection';
    select array_agg(k order by k) into keys from jsonb_object_keys(got) k;
    assert keys = array['expiresAt', 'projection', 'title', 'updatedAt'],
      'the result must have exactly title/projection/updatedAt/expiresAt (no owner, deck or token), got ' || keys::text;
    assert got ->> 'title' = 'My table', 'the title comes through';
    assert (got -> 'projection' ->> 'turn') = '4', 'the projection comes through unchanged';
    assert position('a2800000' in got::text) = 0 and position('a2810000' in got::text) = 0,
      'no owner or deck id may appear anywhere in the payload';
  end loop;
end $$;

-- (d) expired.
do $$
declare tok text := (select token from public.playtest_shares where title = 'My table');
begin
  update public.playtest_shares set expires_at = now() - interval '1 minute' where token = tok;
  assert pg_temp.read_share('a2800000-0000-0000-0000-000000000002', 'authenticated', tok) is null,
    'an expired share must return null (expired)';
  update public.playtest_shares set expires_at = now() + interval '1 day' where token = tok;
  assert pg_temp.read_share('a2800000-0000-0000-0000-000000000002', 'authenticated', tok) is not null,
    'extending the expiry must make it readable again';
end $$;

-- (e) revoked = deleted.
do $$
declare tok text := (select token from public.playtest_shares where title = 'Second');
begin
  assert pg_temp.read_share('a2800000-0000-0000-0000-000000000002', 'authenticated', tok) is not null, 'the second share is readable first';
  perform pg_temp.touched('a2800000-0000-0000-0000-000000000001', 'authenticated', format($q$delete from public.playtest_shares where token = %L$q$, tok));
  assert pg_temp.read_share('a2800000-0000-0000-0000-000000000002', 'authenticated', tok) is null,
    'a revoked (deleted) share must return null';
end $$;

-- (f) malformed tokens.
do $$
declare bad text;
begin
  foreach bad in array array['', 'x', repeat('a', 31), repeat('a', 33), upper(repeat('a', 32)), repeat('g', 32),
                             '%', $t$' or true --$t$, (select token from public.playtest_shares limit 1) || 'a'] loop
    assert pg_temp.read_share('a2800000-0000-0000-0000-000000000002', 'authenticated', bad) is null,
      'a malformed token must return null: ' || bad;
  end loop;
  assert pg_temp.read_share('a2800000-0000-0000-0000-000000000002', 'authenticated', null) is null, 'a null token returns null';
end $$;

-- (g) bob (friend, alice's public deck visible) cannot create against it, list, or read.
do $$
declare
  outcome text;
  n bigint;
begin
  outcome := pg_temp.attempt('a2800000-0000-0000-0000-000000000002', 'authenticated', format(
    $q$insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version)
       values ('a2800000-0000-0000-0000-000000000002', 'a2810000-0000-0000-0000-000000000001', 'stolen', %L, 1)$q$, pg_temp.proj()::text));
  assert outcome = '23514', 'a friend sharing alice''s public deck must be refused (must be refused), got ' || outcome;

  outcome := pg_temp.attempt('a2800000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version)
       values ('a2800000-0000-0000-0000-000000000001', 'a2810000-0000-0000-0000-000000000003', 'binder', %L, 1)$q$, pg_temp.proj()::text));
  assert outcome = '23514', 'a share against a binder must be refused, got ' || outcome;

  n := pg_temp.touched('a2800000-0000-0000-0000-000000000002', 'authenticated', $q$select * from public.playtest_shares$q$);
  assert n = 0, 'a friend must not be able to list alice''s shares, saw ' || n;
  n := pg_temp.touched('a2800000-0000-0000-0000-000000000003', 'authenticated', $q$select * from public.playtest_shares$q$);
  assert n = 0, 'a stranger must not be able to list shares, saw ' || n;
  n := pg_temp.touched('a2800000-0000-0000-0000-000000000002', 'authenticated', $q$delete from public.playtest_shares$q$);
  assert n = 0, 'a friend must not be able to delete alice''s shares, touched ' || n;
  n := pg_temp.touched('a2800000-0000-0000-0000-000000000002', 'authenticated', $q$update public.playtest_shares set title = 'x'$q$);
  assert n = 0, 'a friend must not be able to edit alice''s shares, touched ' || n;
  n := pg_temp.touched('a2800000-0000-0000-0000-000000000001', 'authenticated', $q$select * from public.playtest_shares$q$);
  assert n = 1, 'alice reads her own share(s), saw ' || n;
end $$;

-- (h) size, expiry cap, version.
do $$
declare outcome text;
begin
  outcome := pg_temp.attempt('a2800000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version)
       values ('a2800000-0000-0000-0000-000000000001', 'a2810000-0000-0000-0000-000000000002', 'big', %L, 1)$q$, pg_temp.proj(pad => 140000)::text));
  assert outcome = '23514', 'an oversize projection must be refused (oversize), got ' || outcome;

  outcome := pg_temp.attempt('a2800000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version, expires_at)
       values ('a2800000-0000-0000-0000-000000000001', 'a2810000-0000-0000-0000-000000000002', 'long', %L, 1, now() + interval '91 days')$q$, pg_temp.proj()::text));
  assert outcome = '23514', 'an expiry beyond 90 days must be refused (91 days), got ' || outcome;

  outcome := pg_temp.attempt('a2800000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version, expires_at)
       values ('a2800000-0000-0000-0000-000000000001', 'a2810000-0000-0000-0000-000000000002', 'ok90', %L, 1, now() + interval '89 days')$q$, pg_temp.proj()::text));
  assert outcome = 'ok', '89 days is within the cap, got ' || outcome;
  delete from public.playtest_shares where title = 'ok90';

  outcome := pg_temp.attempt('a2800000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version)
       values ('a2800000-0000-0000-0000-000000000001', 'a2810000-0000-0000-0000-000000000002', 'ver', %L, 2)$q$, pg_temp.proj(ver => 1)::text));
  assert outcome = '23514', 'a projection_version that differs from the projection must be refused (version), got ' || outcome;

  outcome := pg_temp.attempt('a2800000-0000-0000-0000-000000000001', 'authenticated',
    $q$insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version)
       values ('a2800000-0000-0000-0000-000000000001', 'a2810000-0000-0000-0000-000000000002', 'nover', '{"turn":1}', 1)$q$);
  assert outcome = '23514', 'a projection MISSING its version must be refused (a NULL comparison must not pass), got ' || outcome;

  outcome := pg_temp.attempt('a2800000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version)
       values ('a2800000-0000-0000-0000-000000000001', 'a2810000-0000-0000-0000-000000000002', %L, %L, 1)$q$, '   ', '{"version":1}'));
  assert outcome = '23514', 'a blank title must be refused, got ' || outcome;
end $$;

-- (i) quota: 10 UNEXPIRED per user; expired shares do not count.
do $$
declare
  outcome text;
  n int;
begin
  -- alice has 1 live share ('My table'); 'Second' was revoked in (e).
  insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version, expires_at)
  select 'a2800000-0000-0000-0000-000000000001', 'a2810000-0000-0000-0000-000000000002', 'old' || g, pg_temp.proj(), 1, now() - interval '1 day'
    from generate_series(1, 5) g;
  insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version)
  select 'a2800000-0000-0000-0000-000000000001', 'a2810000-0000-0000-0000-000000000002', 'live' || g, pg_temp.proj(), 1
    from generate_series(1, 9) g;
  select count(*) into n from public.playtest_shares where owner_user_id = 'a2800000-0000-0000-0000-000000000001' and expires_at > now();
  assert n = 10, 'alice should have exactly 10 live shares, has ' || n;

  outcome := pg_temp.attempt('a2800000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version)
       values ('a2800000-0000-0000-0000-000000000001', 'a2810000-0000-0000-0000-000000000002', 'the 11th', %L, 1)$q$, pg_temp.proj()::text));
  assert outcome = '23514', 'the 11th live share must be refused (11th), got ' || outcome;

  begin
    insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version)
    values ('a2800000-0000-0000-0000-000000000001', 'a2810000-0000-0000-0000-000000000002', 'x', pg_temp.proj(), 1);
  exception when check_violation then
    assert sqlerrm like 'playtest_shares_quota%', 'the message must carry the fixed prefix errors.ts maps, got ' || sqlerrm;
  end;

  -- Deleting the expired ones (what createShare does first) changes nothing about live; revoking one frees a slot.
  delete from public.playtest_shares where title = 'live9';
  outcome := pg_temp.attempt('a2800000-0000-0000-0000-000000000001', 'authenticated', format(
    $q$insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version)
       values ('a2800000-0000-0000-0000-000000000001', 'a2810000-0000-0000-0000-000000000002', 'fits now', %L, 1)$q$, pg_temp.proj()::text));
  assert outcome = 'ok', 'revoking a share frees a slot, got ' || outcome;
end $$;

-- (k) immutable columns; editable ones.
do $$
declare
  outcome text;
  n bigint;
begin
  outcome := pg_temp.attempt('a2800000-0000-0000-0000-000000000001', 'authenticated',
    $q$update public.playtest_shares set token = repeat('1', 32) where title = 'My table'$q$);
  assert outcome = '42501', 'changing a token must be refused (token), got ' || outcome;
  outcome := pg_temp.attempt('a2800000-0000-0000-0000-000000000001', 'authenticated',
    $q$update public.playtest_shares set deck_id = 'a2810000-0000-0000-0000-000000000002' where title = 'My table'$q$);
  assert outcome = '42501', 'moving a share to another deck must be refused, got ' || outcome;
  outcome := pg_temp.attempt('a2800000-0000-0000-0000-000000000001', 'authenticated',
    $q$update public.playtest_shares set owner_user_id = 'a2800000-0000-0000-0000-000000000002' where title = 'My table'$q$);
  assert outcome = '42501', 'giving a share away must be refused, got ' || outcome;

  n := pg_temp.touched('a2800000-0000-0000-0000-000000000001', 'authenticated',
    format($q$update public.playtest_shares set title = 'Renamed', projection = %L, projection_version = 1, show_hand = true, expires_at = now() + interval '40 days' where title = 'My table'$q$, pg_temp.proj(pad => 10)::text));
  assert n = 1, 'the owner can update title/projection/show_hand/expiry, touched ' || n;
  outcome := pg_temp.attempt('a2800000-0000-0000-0000-000000000001', 'authenticated',
    $q$update public.playtest_shares set expires_at = now() + interval '200 days' where title = 'Renamed'$q$);
  assert outcome = '23514', 'extending past 90 days from creation must be refused, got ' || outcome;
  assert not has_column_privilege('authenticated', 'public.playtest_shares', 'token', 'INSERT'), 'token must not be insertable';
  assert not has_column_privilege('authenticated', 'public.playtest_shares', 'token', 'UPDATE'), 'token must not be updatable';
end $$;

-- (j) cascades: deleting a deck, then an account.
do $$
begin
  assert (select count(*) from public.playtest_shares where deck_id = 'a2810000-0000-0000-0000-000000000002') > 0, 'there are shares on alice''s second deck';
  delete from public.locations where id = 'a2810000-0000-0000-0000-000000000002';
  assert (select count(*) from public.playtest_shares where deck_id = 'a2810000-0000-0000-0000-000000000002') = 0,
    'deleting a deck must delete its shares';
  assert (select count(*) from public.playtest_shares where deck_id = 'a2810000-0000-0000-0000-000000000001') = 1,
    'shares on other decks survive';

  insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version)
  values ('a2800000-0000-0000-0000-000000000003', 'a2810000-0000-0000-0000-000000000004', 'carol share', pg_temp.proj(), 1);
  delete from auth.users where id = 'a2800000-0000-0000-0000-000000000003';
  assert (select count(*) from public.playtest_shares where owner_user_id = 'a2800000-0000-0000-0000-000000000003') = 0,
    'deleting an account must delete its shares';
  assert (select count(*) from public.playtest_shares where owner_user_id = 'a2800000-0000-0000-0000-000000000001') > 0,
    'alice''s remaining shares are untouched';
end $$;

-- (l) the function's shape and grants.
do $$
declare
  fn regprocedure := 'public.get_playtest_share(text)'::regprocedure;
begin
  assert (select prosecdef from pg_proc where oid = fn), 'get_playtest_share must be SECURITY DEFINER';
  assert exists (select 1 from pg_proc p, unnest(p.proconfig) c where p.oid = fn and c = 'search_path=""'),
    'get_playtest_share must pin an empty search_path';
  assert (select provolatile from pg_proc where oid = fn) = 's', 'get_playtest_share must be STABLE';
  assert has_function_privilege('authenticated', fn, 'EXECUTE'), 'authenticated must be able to execute it';
  assert not has_function_privilege('anon', fn, 'EXECUTE'), 'anon must not be able to execute it (option B)';
  assert not has_function_privilege('service_role', fn, 'EXECUTE'), 'service_role must not be able to execute it';
  assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = fn and a.grantee = 0),
    'PUBLIC must not be able to execute it';
  assert not has_table_privilege('anon', 'public.playtest_shares', 'SELECT'), 'anon has no table access';
  assert not has_table_privilege('service_role', 'public.playtest_shares', 'SELECT'), 'service_role has no table access';
  assert (select relrowsecurity from pg_class where oid = 'public.playtest_shares'::regclass), 'RLS must be on';
end $$;

rollback;

\echo 'schema_test.sql: all assertions passed'
