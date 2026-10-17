-- PostgreSQL-only fixture. This does NOT emulate GoTrue, JWT verification,
-- PostgREST, email delivery, or the complete Supabase platform.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  banned_until timestamptz,
  is_anonymous boolean default false
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- A historical migration only revokes this Supabase-provided event-trigger
-- function. It is not attached here: auto-RLS platform behavior is NOT tested.
create function public.rls_auto_enable() returns event_trigger
language plpgsql as $$ begin null; end; $$;
-- Approximate Supabase's broad defaults, so the migration must revoke them.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
