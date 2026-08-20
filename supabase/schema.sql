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

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  shop_id uuid references public.shops(id) on delete cascade,
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
  shop_id uuid references public.shops(id) on delete cascade,
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
  shop_id uuid references public.shops(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  note text,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  shop_id uuid references public.shops(id) on delete cascade,
  category text not null check (char_length(trim(category)) >= 2),
  amount numeric(14, 2) not null check (amount > 0),
  spent_at date not null default current_date,
  vendor text,
  note text,
  payment_method text not null default 'cash' check (payment_method in ('cash', 'card', 'bank', 'other')),
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  shop_id uuid references public.shops(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  debt_id uuid references public.debts(id) on delete cascade,
  channel text not null default 'manual' check (channel in ('manual', 'sms', 'whatsapp', 'email')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  error_reason text,
  message text,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  shop_id uuid references public.shops(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  event_type text not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customers_user_id_idx on public.customers(user_id);
create index if not exists customers_shop_id_idx on public.customers(shop_id);
create index if not exists debts_user_id_idx on public.debts(user_id);
create index if not exists debts_shop_id_idx on public.debts(shop_id);
create index if not exists debts_customer_id_idx on public.debts(customer_id);
create index if not exists payments_debt_id_idx on public.payments(debt_id);
create index if not exists expenses_user_spent_at_idx on public.expenses(user_id, spent_at desc);
create index if not exists expenses_shop_id_idx on public.expenses(shop_id);
create index if not exists reminders_scheduled_for_idx on public.reminders(scheduled_for) where status = 'pending';
create index if not exists shops_owner_user_id_idx on public.shops(owner_user_id);
create index if not exists shop_members_user_id_idx on public.shop_members(user_id);
create index if not exists shop_members_shop_id_idx on public.shop_members(shop_id);
create index if not exists platform_roles_role_idx on public.platform_roles(role);

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
drop trigger if exists shops_set_updated_at on public.shops;
create trigger shops_set_updated_at before update on public.shops for each row execute function public.set_updated_at();
drop trigger if exists shop_members_set_updated_at on public.shop_members;
create trigger shop_members_set_updated_at before update on public.shop_members for each row execute function public.set_updated_at();
drop trigger if exists platform_roles_set_updated_at on public.platform_roles;
create trigger platform_roles_set_updated_at before update on public.platform_roles for each row execute function public.set_updated_at();
drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at before update on public.customers for each row execute function public.set_updated_at();
drop trigger if exists debts_set_updated_at on public.debts;
create trigger debts_set_updated_at before update on public.debts for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_shop_id uuid;
  v_shop_name text;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;

  select case
    when trim(coalesce(p.shop_name, '')) in ('', 'My shop', 'Mahalla do''koni')
      then 'My shop — ' || coalesce(nullif(trim(new.email), ''), 'user-' || left(new.id::text, 8))
    else trim(p.shop_name)
  end
  into v_shop_name
  from public.profiles p
  where p.id = new.id;

  insert into public.shops (owner_user_id, name)
  select new.id, v_shop_name
  where not exists (
    select 1 from public.shops s where s.owner_user_id = new.id
  )
  returning id into v_shop_id;

  if v_shop_id is null then
    select s.id into v_shop_id
    from public.shops s
    where s.owner_user_id = new.id
    order by s.created_at, s.id
    limit 1;
  end if;

  insert into public.shop_members (shop_id, user_id, role, status, invited_by)
  values (v_shop_id, new.id, 'shop_owner', 'active', new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.shops enable row level security;
alter table public.shop_members enable row level security;
alter table public.platform_roles enable row level security;
alter table public.customers enable row level security;
alter table public.debts enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.reminders enable row level security;
alter table public.activity_logs enable row level security;

drop policy if exists "Users can view their profile" on public.profiles;
create policy "Users can view their profile" on public.profiles for select using (id = auth.uid());
drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "Owners can view their shops" on public.shops;
create policy "Owners can view their shops" on public.shops for select to authenticated using (owner_user_id = auth.uid());
drop policy if exists "Users can view their memberships" on public.shop_members;
create policy "Users can view their memberships" on public.shop_members for select to authenticated using (user_id = auth.uid());
drop policy if exists "Memberships manageable by permission" on public.shop_members;
drop policy if exists "Users can view their platform role" on public.platform_roles;
create policy "Users can view their platform role" on public.platform_roles for select to authenticated using (user_id = auth.uid());

drop policy if exists "Users own customers" on public.customers;
create policy "Users own customers" on public.customers for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users own debts" on public.debts;
create policy "Users own debts" on public.debts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users own payments" on public.payments;
create policy "Users own payments" on public.payments for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users own expenses" on public.expenses;
create policy "Users own expenses" on public.expenses for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users own reminders" on public.reminders;
create policy "Users own reminders" on public.reminders for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users own activity logs" on public.activity_logs;
create policy "Users own activity logs" on public.activity_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.prevent_last_owner_removal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_count integer;
begin
  if tg_op = 'DELETE' then
    if old.role = 'shop_owner' and old.status = 'active' then
      perform 1 from public.shops where id = old.shop_id for update;
      select count(*) into v_owner_count from public.shop_members where shop_id = old.shop_id and role = 'shop_owner' and status = 'active';
      if v_owner_count <= 1 then
        raise exception 'Oxirgi shop owner''ni o''chirib bo''lmaydi.' using errcode = '23514';
      end if;
    end if;
    return old;
  end if;

  if old.role = 'shop_owner' and old.status = 'active' and (new.role is distinct from old.role or new.status is distinct from old.status) then
    perform 1 from public.shops where id = old.shop_id for update;
    select count(*) into v_owner_count from public.shop_members where shop_id = old.shop_id and role = 'shop_owner' and status = 'active';
    if v_owner_count <= 1 then
      raise exception 'Oxirgi shop owner''ni o''zgartirib bo''lmaydi.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists shop_members_last_owner_guard on public.shop_members;
create trigger shop_members_last_owner_guard before update or delete on public.shop_members for each row execute function public.prevent_last_owner_removal();
revoke all on function public.prevent_last_owner_removal() from public, anon, authenticated;

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

-- Preserve transaction history while allowing safe corrections.
create or replace function public.cancel_credit_atomic(
  p_customer_id uuid,
  p_debt_id uuid,
  p_reason text default null
)
returns public.debts
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_debt public.debts;
  v_active_payments integer;
begin
  if auth.uid() is null then
    raise exception 'Kirish talab qilinadi.' using errcode = '42501';
  end if;

  select d.* into v_debt from public.debts d where d.id = p_debt_id and d.customer_id = p_customer_id and d.user_id = auth.uid() for update;
  if not found then raise exception 'Qarz topilmadi.' using errcode = 'P0002'; end if;

  select count(*) into v_active_payments from public.payments p where p.debt_id = v_debt.id and p.user_id = auth.uid() and p.voided_at is null;
  if v_active_payments > 0 then raise exception 'To''lovli qarzni bekor qilishdan oldin to''lovni bekor qiling.' using errcode = '22023'; end if;

  update public.debts set status = 'cancelled', notes = concat_ws(E'\n', nullif(notes, ''), nullif(trim(coalesce(p_reason, '')), '')) where id = v_debt.id and user_id = auth.uid() returning * into v_debt;
  return v_debt;
end;
$function$;

create or replace function public.void_payment_atomic(
  p_customer_id uuid,
  p_payment_id uuid,
  p_reason text default null
)
returns public.payments
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_payment public.payments;
  v_principal numeric;
  v_active_paid numeric;
  v_debt_status text;
begin
  if auth.uid() is null then raise exception 'Kirish talab qilinadi.' using errcode = '42501'; end if;

  select p.* into v_payment from public.payments p where p.id = p_payment_id and p.customer_id = p_customer_id and p.user_id = auth.uid() and p.voided_at is null for update;
  if not found then raise exception 'To''lov topilmadi yoki allaqachon bekor qilingan.' using errcode = 'P0002'; end if;

  select d.principal, d.status into v_principal, v_debt_status from public.debts d where d.id = v_payment.debt_id and d.user_id = auth.uid() for update;
  if not found then raise exception 'Qarz topilmadi.' using errcode = 'P0002'; end if;

  update public.payments set voided_at = now(), void_reason = nullif(trim(coalesce(p_reason, '')), '') where id = v_payment.id and user_id = auth.uid() returning * into v_payment;

  if v_debt_status <> 'cancelled' then
    select coalesce(sum(p.amount), 0) into v_active_paid from public.payments p where p.debt_id = v_payment.debt_id and p.user_id = auth.uid() and p.voided_at is null;
    update public.debts set status = case when v_active_paid >= v_principal then 'paid' else 'open' end where id = v_payment.debt_id and user_id = auth.uid();
  end if;
  return v_payment;
end;
$function$;

grant execute on function public.cancel_credit_atomic(uuid, uuid, text) to authenticated;
grant execute on function public.void_payment_atomic(uuid, uuid, text) to authenticated;
