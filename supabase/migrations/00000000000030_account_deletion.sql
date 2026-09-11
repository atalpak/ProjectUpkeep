-- ---------------------------------------------------------------------------
-- Self-service account deletion.
--
-- Verified empirically before writing a line of SQL: deleting a user with a
-- completed trade aborted the whole transaction. trades.proposer_id and
-- recipient_id were ON DELETE CASCADE from auth.users (migration 6), so
-- closing an account hard-deleted every trade it was ever part of. That took
-- ownership_history.trade_id down with it via its own ON DELETE SET NULL
-- (migration 9) -- a real UPDATE on every history row that named the trade --
-- and ownership_history rejects UPDATE unconditionally (migration 6's
-- append-only trigger), for every role, so the whole delete rolled back. An
-- account that had ever completed a trade could not be closed at all.
--
-- Migration 9's header called ownership_history's trade_id FK "free" because
-- "trades are never hard-deleted (they end in a terminal status)". That was
-- true until migration 6 itself put a CASCADE from auth.users onto trades,
-- which deletes them by a path that has nothing to do with their status. The
-- claim was wrong from the moment both migrations existed together; deleting
-- an account with trade history is what finally exercised it.
--
-- CHOSEN FIX: keep trades, null the departed party. proposer_id and
-- recipient_id become nullable, and their FKs move from CASCADE to SET NULL.
-- This is the only schema change deletion needs -- every other FK an account
-- deletion reaches already does the right thing: profiles, locations,
-- card_instances, friendships, notifications.user_id, want_list and feedback
-- all cascade; notifications.actor_id is already SET NULL, with a comment
-- ("Null if they have since deleted their account") that this migration
-- finally makes true; deck_cards and trade_items reach auth.users only through
-- locations and card_instances, which already resolve correctly on their own.
--
-- The alternative -- cascading trades away too -- was rejected because a trade
-- has two sides. If Alice deletes her account, the trade she completed with
-- Bob is Bob's history too: it is the provenance of a card now sitting in his
-- binder, and his own record of having traded at all. A third party's account
-- closure should not be able to reach into Bob's history and erase a row he
-- has every right to keep. No tombstone table is needed to soften this --
-- getFeed()'s render in src/components/social/TradeFeed.tsx and TradeList.tsx
-- already show a missing counterparty as a plain "Someone" / "someone",
-- because profilesByIds (src/lib/social/queries.ts) already drops falsy ids
-- from its lookup. A null proposer_id or recipient_id was already a case the
-- UI had to handle for a row whose profile query simply came back empty; this
-- migration is the first time the column itself can hold one.
-- ---------------------------------------------------------------------------

alter table public.trades
  alter column proposer_id drop not null,
  alter column recipient_id drop not null;

alter table public.trades
  drop constraint trades_proposer_id_fkey,
  drop constraint trades_recipient_id_fkey;

alter table public.trades
  add constraint trades_proposer_id_fkey
    foreign key (proposer_id) references auth.users (id) on delete set null,
  add constraint trades_recipient_id_fkey
    foreign key (recipient_id) references auth.users (id) on delete set null;

-- trades_distinct_parties (migration 9: proposer_id <> recipient_id) still
-- holds once one side goes null: a comparison against null is unknown, and a
-- CHECK constraint only rejects a definite false, so the ON DELETE SET NULL
-- action that reaches this row passes it without needing an exception here.

comment on column public.trades.proposer_id is
  'Null if this party has since deleted their account. The trade and the other party''s copy of it survive.';
comment on column public.trades.recipient_id is
  'Null if this party has since deleted their account. The trade and the other party''s copy of it survive.';

-- ---------------------------------------------------------------------------
-- delete_own_account(confirm_username)
--
-- Same family as accept_trade() (migrations 9 -> 12 -> 13): SECURITY DEFINER,
-- because the action it performs -- deleting a row in auth.users -- is not
-- something any RLS policy could grant a client, and should not be. This does
-- not touch RLS anywhere; the definer's own privilege on auth.users (confirmed
-- by hand against the live project: the function owner has DELETE there) is
-- the entire mechanism, exactly as accept_trade's owner-level access to
-- card_instances is what lets it move ownership without a client-writable
-- owner_user_id policy.
--
-- confirm_username is checked here even though the caller's session
-- (auth.uid()) is already the real authorization gate -- the same relationship
-- between the two checks as accept_trade's actor check versus its ownership
-- check. This one exists so a signed-in tab left open cannot be driven straight
-- into a delete by whatever is on the clipboard; the UI collects the same value,
-- but the RPC re-checks it against the stored value rather than trusting the
-- client's claim.
--
-- Open trades are closed *before* the delete, not left for the FK change above
-- to null out silently. Nulling a live 'proposed' trade would strand the
-- surviving party waiting on an offer that can never be answered, and it would
-- skip notify_on_trade_change (migration 14) entirely, since that trigger fires
-- on UPDATE, not on a column going null via someone else's FK action. Closing
-- explicitly, as the departing party's own cancel/decline, means the surviving
-- friend gets told the same way they would if the other person had clicked
-- cancel -- which, from their side, is exactly what this is.
-- ---------------------------------------------------------------------------

create or replace function public.delete_own_account(confirm_username text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_username text;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  select username into v_username from public.profiles where id = v_uid;

  -- Case-sensitive, against the stored value -- not the lower(username) the
  -- uniqueness index compares on. Typing a different case is not the same as
  -- confirming the account.
  if v_username is null or v_username <> confirm_username then
    raise exception 'That username does not match your account'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Close every trade still open on either side. Mapping mirrors what the
  -- departing party would have produced by clicking cancel/decline
  -- themselves: notify_on_trade_change targets new.recipient_id on
  -- 'cancelled' and new.proposer_id on 'declined', so in both cases the
  -- notification lands on the person who is staying, never on the row being
  -- deleted a moment later.
  update public.trades
     set status = 'cancelled'
   where proposer_id = v_uid
     and status in ('proposed', 'countered');

  update public.trades
     set status = 'declined'
   where recipient_id = v_uid
     and status in ('proposed', 'countered');

  -- One statement. The FK graph -- fixed above for trades, already correct
  -- everywhere else -- does the rest: profiles, locations, card_instances,
  -- deck_cards (via locations), want_list, friendships, notifications,
  -- feedback all go with it; ownership_history keeps its dangling ids by
  -- design (migration 6); trades this account was part of survive with this
  -- column nulled.
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_own_account(text) from public;
grant execute on function public.delete_own_account(text) to authenticated;
