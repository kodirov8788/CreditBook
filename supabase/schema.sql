-- CreditBook database schema
-- Run this in Supabase SQL Editor. It is safe to re-run during development.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  shop_name text not null default 'My shop',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(trim(name)) >= 2),
  phone text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  title text not null default 'Credit',
  principal numeric(14, 2) not null check (principal > 0),
  due_date date,
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  debt_id uuid references public.debts(id) on delete cascade,
  channel text not null default 'manual' check (channel in ('manual', 'sms', 'whatsapp', 'email')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled')),
  message text,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  customer_id uuid references public.customers(id) on delete set null,
  event_type text not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customers_user_id_idx on public.customers(user_id);
create index if not exists debts_user_id_idx on public.debts(user_id);
create index if not exists debts_customer_id_idx on public.debts(customer_id);
create index if not exists payments_debt_id_idx on public.payments(debt_id);
create index if not exists reminders_scheduled_for_idx on public.reminders(scheduled_for) where status = 'pending';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at before update on public.customers for each row execute function public.set_updated_at();
drop trigger if exists debts_set_updated_at on public.debts;
create trigger debts_set_updated_at before update on public.debts for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.debts enable row level security;
alter table public.payments enable row level security;
alter table public.reminders enable row level security;
alter table public.activity_logs enable row level security;

drop policy if exists "Users can view their profile" on public.profiles;
create policy "Users can view their profile" on public.profiles for select using (id = auth.uid());
drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "Users own customers" on public.customers;
create policy "Users own customers" on public.customers for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users own debts" on public.debts;
create policy "Users own debts" on public.debts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users own payments" on public.payments;
create policy "Users own payments" on public.payments for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users own reminders" on public.reminders;
create policy "Users own reminders" on public.reminders for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users own activity logs" on public.activity_logs;
create policy "Users own activity logs" on public.activity_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Keep child records tenant-safe even if a caller supplies an id belonging to another user.
create or replace function public.validate_customer_owner()
returns trigger
language plpgsql
security invoker
as $$
begin
  if not exists (select 1 from public.customers where id = new.customer_id and user_id = auth.uid()) then
    raise exception 'Customer does not belong to the current user';
  end if;
  return new;
end;
$$;

drop trigger if exists debts_validate_customer_owner on public.debts;
create trigger debts_validate_customer_owner before insert or update on public.debts for each row execute function public.validate_customer_owner();
drop trigger if exists payments_validate_customer_owner on public.payments;
create trigger payments_validate_customer_owner before insert or update on public.payments for each row execute function public.validate_customer_owner();
