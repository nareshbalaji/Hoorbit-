-- Minimal stand-in for Supabase's auth schema/roles so migrations can be tested on plain Postgres + PostGIS.
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key, aud text, role text, email text, phone text, phone_confirmed_at timestamptz,
  banned_until timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated;
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated;
-- Supabase's default database search_path
do $$ begin execute format('alter database %I set search_path = "$user", public, extensions', current_database()); end $$;
