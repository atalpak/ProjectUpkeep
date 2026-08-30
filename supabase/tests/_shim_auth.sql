-- ---------------------------------------------------------------------------
-- Minimal stand-in for the pieces of Supabase's platform schema that our
-- migrations reference. Used only by scripts/verify-migrations.sh, so the
-- schema can be applied and exercised against a stock Postgres in CI without
-- booting a full Supabase stack. Never applied to a real project.
-- ---------------------------------------------------------------------------
create schema if not exists auth;
create schema if not exists extensions;

create table if not exists auth.users (
  id                    uuid primary key default gen_random_uuid(),
  email                 text unique,
  raw_user_meta_data    jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

-- Supabase resolves auth.uid() from the request JWT. Here it reads a GUC the
-- tests set, so RLS policies can be exercised as different users.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;

do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;

do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;

grant usage on schema public, extensions, auth to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
