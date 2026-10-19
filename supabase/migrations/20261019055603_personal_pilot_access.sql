-- G01 pilot gate. Additive and deny-by-default: no identity is enrolled here.
-- Apply only after separately approved rollout/configuration. No shop objects,
-- signup triggers, existing personal records or auth identities are rewritten.
begin;

create table creditbook_private.personal_pilot_allowlist (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table creditbook_private.personal_pilot_allowlist enable row level security;
revoke all on creditbook_private.personal_pilot_allowlist from public, anon, authenticated, service_role;

-- Retain this existing function's signature for the personal policies and RPCs
-- introduced by G01/G02. Its callers are personal-only; shop permission helpers
-- and signup/invitation provisioning do not call it and are not changed here.
-- The narrow definer lookup is necessary because neither auth.users nor the
-- allowlist is readable by clients. Do not expose a user-id lookup parameter.
create or replace function creditbook_private.is_current_account_active()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join creditbook_private.personal_pilot_allowlist p on p.user_id = u.id
    where u.id = (select auth.uid())
      and p.enabled
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
      and not coalesce(u.is_anonymous, false)
  );
$$;
revoke all on function creditbook_private.is_current_account_active() from public, anon, authenticated;
grant execute on function creditbook_private.is_current_account_active() to authenticated;

-- Defense-in-depth HTTP/page gate. Table RLS and direct financial helpers call
-- the same predicate independently; clients cannot bypass it via a private RPC.
create function public.has_personal_pilot_access()
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select creditbook_private.is_current_account_active();
$$;
revoke all on function public.has_personal_pilot_access() from public, anon, authenticated, service_role;
grant execute on function public.has_personal_pilot_access() to authenticated;

comment on table creditbook_private.personal_pilot_allowlist is
  'Personal-module pilot only. Enrol verified Auth UUIDs through an approved database-admin operation; never metadata/email matching. No client grants.';
comment on function public.has_personal_pilot_access() is
  'Current-session personal pilot permission only, not a shop role or a replacement for per-workspace RLS.';

commit;
