-- Issue #50: enforce reminder lifecycle transitions in the database.

create or replace function public.validate_reminder_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.status = 'sent' and new.status is distinct from old.status then
    raise exception 'Yuborilgan eslatma holatini qaytarib bo''lmaydi.' using errcode = '22023';
  end if;

  if old.status in ('failed', 'cancelled') and new.status is distinct from old.status then
    if new.status <> 'pending' or new.scheduled_for is not distinct from old.scheduled_for then
      raise exception 'Bu eslatmani qayta yuborish uchun yangi muddat belgilang.' using errcode = '22023';
    end if;
  end if;

  if new.status = 'pending' and new.status is distinct from old.status then
    new.sent_at := null;
    new.error_reason := null;
  elsif new.status = 'sent' then
    new.sent_at := coalesce(new.sent_at, now());
    new.error_reason := null;
  elsif new.status in ('failed', 'cancelled') then
    new.sent_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists reminders_validate_lifecycle on public.reminders;
create trigger reminders_validate_lifecycle
before update on public.reminders
for each row execute function public.validate_reminder_transition();

revoke all on function public.validate_reminder_transition() from public, anon, authenticated;
