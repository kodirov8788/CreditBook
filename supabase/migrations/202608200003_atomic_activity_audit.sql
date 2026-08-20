-- Issue #67: make business activity audit records durable and atomic.
--
-- Business writes must not depend on a second browser request to /api/activity.
-- These AFTER triggers write the audit row in the same transaction as the
-- customer, debt, payment, expense, or reminder mutation. If the audit insert
-- fails, the business mutation fails too.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Keep actor attribution when an account is later removed. Business history
-- remains readable while the nullable FK no longer deletes audit rows.
alter table public.activity_logs alter column user_id drop not null;
alter table public.activity_logs drop constraint if exists activity_logs_user_id_fkey;
alter table public.activity_logs
  add constraint activity_logs_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

create or replace function private.write_business_activity(
  p_shop_id uuid,
  p_actor_user_id uuid,
  p_customer_id uuid,
  p_event_type text,
  p_description text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
begin
  insert into public.activity_logs (
    user_id,
    shop_id,
    customer_id,
    event_type,
    description,
    metadata
  )
  values (
    coalesce(auth.uid(), p_actor_user_id),
    p_shop_id,
    p_customer_id,
    p_event_type,
    p_description,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('actor_user_id', coalesce(auth.uid(), p_actor_user_id))
  );
end;
$function$;

revoke all on function private.write_business_activity(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function private.audit_customer_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
begin
  perform private.write_business_activity(
    new.shop_id,
    new.user_id,
    new.id,
    'customer',
    case
      when tg_op = 'INSERT' then new.name || ' qo''shildi.'
      else new.name || ' ma''lumotlari yangilandi.'
    end,
    jsonb_build_object('entity', 'customer', 'entity_id', new.id, 'operation', lower(tg_op))
  );
  return new;
end;
$function$;

create or replace function private.audit_debt_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
declare
  v_customer_name text;
  v_description text;
begin
  select c.name into v_customer_name from public.customers c where c.id = new.customer_id;
  v_customer_name := coalesce(v_customer_name, 'Mijoz');

  v_description := case
    when tg_op = 'INSERT' then v_customer_name || 'ga ' || new.principal::text || ' qarz yozildi.'
    when old.status is distinct from new.status and new.status = 'cancelled' then v_customer_name || ' uchun ' || new.principal::text || ' qarz bekor qilindi.'
    when old.status is distinct from new.status and new.status = 'paid' then v_customer_name || 'ning qarzi yopildi.'
    else v_customer_name || 'ning qarz ma''lumotlari yangilandi.'
  end;

  perform private.write_business_activity(
    new.shop_id,
    new.user_id,
    new.customer_id,
    'credit',
    v_description,
    jsonb_build_object('entity', 'debt', 'entity_id', new.id, 'operation', lower(tg_op), 'status', new.status, 'amount', new.principal)
  );
  return new;
end;
$function$;

create or replace function private.audit_payment_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
declare
  v_customer_name text;
  v_description text;
begin
  select c.name into v_customer_name from public.customers c where c.id = new.customer_id;
  v_customer_name := coalesce(v_customer_name, 'Mijoz');

  v_description := case
    when tg_op = 'INSERT' then v_customer_name || 'dan ' || new.amount::text || ' to''lov olindi.'
    when old.voided_at is null and new.voided_at is not null then v_customer_name || 'dan ' || new.amount::text || ' to''lov bekor qilindi.'
    else v_customer_name || 'ning to''lov ma''lumotlari yangilandi.'
  end;

  perform private.write_business_activity(
    new.shop_id,
    new.user_id,
    new.customer_id,
    'payment',
    v_description,
    jsonb_build_object('entity', 'payment', 'entity_id', new.id, 'operation', lower(tg_op), 'amount', new.amount, 'voided', new.voided_at is not null)
  );
  return new;
end;
$function$;

create or replace function private.audit_expense_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
declare
  v_description text;
begin
  v_description := case
    when tg_op = 'INSERT' then new.category || ' uchun ' || new.amount::text || ' xarajat yozildi.'
    when old.voided_at is null and new.voided_at is not null then new.category || ' xarajati bekor qilindi.'
    else new.category || ' xarajati yangilandi.'
  end;

  perform private.write_business_activity(
    new.shop_id,
    new.user_id,
    null,
    'expense',
    v_description,
    jsonb_build_object('entity', 'expense', 'entity_id', new.id, 'operation', lower(tg_op), 'amount', new.amount, 'voided', new.voided_at is not null)
  );
  return new;
end;
$function$;

create or replace function private.audit_reminder_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
declare
  v_customer_name text;
  v_description text;
begin
  select c.name into v_customer_name from public.customers c where c.id = new.customer_id;
  v_customer_name := coalesce(v_customer_name, 'Mijoz');

  v_description := case
    when tg_op = 'INSERT' then v_customer_name || ' uchun eslatma saqlandi.'
    when old.status is distinct from new.status and new.status = 'sent' then v_customer_name || 'ga eslatma yuborildi.'
    when old.status is distinct from new.status and new.status = 'cancelled' then 'Eslatma bekor qilindi.'
    else v_customer_name || ' uchun eslatma yangilandi.'
  end;

  perform private.write_business_activity(
    new.shop_id,
    new.user_id,
    new.customer_id,
    'reminder',
    v_description,
    jsonb_build_object('entity', 'reminder', 'entity_id', new.id, 'operation', lower(tg_op), 'status', new.status)
  );
  return new;
end;
$function$;

revoke all on function private.audit_customer_change() from public, anon, authenticated;
revoke all on function private.audit_debt_change() from public, anon, authenticated;
revoke all on function private.audit_payment_change() from public, anon, authenticated;
revoke all on function private.audit_expense_change() from public, anon, authenticated;
revoke all on function private.audit_reminder_change() from public, anon, authenticated;

drop trigger if exists customers_audit_activity on public.customers;
create trigger customers_audit_activity
after insert or update on public.customers
for each row execute function private.audit_customer_change();

drop trigger if exists debts_audit_activity on public.debts;
create trigger debts_audit_activity
after insert or update on public.debts
for each row execute function private.audit_debt_change();

drop trigger if exists payments_audit_activity on public.payments;
create trigger payments_audit_activity
after insert or update on public.payments
for each row execute function private.audit_payment_change();

drop trigger if exists expenses_audit_activity on public.expenses;
create trigger expenses_audit_activity
after insert or update on public.expenses
for each row execute function private.audit_expense_change();

drop trigger if exists reminders_audit_activity on public.reminders;
create trigger reminders_audit_activity
after insert or update on public.reminders
for each row execute function private.audit_reminder_change();
