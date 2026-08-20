-- Issue #77: preserve visible history for business records created before
-- the atomic activity triggers were installed.
-- The entity metadata checks make this safe to run once in production and
-- harmless if the migration is replayed in another environment.

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
  c.user_id,
  c.shop_id,
  c.id,
  'customer',
  c.name || ' qo''shildi.',
  jsonb_build_object('entity', 'customer', 'entity_id', c.id, 'operation', 'backfill'),
  c.created_at
from public.customers c
where c.shop_id is not null
  and not exists (
    select 1
    from public.activity_logs a
    where a.event_type = 'customer'
      and a.metadata->>'entity_id' = c.id::text
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
  d.user_id,
  d.shop_id,
  d.customer_id,
  'credit',
  coalesce(c.name, 'Mijoz') || 'ga ' || d.principal::text || ' qarz yozildi.',
  jsonb_build_object('entity', 'debt', 'entity_id', d.id, 'operation', 'backfill', 'status', d.status, 'amount', d.principal),
  d.created_at
from public.debts d
left join public.customers c on c.id = d.customer_id
where d.shop_id is not null
  and not exists (
    select 1
    from public.activity_logs a
    where a.event_type = 'credit'
      and a.metadata->>'entity_id' = d.id::text
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
  p.user_id,
  p.shop_id,
  p.customer_id,
  'payment',
  coalesce(c.name, 'Mijoz') || 'dan ' || p.amount::text || ' to''lov olindi.',
  jsonb_build_object('entity', 'payment', 'entity_id', p.id, 'operation', 'backfill', 'amount', p.amount, 'voided', p.voided_at is not null),
  coalesce(p.created_at, p.paid_at)
from public.payments p
left join public.customers c on c.id = p.customer_id
where p.shop_id is not null
  and not exists (
    select 1
    from public.activity_logs a
    where a.event_type = 'payment'
      and a.metadata->>'entity_id' = p.id::text
  );
