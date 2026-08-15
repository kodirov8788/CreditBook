-- Issue #39: enforce shop isolation and permissions with Supabase RLS.
-- This migration is intended to run after 202608150006_rbac_shop_model.sql.

create table if not exists public.role_permissions (
  role text not null check (role in ('shop_owner', 'manager', 'cashier', 'accountant', 'viewer')),
  permission text not null,
  primary key (role, permission)
);

create index if not exists role_permissions_permission_idx on public.role_permissions(permission);

insert into public.role_permissions (role, permission)
select role, permission
from (values
  ('shop_owner', 'shop.read'), ('shop_owner', 'shop.update'),
  ('shop_owner', 'member.read'), ('shop_owner', 'member.manage'),
  ('shop_owner', 'customer.read'), ('shop_owner', 'customer.create'), ('shop_owner', 'customer.update'),
  ('shop_owner', 'debt.read'), ('shop_owner', 'debt.create'), ('shop_owner', 'debt.update'), ('shop_owner', 'debt.cancel'),
  ('shop_owner', 'payment.read'), ('shop_owner', 'payment.create'), ('shop_owner', 'payment.void'),
  ('shop_owner', 'expense.read'), ('shop_owner', 'expense.create'), ('shop_owner', 'expense.update'), ('shop_owner', 'expense.void'),
  ('shop_owner', 'reminder.read'), ('shop_owner', 'reminder.create'), ('shop_owner', 'reminder.update'),
  ('shop_owner', 'activity.read'), ('shop_owner', 'activity.create'), ('shop_owner', 'activity.export'), ('shop_owner', 'report.read'),
  ('manager', 'shop.read'),
  ('manager', 'customer.read'), ('manager', 'customer.create'), ('manager', 'customer.update'),
  ('manager', 'debt.read'), ('manager', 'debt.create'), ('manager', 'debt.update'), ('manager', 'debt.cancel'),
  ('manager', 'payment.read'), ('manager', 'payment.create'), ('manager', 'payment.void'),
  ('manager', 'expense.read'), ('manager', 'expense.create'), ('manager', 'expense.update'), ('manager', 'expense.void'),
  ('manager', 'reminder.read'), ('manager', 'reminder.create'), ('manager', 'reminder.update'),
  ('manager', 'activity.read'), ('manager', 'activity.create'), ('manager', 'activity.export'), ('manager', 'report.read'),
  ('cashier', 'shop.read'),
  ('cashier', 'customer.read'), ('cashier', 'customer.create'), ('cashier', 'customer.update'),
  ('cashier', 'debt.read'), ('cashier', 'debt.create'), ('cashier', 'debt.update'),
  ('cashier', 'payment.read'), ('cashier', 'payment.create'),
  ('cashier', 'reminder.read'), ('cashier', 'reminder.create'), ('cashier', 'reminder.update'),
  ('cashier', 'activity.read'), ('cashier', 'activity.create'),
  ('accountant', 'shop.read'),
  ('accountant', 'customer.read'), ('accountant', 'debt.read'), ('accountant', 'payment.read'),
  ('accountant', 'expense.read'), ('accountant', 'expense.create'), ('accountant', 'expense.update'), ('accountant', 'expense.void'),
  ('accountant', 'activity.read'), ('accountant', 'activity.export'), ('accountant', 'report.read'),
  ('viewer', 'shop.read'), ('viewer', 'customer.read'), ('viewer', 'debt.read'), ('viewer', 'payment.read'),
  ('viewer', 'expense.read'), ('viewer', 'reminder.read'), ('viewer', 'activity.read'), ('viewer', 'report.read')
) as seed(role, permission)
on conflict (role, permission) do nothing;

alter table public.role_permissions enable row level security;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_roles
    where user_id = auth.uid()
      and role in ('platform_owner', 'platform_admin')
  );
$$;

create or replace function public.is_shop_member(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.shop_members m
    join public.shops s on s.id = m.shop_id
    where m.shop_id = p_shop_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and s.status = 'active'
  );
$$;

create or replace function public.has_shop_permission(p_shop_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.shop_members m
    join public.role_permissions rp on rp.role = m.role
    join public.shops s on s.id = m.shop_id
    where m.shop_id = p_shop_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and s.status = 'active'
      and rp.permission = p_permission
  );
$$;

create or replace function public.get_current_shop_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.shop_id
  from public.shop_members m
  join public.shops s on s.id = m.shop_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and s.status = 'active'
  order by (m.role = 'shop_owner') desc, m.created_at, m.shop_id
  limit 1;
$$;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_shop_member(uuid) to authenticated;
grant execute on function public.has_shop_permission(uuid, text) to authenticated;
grant execute on function public.get_current_shop_id() to authenticated;

-- Existing writers do not yet send shop_id. Fill it server-side and prevent
-- updates from moving a record between tenants.
create or replace function public.populate_shop_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.shop_id is distinct from old.shop_id then
    raise exception 'Shop scope cannot be changed.' using errcode = '42501';
  end if;

  if new.shop_id is null then
    new.shop_id := public.get_current_shop_id();
  end if;

  if new.shop_id is null then
    raise exception 'Faol shop topilmadi.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists customers_populate_shop_scope on public.customers;
create trigger customers_populate_shop_scope before insert or update on public.customers for each row execute function public.populate_shop_scope();
drop trigger if exists debts_populate_shop_scope on public.debts;
create trigger debts_populate_shop_scope before insert or update on public.debts for each row execute function public.populate_shop_scope();
drop trigger if exists payments_populate_shop_scope on public.payments;
create trigger payments_populate_shop_scope before insert or update on public.payments for each row execute function public.populate_shop_scope();
drop trigger if exists expenses_populate_shop_scope on public.expenses;
create trigger expenses_populate_shop_scope before insert or update on public.expenses for each row execute function public.populate_shop_scope();
drop trigger if exists reminders_populate_shop_scope on public.reminders;
create trigger reminders_populate_shop_scope before insert or update on public.reminders for each row execute function public.populate_shop_scope();
drop trigger if exists activity_logs_populate_shop_scope on public.activity_logs;
create trigger activity_logs_populate_shop_scope before insert or update on public.activity_logs for each row execute function public.populate_shop_scope();

-- Child records must belong to the same shop as their customer/debt.
create or replace function public.validate_customer_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_customer_shop_id uuid;
begin
  select c.shop_id into v_customer_shop_id from public.customers c where c.id = new.customer_id;
  if v_customer_shop_id is null or new.shop_id is distinct from v_customer_shop_id then
    raise exception 'Customer does not belong to the current shop.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.validate_payment_debt_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_debt_shop_id uuid;
begin
  select d.shop_id into v_debt_shop_id from public.debts d where d.id = new.debt_id;
  if v_debt_shop_id is null or new.shop_id is distinct from v_debt_shop_id then
    raise exception 'Debt does not belong to the current shop.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists debts_validate_customer_owner on public.debts;
create trigger debts_validate_customer_owner before insert or update on public.debts for each row execute function public.validate_customer_owner();
drop trigger if exists payments_validate_customer_owner on public.payments;
create trigger payments_validate_customer_owner before insert or update on public.payments for each row execute function public.validate_customer_owner();
drop trigger if exists payments_validate_debt_scope on public.payments;
create trigger payments_validate_debt_scope before insert or update on public.payments for each row execute function public.validate_payment_debt_scope();

-- Replace legacy account-only policies with tenant + permission policies.
drop policy if exists "Users own customers" on public.customers;
create policy "Customers readable by permission" on public.customers for select to authenticated using (public.has_shop_permission(shop_id, 'customer.read'));
create policy "Customers creatable by permission" on public.customers for insert to authenticated with check (user_id = auth.uid() and public.has_shop_permission(shop_id, 'customer.create'));
create policy "Customers editable by permission" on public.customers for update to authenticated using (public.has_shop_permission(shop_id, 'customer.update')) with check (public.has_shop_permission(shop_id, 'customer.update'));

drop policy if exists "Users own debts" on public.debts;
create policy "Debts readable by permission" on public.debts for select to authenticated using (public.has_shop_permission(shop_id, 'debt.read'));
create policy "Debts creatable by permission" on public.debts for insert to authenticated with check (user_id = auth.uid() and public.has_shop_permission(shop_id, 'debt.create'));
create policy "Debts editable by permission" on public.debts for update to authenticated using (public.has_shop_permission(shop_id, 'debt.update') or public.has_shop_permission(shop_id, 'debt.cancel')) with check (public.has_shop_permission(shop_id, 'debt.update') or public.has_shop_permission(shop_id, 'debt.cancel'));

drop policy if exists "Users own payments" on public.payments;
create policy "Payments readable by permission" on public.payments for select to authenticated using (public.has_shop_permission(shop_id, 'payment.read'));
create policy "Payments creatable by permission" on public.payments for insert to authenticated with check (user_id = auth.uid() and public.has_shop_permission(shop_id, 'payment.create'));
create policy "Payments voidable by permission" on public.payments for update to authenticated using (public.has_shop_permission(shop_id, 'payment.void')) with check (public.has_shop_permission(shop_id, 'payment.void'));

drop policy if exists "Users own expenses" on public.expenses;
create policy "Expenses readable by permission" on public.expenses for select to authenticated using (public.has_shop_permission(shop_id, 'expense.read'));
create policy "Expenses creatable by permission" on public.expenses for insert to authenticated with check (user_id = auth.uid() and public.has_shop_permission(shop_id, 'expense.create'));
create policy "Expenses editable by permission" on public.expenses for update to authenticated using (public.has_shop_permission(shop_id, 'expense.update') or public.has_shop_permission(shop_id, 'expense.void')) with check (public.has_shop_permission(shop_id, 'expense.update') or public.has_shop_permission(shop_id, 'expense.void'));

drop policy if exists "Users own reminders" on public.reminders;
create policy "Reminders readable by permission" on public.reminders for select to authenticated using (public.has_shop_permission(shop_id, 'reminder.read'));
create policy "Reminders creatable by permission" on public.reminders for insert to authenticated with check (user_id = auth.uid() and public.has_shop_permission(shop_id, 'reminder.create'));
create policy "Reminders editable by permission" on public.reminders for update to authenticated using (public.has_shop_permission(shop_id, 'reminder.update')) with check (public.has_shop_permission(shop_id, 'reminder.update'));

drop policy if exists "Users own activity logs" on public.activity_logs;
create policy "Activity readable by permission" on public.activity_logs for select to authenticated using (public.has_shop_permission(shop_id, 'activity.read'));
create policy "Activity creatable by permission" on public.activity_logs for insert to authenticated with check (user_id = auth.uid() and public.has_shop_permission(shop_id, 'activity.create'));

drop policy if exists "Owners can view their shops" on public.shops;
create policy "Shops readable by permission" on public.shops for select to authenticated using (public.has_shop_permission(id, 'shop.read'));
create policy "Shops editable by permission" on public.shops for update to authenticated using (public.has_shop_permission(id, 'shop.update')) with check (public.has_shop_permission(id, 'shop.update'));

drop policy if exists "Users can view their memberships" on public.shop_members;
create policy "Memberships readable by permission" on public.shop_members for select to authenticated using (public.has_shop_permission(shop_id, 'member.read') or user_id = auth.uid());
create policy "Memberships manageable by permission" on public.shop_members for all to authenticated using (public.has_shop_permission(shop_id, 'member.manage')) with check (public.has_shop_permission(shop_id, 'member.manage'));

-- Keep profiles private; platform roles and role permissions are server-managed.
drop policy if exists "Users can view their platform role" on public.platform_roles;
create policy "Users can view their platform role" on public.platform_roles for select to authenticated using (user_id = auth.uid());

-- Legacy RPCs now use the current shop rather than the creator account.
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
  v_shop_id uuid := public.get_current_shop_id();
  v_debt record;
  v_paid numeric;
  v_open numeric;
  v_part numeric;
  v_left numeric := p_amount;
  v_payments jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or v_shop_id is null then
    raise exception 'Kirish talab qilinadi.' using errcode = '42501';
  end if;
  if not public.has_shop_permission(v_shop_id, 'payment.create') then
    raise exception 'To''lov yozish huquqi yo''q.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'To''lov summasini kiriting.' using errcode = '22023';
  end if;

  for v_debt in
    select d.id, d.principal
    from public.debts d
    where d.shop_id = v_shop_id
      and d.customer_id = p_customer_id
      and d.status = 'open'
    order by d.created_at, d.id
    for update
  loop
    select coalesce(sum(p.amount), 0) into v_paid
    from public.payments p
    where p.shop_id = v_shop_id
      and p.debt_id = v_debt.id
      and p.voided_at is null;
    v_open := greatest(v_debt.principal - v_paid, 0);
    if v_open > 0 and v_left > 0 then
      v_part := least(v_left, v_open);
      insert into public.payments (user_id, shop_id, customer_id, debt_id, amount, note)
      values (auth.uid(), v_shop_id, p_customer_id, v_debt.id, v_part, nullif(trim(coalesce(p_note, '')), ''));
      if v_part >= v_open then
        update public.debts set status = 'paid' where id = v_debt.id and shop_id = v_shop_id;
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
  v_shop_id uuid := public.get_current_shop_id();
  v_debt public.debts;
  v_active_payments integer;
begin
  if auth.uid() is null or v_shop_id is null then
    raise exception 'Kirish talab qilinadi.' using errcode = '42501';
  end if;
  if not public.has_shop_permission(v_shop_id, 'debt.cancel') then
    raise exception 'Qarzni bekor qilish huquqi yo''q.' using errcode = '42501';
  end if;

  select d.* into v_debt
  from public.debts d
  where d.id = p_debt_id and d.customer_id = p_customer_id and d.shop_id = v_shop_id
  for update;
  if not found then
    raise exception 'Qarz topilmadi.' using errcode = 'P0002';
  end if;

  select count(*) into v_active_payments
  from public.payments p
  where p.debt_id = v_debt.id and p.shop_id = v_shop_id and p.voided_at is null;
  if v_active_payments > 0 then
    raise exception 'To''lovli qarzni bekor qilishdan oldin to''lovni bekor qiling.' using errcode = '22023';
  end if;

  update public.debts
  set status = 'cancelled', notes = concat_ws(E'\n', nullif(notes, ''), nullif(trim(coalesce(p_reason, '')), ''))
  where id = v_debt.id and shop_id = v_shop_id
  returning * into v_debt;
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
  v_shop_id uuid := public.get_current_shop_id();
  v_payment public.payments;
  v_principal numeric;
  v_active_paid numeric;
  v_debt_status text;
begin
  if auth.uid() is null or v_shop_id is null then
    raise exception 'Kirish talab qilinadi.' using errcode = '42501';
  end if;
  if not public.has_shop_permission(v_shop_id, 'payment.void') then
    raise exception 'To''lovni bekor qilish huquqi yo''q.' using errcode = '42501';
  end if;

  select p.* into v_payment
  from public.payments p
  where p.id = p_payment_id and p.customer_id = p_customer_id and p.shop_id = v_shop_id and p.voided_at is null
  for update;
  if not found then
    raise exception 'To''lov topilmadi yoki allaqachon bekor qilingan.' using errcode = 'P0002';
  end if;

  select d.principal, d.status into v_principal, v_debt_status
  from public.debts d
  where d.id = v_payment.debt_id and d.shop_id = v_shop_id
  for update;
  if not found then
    raise exception 'Qarz topilmadi.' using errcode = 'P0002';
  end if;

  update public.payments
  set voided_at = now(), void_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = v_payment.id and shop_id = v_shop_id
  returning * into v_payment;

  if v_debt_status <> 'cancelled' then
    select coalesce(sum(p.amount), 0) into v_active_paid
    from public.payments p
    where p.debt_id = v_payment.debt_id and p.shop_id = v_shop_id and p.voided_at is null;
    update public.debts
    set status = case when v_active_paid >= v_principal then 'paid' else 'open' end
    where id = v_payment.debt_id and shop_id = v_shop_id;
  end if;
  return v_payment;
end;
$function$;

grant execute on function public.cancel_credit_atomic(uuid, uuid, text) to authenticated;
grant execute on function public.void_payment_atomic(uuid, uuid, text) to authenticated;
