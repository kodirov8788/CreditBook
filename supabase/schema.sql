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

-- Keep customer creation and its optional opening debt in one transaction.
create or replace function public.create_customer_with_opening_debt(
  p_name text,
  p_phone text default null,
  p_address text default null,
  p_notes text default null,
  p_amount numeric default 0,
  p_due_date date default null
)
returns public.customers
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_customer public.customers;
begin
  if auth.uid() is null then
    raise exception 'Kirish talab qilinadi.' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Mijoz ismini kiriting.' using errcode = '22023';
  end if;

  if p_amount is null then
    p_amount := 0;
  end if;

  if p_amount < 0 then
    raise exception 'Qarz summasi manfiy bo''lmasin.' using errcode = '22023';
  end if;

  insert into public.customers (user_id, name, phone, address, notes)
  values (
    auth.uid(),
    trim(p_name),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_address, '')), ''),
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning * into v_customer;

  if p_amount > 0 then
    insert into public.debts (user_id, customer_id, principal, due_date, title)
    values (auth.uid(), v_customer.id, p_amount, p_due_date, 'Qarz');
  end if;

  return v_customer;
end;
$function$;

grant execute on function public.create_customer_with_opening_debt(text, text, text, text, numeric, date) to authenticated;

-- Serialize payments for a customer and keep allocation + debt status updates atomic.
create or replace function public.record_payment_atomic(
  p_customer_id uuid,
  p_amount numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_debt record;
  v_paid numeric;
  v_open numeric;
  v_part numeric;
  v_left numeric := p_amount;
  v_payments jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Kirish talab qilinadi.' using errcode = '42501';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'To''lov summasini kiriting.' using errcode = '22023';
  end if;

  -- Every writer using this function locks the customer's open debts first.
  -- A second concurrent payment waits, then re-reads the committed balance.
  for v_debt in
    select d.id, d.principal
    from public.debts d
    where d.user_id = auth.uid()
      and d.customer_id = p_customer_id
      and d.status = 'open'
    order by d.created_at, d.id
    for update
  loop
    select coalesce(sum(p.amount), 0)
      into v_paid
      from public.payments p
     where p.user_id = auth.uid()
       and p.debt_id = v_debt.id;

    v_open := greatest(v_debt.principal - v_paid, 0);
    if v_open > 0 and v_left > 0 then
      v_part := least(v_left, v_open);

      insert into public.payments (user_id, customer_id, debt_id, amount, note)
      values (auth.uid(), p_customer_id, v_debt.id, v_part, nullif(trim(coalesce(p_note, '')), ''));

      if v_part >= v_open then
        update public.debts
           set status = 'paid'
         where id = v_debt.id
           and user_id = auth.uid();
      end if;

      v_left := v_left - v_part;
      v_payments := v_payments || jsonb_build_array(jsonb_build_object('debt_id', v_debt.id, 'amount', v_part));
    end if;
  end loop;

  if v_left > 0 or jsonb_array_length(v_payments) = 0 then
    raise exception 'To''lov qoldiqdan oshmasin.' using errcode = '22023';
  end if;

  return jsonb_build_object('paid', p_amount, 'payments', v_payments);
end;
$function$;

grant execute on function public.record_payment_atomic(uuid, numeric, text) to authenticated;
