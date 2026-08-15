-- Keep reminder delivery failures visible without claiming a provider sent the message.
alter table public.reminders
  add column if not exists error_reason text;

alter table public.reminders
  drop constraint if exists reminders_status_check;

alter table public.reminders
  add constraint reminders_status_check check (status in ('pending', 'sent', 'failed', 'cancelled'));
