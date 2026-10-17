-- G01 foundation only. Do not apply in production before the personal app
-- onboarding/ledger is usable: new signups no longer receive an owner shop.
begin;

create schema if not exists creditbook_private;
revoke all on schema creditbook_private from public, anon;
grant usage on schema creditbook_private to authenticated;

-- No user-id argument: this must never become an account-status lookup API.
-- Unbanned accounts have NULL banned_until and ARE active.
create or replace function creditbook_private.is_current_account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = (select auth.uid())
      and (u.banned_until is null or u.banned_until <= now())
      and not coalesce(u.is_anonymous, false)
  );
$$;

revoke all on function creditbook_private.is_current_account_active() from public, anon, authenticated;
grant execute on function creditbook_private.is_current_account_active() to authenticated;

create table public.personal_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default 'Shaxsiy hisob' check (char_length(trim(name)) between 2 and 80),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.personal_workspaces enable row level security;
-- Revoke project default grants explicitly; RLS alone is not a grant boundary.
revoke all on public.personal_workspaces from public, anon, authenticated;
grant select on public.personal_workspaces to authenticated;
grant insert (owner_user_id) on public.personal_workspaces to authenticated;
grant all on public.personal_workspaces to service_role;

create policy personal_workspace_owner_read
on public.personal_workspaces for select to authenticated
using (
  owner_user_id = (select auth.uid())
  and status = 'active'
  and (select creditbook_private.is_current_account_active())
);

create policy personal_workspace_owner_create
on public.personal_workspaces for insert to authenticated
with check (
  owner_user_id = (select auth.uid())
  and status = 'active'
  and (select creditbook_private.is_current_account_active())
);

create function creditbook_private.protect_personal_workspace_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.owner_user_id is distinct from old.owner_user_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Personal workspace ownership cannot be changed.' using errcode = '42501';
  end if;
  -- The foundation grants users no UPDATE/DELETE, including name/status changes.
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function creditbook_private.protect_personal_workspace_identity() from public, anon, authenticated;
create trigger personal_workspace_protect_identity
before update on public.personal_workspaces
for each row execute function creditbook_private.protect_personal_workspace_identity();

-- SECURITY INVOKER: provisioning must pass the same owner grants and RLS as
-- direct Data API requests. A unique owner key handles concurrent first use.
create function public.ensure_my_personal_workspace()
returns public.personal_workspaces
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_workspace public.personal_workspaces;
begin
  if not creditbook_private.is_current_account_active() then
    raise exception 'Shaxsiy hisob uchun ruxsat yo''q.' using errcode = '42501';
  end if;

  insert into public.personal_workspaces (owner_user_id)
  values (auth.uid())
  on conflict (owner_user_id) do nothing;

  select * into v_workspace
  from public.personal_workspaces
  where owner_user_id = auth.uid() and status = 'active';

  if not found then
    -- A suspended existing workspace must not be recreated or reactivated.
    raise exception 'Shaxsiy hisob uchun ruxsat yo''q.' using errcode = '42501';
  end if;
  return v_workspace;
end;
$$;

revoke all on function public.ensure_my_personal_workspace() from public, anon, authenticated;
grant execute on function public.ensure_my_personal_workspace() to authenticated;

-- New accounts (including invitees) get no business authority from metadata.
-- The unchanged activate_invited_memberships RPC validates the real pending
-- membership after authentication. Existing shops and current_shop_id values
-- are never updated/backfilled by this migration or by personal provisioning.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;

  -- Anonymous or already-banned signups are not personal-account provisioning.
  -- A later verified/unbanned account can use the same guarded lazy RPC.
  if coalesce(new.is_anonymous, false)
    or (new.banned_until is not null and new.banned_until > now()) then
    return new;
  end if;

  insert into public.personal_workspaces (owner_user_id)
  values (new.id)
  on conflict (owner_user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

commit;
