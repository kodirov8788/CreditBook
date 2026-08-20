-- Issue #48: preserve visible activity history for expenses and reminders
-- created before the atomic activity triggers were installed.
-- The entity-id checks make this migration safe to rerun.

insert into public.activity_logs (
  user_id,
  shop_id,
  customer_id,
  event_type,
  description,
  metadata,
  created_at
)
select
  e.user_id,
  e.shop_id,
  null,
  'expense',
  e.category || ' uchun ' || e.amount::text || ' xarajat yozildi.',
  jsonb_build_object(
    'entity', 'expense',
    'entity_id', e.id,
    'operation', 'backfill',
    'amount', e.amount,
    'voided', e.voided_at is not null
  ),
  e.created_at
from public.expenses e
where e.shop_id is not null
  and not exists (
    select 1
    from public.activity_logs a
    where a.event_type = 'expense'
      and a.metadata->>'entity_id' = e.id::text
  );

insert into public.activity_logs (
  user_id,
  shop_id,
  customer_id,
  event_type,
  description,
  metadata,
  created_at
)
select
  r.user_id,
  r.shop_id,
  r.customer_id,
  'reminder',
  coalesce(c.name, 'Mijoz') || ' uchun eslatma saqlandi.',
  jsonb_build_object(
    'entity', 'reminder',
    'entity_id', r.id,
    'operation', 'backfill',
    'status', r.status,
    'channel', r.channel
  ),
  r.created_at
from public.reminders r
left join public.customers c on c.id = r.customer_id
where r.shop_id is not null
  and not exists (
    select 1
    from public.activity_logs a
    where a.event_type = 'reminder'
      and a.metadata->>'entity_id' = r.id::text
  );
