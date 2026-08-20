-- Issue #63: keep customer-linked records inside one shop boundary.

do $$
begin
  if exists (
    select 1
    from public.reminders r
    left join public.customers c on c.id = r.customer_id
    where r.shop_id is null
       or c.id is null
       or r.shop_id is distinct from c.shop_id
  ) then
    raise exception 'Existing reminder/customer shop relationships are inconsistent.';
  end if;

  if exists (
    select 1
    from public.reminders r
    left join public.debts d on d.id = r.debt_id
    where r.debt_id is not null
      and (d.id is null or r.shop_id is distinct from d.shop_id or d.customer_id is distinct from r.customer_id)
  ) then
    raise exception 'Existing reminder/debt shop relationships are inconsistent.';
  end if;

  if exists (
    select 1
    from public.activity_logs a
    left join public.customers c on c.id = a.customer_id
    where a.shop_id is null
       or (a.customer_id is not null and (c.id is null or a.shop_id is distinct from c.shop_id))
  ) then
    raise exception 'Existing activity/customer shop relationships are inconsistent.';
  end if;
end;
$$;

alter table public.reminders
  alter column shop_id set not null;

alter table public.activity_logs
  alter column shop_id set not null;

create or replace function public.validate_reminder_relationship_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.customers c
    where c.id = new.customer_id
      and c.shop_id = new.shop_id
  ) then
    raise exception 'Customer does not belong to the reminder shop.' using errcode = '42501';
  end if;

  if new.debt_id is not null and not exists (
    select 1
    from public.debts d
    where d.id = new.debt_id
      and d.shop_id = new.shop_id
      and d.customer_id = new.customer_id
  ) then
    raise exception 'Debt does not belong to the reminder customer shop.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.validate_activity_relationship_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.customer_id is not null and not exists (
    select 1
    from public.customers c
    where c.id = new.customer_id
      and c.shop_id = new.shop_id
  ) then
    raise exception 'Customer does not belong to the activity shop.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_reminder_relationship_scope() from public, anon, authenticated;
revoke all on function public.validate_activity_relationship_scope() from public, anon, authenticated;

drop trigger if exists reminders_validate_relationship_scope on public.reminders;
create trigger reminders_validate_relationship_scope
before insert or update of shop_id, customer_id, debt_id on public.reminders
for each row execute function public.validate_reminder_relationship_scope();

drop trigger if exists activity_logs_validate_relationship_scope on public.activity_logs;
create trigger activity_logs_validate_relationship_scope
before insert or update of shop_id, customer_id on public.activity_logs
for each row execute function public.validate_activity_relationship_scope();
