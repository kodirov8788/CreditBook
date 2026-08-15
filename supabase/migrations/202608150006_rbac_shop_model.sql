-- Establish the multi-tenant foundation without changing existing access rules yet.
-- Issue #35: RBAC: multi-tenant shop and membership data model.

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(trim(name)) >= 2),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_members (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('shop_owner', 'manager', 'cashier', 'accountant', 'viewer')),
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, user_id)
);

create table if not exists public.platform_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('platform_owner', 'platform_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shops_owner_user_id_idx on public.shops(owner_user_id);
create index if not exists shops_status_idx on public.shops(status);
create index if not exists shop_members_user_id_idx on public.shop_members(user_id);
create index if not exists shop_members_shop_id_idx on public.shop_members(shop_id);
create index if not exists shop_members_active_idx on public.shop_members(shop_id, user_id) where status = 'active';

-- Add tenant scope to existing business records. It remains nullable until the
-- permission/RLS migration updates every writer and makes it mandatory.
alter table public.customers add column if not exists shop_id uuid references public.shops(id) on delete cascade;
alter table public.debts add column if not exists shop_id uuid references public.shops(id) on delete cascade;
alter table public.payments add column if not exists shop_id uuid references public.shops(id) on delete cascade;
alter table public.expenses add column if not exists shop_id uuid references public.shops(id) on delete cascade;
alter table public.reminders add column if not exists shop_id uuid references public.shops(id) on delete cascade;
alter table public.activity_logs add column if not exists shop_id uuid references public.shops(id) on delete cascade;

create index if not exists customers_shop_id_idx on public.customers(shop_id);
create index if not exists debts_shop_id_idx on public.debts(shop_id);
create index if not exists payments_shop_id_idx on public.payments(shop_id);
create index if not exists expenses_shop_id_idx on public.expenses(shop_id);
create index if not exists reminders_shop_id_idx on public.reminders(shop_id);
create index if not exists activity_logs_shop_id_idx on public.activity_logs(shop_id);

-- Every existing account receives one default shop. The owner lookup is
-- intentionally based on auth.users, not user-editable metadata.
insert into public.shops (owner_user_id, name)
select
  u.id,
  coalesce(nullif(trim(p.shop_name), ''), 'Mahalla do''koni')
from auth.users u
left join public.profiles p on p.id = u.id
where not exists (
  select 1
  from public.shops existing
  where existing.owner_user_id = u.id
);

insert into public.shop_members (shop_id, user_id, role, status, invited_by)
select s.id, s.owner_user_id, 'shop_owner', 'active', s.owner_user_id
from public.shops s
where not exists (
  select 1
  from public.shop_members existing
  where existing.shop_id = s.id
    and existing.user_id = s.owner_user_id
);

-- Backfill all legacy rows using the account's default shop. This is safe to
-- rerun and only fills missing tenant scope.
update public.customers c
set shop_id = s.id
from public.shops s
where c.shop_id is null
  and s.owner_user_id = c.user_id;

update public.debts d
set shop_id = s.id
from public.shops s
where d.shop_id is null
  and s.owner_user_id = d.user_id;

update public.payments p
set shop_id = s.id
from public.shops s
where p.shop_id is null
  and s.owner_user_id = p.user_id;

update public.expenses e
set shop_id = s.id
from public.shops s
where e.shop_id is null
  and s.owner_user_id = e.user_id;

update public.reminders r
set shop_id = s.id
from public.shops s
where r.shop_id is null
  and s.owner_user_id = r.user_id;

update public.activity_logs a
set shop_id = s.id
from public.shops s
where a.shop_id is null
  and s.owner_user_id = a.user_id;

alter table public.shops enable row level security;
alter table public.shop_members enable row level security;
alter table public.platform_roles enable row level security;

-- Temporary owner-only policies preserve current behavior while #39 replaces
-- them with permission-aware policies. No table is exposed by default.
drop policy if exists "Owners can view their shops" on public.shops;
create policy "Owners can view their shops"
  on public.shops for select
  to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists "Users can view their memberships" on public.shop_members;
create policy "Users can view their memberships"
  on public.shop_members for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can view their platform role" on public.platform_roles;
create policy "Users can view their platform role"
  on public.platform_roles for select
  to authenticated
  using (user_id = auth.uid());
