-- Existing accounts must retain their business identities and rows.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'legacy-owner@example.test');
create table public.g01_legacy_snapshot as
select id, owner_user_id, name, status from public.shops;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
insert into public.customers (id, name) values ('00000000-0000-4000-8000-000000000011', 'QA Legacy customer');
insert into public.debts (id, customer_id, principal) values
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000011', 100000);
insert into public.payments (customer_id, debt_id, amount) values
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012', 20000);
insert into public.expenses (category, amount) values ('QA Fixture', 5000);
-- Exercise a pending invitation that existed BEFORE the bootstrap replacement.
insert into auth.users (id, email, raw_user_meta_data)
select '00000000-0000-4000-8000-000000000009', 'legacy-invite@example.test',
  jsonb_build_object('creditbook_invite_shop_id', id::text)
from public.shops limit 1;
insert into public.shop_members (shop_id, user_id, role, status)
select id, '00000000-0000-4000-8000-000000000009', 'cashier', 'invited'
from public.shops limit 1;
create table public.g01_membership_snapshot as select * from public.shop_members;
create table public.g01_current_shop_snapshot as select id, current_shop_id from public.profiles;
create table public.g01_finance_snapshot as
select jsonb_build_object(
  'customers', (select jsonb_agg(to_jsonb(t) order by t.id) from public.customers t),
  'debts', (select jsonb_agg(to_jsonb(t) order by t.id) from public.debts t),
  'payments', (select jsonb_agg(to_jsonb(t) order by t.id) from public.payments t),
  'expenses', (select jsonb_agg(to_jsonb(t) order by t.id) from public.expenses t)
) as records;
