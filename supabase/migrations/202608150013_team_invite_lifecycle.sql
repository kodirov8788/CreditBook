-- Issue #37: keep invitation cancellation distinct from a suspended member.
alter table public.shop_members drop constraint if exists shop_members_status_check;
alter table public.shop_members add constraint shop_members_status_check
  check (status in ('active', 'invited', 'suspended', 'cancelled'));
