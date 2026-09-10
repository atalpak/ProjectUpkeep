-- ---------------------------------------------------------------------------
-- Feedback.
--
-- The first channel for hearing from the people using Upkeep. The only person
-- who has used the app so far is the owner, so every call about what to build
-- next has rested on a guess. A signed-in user can now type a sentence from
-- wherever they are and have it land somewhere the weekly routine can read.
--
-- Append-only, enforced by the *absence* of an UPDATE and a DELETE policy
-- rather than by a reject-mutation trigger. That matches the ethos of
-- ownership_history -- what you filed you cannot quietly rewrite -- but not its
-- mechanism, deliberately. ownership_history is a transfer-of-value record that
-- has to resist even the table owner, so migration 6 locks it at the trigger
-- level. Feedback carries no such stakes: if the owner needs to clear spam,
-- doing it by hand as the table owner is fine. With no policy in place a
-- client's UPDATE or DELETE matches zero rows, which is the whole guarantee
-- this table needs. Read the missing trigger as a decision, not an oversight
-- against the migration 6 precedent.
--
-- One narrow exception to "cannot be retracted from the app": user_id is
-- ON DELETE CASCADE, matching every other user-owned table (profiles,
-- locations, card_instances, notifications, friendships, trades), so erasing
-- an account takes its feedback with it. An account deletion is not an edit,
-- and it lays a duty on PR2's weekly triage -- copy a note's text into the
-- markdown log before the row can ever go, because once the account is gone
-- the row is not the durable record.
--
-- No status or triage columns. The weekly routine writes its triage to a
-- markdown file and that file is the record; a row here only ever means
-- "someone said this, on this date, from this page". If per-row state proves
-- worth keeping, adding it later is a cheap additive migration.
--
-- The admin inbox that reads every row is PR2 -- it needs an is_admin() gate, a
-- SELECT policy that leans on it, and the by-recency index that read pattern
-- wants, none of which exist yet. PR1 has no read path an index helps: the
-- own-row SELECT filters user_id, not a column this table indexes. So PR1 is
-- the table, own-row RLS and the form behind it, nothing more.
-- ---------------------------------------------------------------------------

create table public.feedback (
  -- extensions.gen_random_uuid(): pgcrypto is installed into the extensions
  -- schema (migration 1), so a bare gen_random_uuid() fails on a clean DB.
  id         uuid primary key default extensions.gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Who filed it. Defaults to the caller so the form never has to pass it; the
  -- INSERT policy below pins it to auth.uid() regardless. Named FK for parity
  -- with the named checks below; ON DELETE CASCADE per the header.
  user_id    uuid not null
               constraint feedback_user_id_fkey
               references auth.users (id) on delete cascade
               default auth.uid(),

  -- The message. `body ~ '\S'` is the real lower bound -- it demands one
  -- non-whitespace character. btrim() strips spaces but not tabs or newlines,
  -- so a char_length(btrim(body)) >= 1 test alone would pass a body of
  -- E'\n\n\n'. The 4000 cap is on the space-trimmed length.
  body       text not null
               constraint feedback_body_length
               check (body ~ '\S' and char_length(btrim(body)) <= 4000),

  -- The route the user was on when they opened the form -- triage context
  -- only. Nullable: a client that does not send it is not an error.
  page       text
               constraint feedback_page_length
               check (page is null or char_length(page) <= 300)
);

alter table public.feedback enable row level security;

-- You can file feedback as yourself.
create policy "feedback: insert own"
  on public.feedback for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- You can read back what you have filed. No admin arm -- that is PR2.
create policy "feedback: read own"
  on public.feedback for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No UPDATE or DELETE policy, and that omission is the append-only mechanism:
-- with no policy a client's update or delete matches zero rows instead of
-- erroring, so feedback once filed cannot be rewritten or retracted from the
-- app. The owner can still clear spam directly, where RLS does not bind the
-- table owner. See the header for why this is a policy omission and not an
-- ownership_history-style reject trigger.
