\echo 'Checking shop dashboard/report aggregate read models'

begin;

create function public.shop_read_assert(ok boolean, label text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'PASS: %', label;
end;
$$;

create function public.shop_read_error(statement text, expected_state text, label text) returns void
language plpgsql security invoker as $$
declare actual_state text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate;
    if actual_state = expected_state then
      raise notice 'PASS: %', label;
      return;
    end if;
    raise exception 'FAIL: % expected %, got %', label, expected_state, actual_state;
  end;
  raise exception 'FAIL: % unexpectedly succeeded', label;
end;
$$;
grant execute on function public.shop_read_assert(boolean, text) to authenticated, anon;
grant execute on function public.shop_read_error(text, text, text) to authenticated, anon;

-- Keep fixture identities deterministic: the production signup trigger is
-- tested elsewhere and would otherwise create unrelated starter shops here.
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email, is_anonymous) values
  ('71000000-0000-4000-8000-000000000001', 'shop-read-owner@example.test', false),
  ('71000000-0000-4000-8000-000000000002', 'shop-read-cashier@example.test', false),
  ('71000000-0000-4000-8000-000000000003', 'shop-read-foreign@example.test', false),
  ('71000000-0000-4000-8000-000000000004', 'shop-read-empty@example.test', false);
alter table auth.users enable trigger on_auth_user_created;
insert into public.shops (id, owner_user_id, name) values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'Read model shop'),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000003', 'Foreign shop');
insert into public.profiles (id, full_name, current_shop_id) values
  ('71000000-0000-4000-8000-000000000001', 'Read owner', '72000000-0000-4000-8000-000000000001'),
  ('71000000-0000-4000-8000-000000000002', 'Read cashier', '72000000-0000-4000-8000-000000000001'),
  ('71000000-0000-4000-8000-000000000003', 'Foreign owner', '72000000-0000-4000-8000-000000000002'),
  ('71000000-0000-4000-8000-000000000004', 'Empty user', null);
insert into public.shop_members (shop_id, user_id, role, status) values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'shop_owner', 'active'),
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'cashier', 'active'),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', 'shop_owner', 'active'),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000003', 'shop_owner', 'active');

-- More than 1,100 rows prove the SQL aggregation itself retains every source
-- row. HTTP/PostgREST max-row behavior is an integration concern, not claimed
-- by this PostgreSQL-only fixture. IDs deliberately sort differently from
-- created_at so the UUID cursor contract is separately exercised from
-- parent-side UI sorting.
insert into public.customers (id, user_id, shop_id, name, phone, created_at)
select ('73000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001',
  'Customer ' || i, '998' || lpad(i::text, 9, '0'), now() - (i || ' seconds')::interval
from generate_series(1, 1105) i;
insert into public.debts (id, user_id, shop_id, customer_id, title, principal, due_date, created_at)
select ('74000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001',
  ('73000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'Bulk credit', 10,
  (now() at time zone 'UTC')::date + 10, now() - (i || ' seconds')::interval
from generate_series(1, 1105) i;
insert into public.payments (id, user_id, shop_id, customer_id, debt_id, amount, paid_at)
select ('75000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001', 1,
  now()
from generate_series(1, 1001) i;
insert into public.expenses (id, user_id, shop_id, category, amount, spent_at, created_at)
select ('76000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001',
  'Stock', 2, (now() at time zone 'UTC')::date - (i % 2), now() - (i || ' seconds')::interval
from generate_series(1, 1105) i;

insert into public.customers (id, user_id, shop_id, name, created_at) values
  ('73000000-0000-4000-8000-000000001106', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'Overdue customer', now()),
  ('73000000-0000-4000-8000-000000001107', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'Cancelled customer', now()),
  ('73000000-0000-4000-8000-000000001108', '71000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000002', 'Foreign customer', now()),
  ('73000000-0000-4000-8000-000000001109', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'Paid-old/future customer', now());
insert into public.debts (id, user_id, shop_id, customer_id, title, principal, due_date, status, created_at) values
  ('74000000-0000-4000-8000-000000001106', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000001106', 'Old unpaid', 100, (now() at time zone 'UTC')::date - 1, 'open', now() - interval '30 days'),
  ('74000000-0000-4000-8000-000000001107', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000001106', 'Future balance', 50, (now() at time zone 'UTC')::date + 30, 'open', now()),
  ('74000000-0000-4000-8000-000000001108', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000001107', 'Cancelled', 80, (now() at time zone 'UTC')::date - 1, 'cancelled', now()),
  ('74000000-0000-4000-8000-000000001109', '71000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000001108', 'Foreign', 999, (now() at time zone 'UTC')::date - 1, 'open', now()),
  ('74000000-0000-4000-8000-000000001110', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000001106', 'Decimal future', 0.30, (now() at time zone 'UTC')::date + 15, 'open', now()),
  ('74000000-0000-4000-8000-000000001111', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000001109', 'Paid old', 10, (now() at time zone 'UTC')::date - 2, 'open', now() - interval '30 days'),
  ('74000000-0000-4000-8000-000000001112', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000001109', 'Only future due', 20, (now() at time zone 'UTC')::date + 20, 'open', now());
insert into public.payments (id, user_id, shop_id, customer_id, debt_id, amount, paid_at, voided_at) values
  ('75000000-0000-4000-8000-000000001106', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000001106', '74000000-0000-4000-8000-000000001106', 10, now(), null),
  ('75000000-0000-4000-8000-000000001107', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000001107', '74000000-0000-4000-8000-000000001108', 80, now(), null),
  ('75000000-0000-4000-8000-000000001108', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000001106', '74000000-0000-4000-8000-000000001107', 20, now(), now()),
  ('75000000-0000-4000-8000-000000001109', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000001106', '74000000-0000-4000-8000-000000001110', 0.10, now(), null),
  ('75000000-0000-4000-8000-000000001110', '71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000001109', '74000000-0000-4000-8000-000000001111', 10, now(), null);

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);

create temp table shop_read_pages (kind text, payload jsonb);
do $$
declare cursor_id uuid := null; payload jsonb; seen integer := 0; previous uuid := null; item jsonb;
begin
  loop
    payload := public.shop_dashboard_page(cursor_id, 100);
    insert into shop_read_pages values ('dashboard', payload);
    foreach item in array coalesce(array(select value from jsonb_array_elements(payload->'summary')), array[]::jsonb[]) loop
      if previous is not null and (item->>'id')::uuid <= previous then raise exception 'FAIL: dashboard UUID keyset did not advance'; end if;
      previous := (item->>'id')::uuid; seen := seen + 1;
    end loop;
    exit when payload->>'nextCursor' is null;
    if cursor_id is not null and (payload->>'nextCursor')::uuid <= cursor_id then raise exception 'FAIL: dashboard cursor did not advance'; end if;
    cursor_id := (payload->>'nextCursor')::uuid;
  end loop;
  perform public.shop_read_assert(seen = 1108, 'dashboard traverses every current-shop customer without duplication');
end $$;
select public.shop_read_assert((select payload->>'shopId' = '72000000-0000-4000-8000-000000000001' from shop_read_pages limit 1), 'dashboard includes current shop ID');
select public.shop_read_assert((select (payload->'totals'->>'customers')::integer = 1108 from shop_read_pages limit 1), 'dashboard totals are global, not page-bound');
select public.shop_read_assert((select (payload->'totals'->>'outstanding')::numeric = 11200.20 from shop_read_pages limit 1), 'dashboard aggregates exact numeric outstanding balance across all pages');
select public.shop_read_assert((select (payload->'totals'->>'overdue')::numeric = 140.20 from shop_read_pages limit 1), 'dashboard overdue uses full customer balance for earliest unpaid due date');
select public.shop_read_assert((select (payload->'totals'->>'collectedThisMonth')::numeric = 1021.10 from shop_read_pages limit 1), 'dashboard excludes voided and cancelled-debt payments from monthly collection');
select public.shop_read_assert(jsonb_array_length(public.shop_dashboard_page(null, 1000)->'summary') = 1000 and public.shop_dashboard_page(null, 1000)->>'nextCursor' is not null, 'dashboard supports the maximum page size with lookahead');
select public.shop_read_assert(jsonb_array_length(public.shop_dashboard_page(null, 1)->'summary') = 1 and public.shop_dashboard_page(null, 1)->>'nextCursor' is not null, 'dashboard supports the minimum page size with lookahead');
select public.shop_read_assert(jsonb_array_length(public.shop_dashboard_page('73000000-0000-4000-8000-000000001109', 100)->'summary') = 0 and public.shop_dashboard_page('73000000-0000-4000-8000-000000001109', 100)->>'nextCursor' is null, 'dashboard cursor after final current-shop UUID is empty');

do $$
declare cursor_id uuid := null; payload jsonb; seen integer := 0; previous uuid := null; item jsonb;
begin
  loop
    payload := public.shop_report_page((now() at time zone 'UTC')::date - 2, (now() at time zone 'UTC')::date, cursor_id, 100);
    insert into shop_read_pages values ('report', payload);
    foreach item in array coalesce(array(select value from jsonb_array_elements(payload->'report'->'expenses')), array[]::jsonb[]) loop
      if previous is not null and (item->>'id')::uuid <= previous then raise exception 'FAIL: expense UUID keyset did not advance'; end if;
      previous := (item->>'id')::uuid; seen := seen + 1;
    end loop;
    exit when payload->>'nextCursor' is null;
    if cursor_id is not null and (payload->>'nextCursor')::uuid <= cursor_id then raise exception 'FAIL: expense cursor did not advance'; end if;
    cursor_id := (payload->>'nextCursor')::uuid;
  end loop;
  perform public.shop_read_assert(seen = 1105, 'report traverses every in-range expense without duplication');
end $$;
select public.shop_read_assert((select payload->>'shopId' = '72000000-0000-4000-8000-000000000001' from shop_read_pages where kind='report' limit 1), 'report includes current shop ID');
select public.shop_read_assert((select (payload->>'expenseCount')::integer = 1105 from shop_read_pages where kind='report' limit 1), 'report expense count is global, not page-bound');
select public.shop_read_assert((select (payload->'report'->>'collected')::numeric = 1101.10 from shop_read_pages where kind='report' limit 1), 'report includes nonvoid payment on cancelled debt and exact decimal payments, while excluding voided payment');
select public.shop_read_assert((select (payload->'report'->>'outstanding')::numeric = 11200.20 and (payload->'report'->>'overdueAmount')::numeric = 90 and (payload->'report'->>'overdueCount')::integer = 1 from shop_read_pages where kind='report' limit 1), 'report all-time balance and overdue metrics exclude cancelled debt and foreign-shop data');
with first_report as (select payload from shop_read_pages where kind='report' limit 1)
select public.shop_read_assert(
  (select sums.credits = (first_report.payload->'report'->>'newCredits')::numeric
    and sums.collected = (first_report.payload->'report'->>'collected')::numeric
    and sums.expenses = (first_report.payload->'report'->>'expensesTotal')::numeric
   from first_report
   cross join lateral (
     select coalesce(sum((month_row->>'credits')::numeric), 0) as credits,
       coalesce(sum((month_row->>'collected')::numeric), 0) as collected,
       coalesce(sum((month_row->>'expenses')::numeric), 0) as expenses
     from jsonb_array_elements(first_report.payload->'report'->'monthly') month_row
   ) sums),
  'monthly report totals sum exactly to the full-period aggregate');
select public.shop_read_assert(jsonb_array_length(public.shop_report_page((now() at time zone 'UTC')::date - 2, (now() at time zone 'UTC')::date, '76000000-0000-4000-8000-000000001105', 100)->'report'->'expenses') = 0, 'report cursor after final current-shop expense UUID is empty');
select public.shop_read_assert((public.shop_report_page((now() at time zone 'UTC')::date, (now() at time zone 'UTC')::date, null, 1)->'report'->>'collected')::numeric = 1101.10, 'UTC report date boundaries include payments made today');
select public.shop_read_assert(public.shop_dashboard_page('73000000-0000-4000-8000-000000001108', 1)->'summary'->0->>'due_date' = to_char((now() at time zone 'UTC')::date + 20, 'YYYY-MM-DD'), 'fully paid old debt does not make a future-only balance overdue');
select public.shop_read_error($$select public.shop_dashboard_page(null, 0)$$, '22023', 'dashboard rejects invalid page size');
select public.shop_read_error($$select public.shop_dashboard_page(null, 1001)$$, '22023', 'dashboard rejects page size above the maximum');
select public.shop_read_assert(jsonb_array_length(public.shop_report_page(null, null, null, 1000)->'report'->'expenses') = 1000, 'report supports bounded 1000-row pages');
select public.shop_read_error($$select public.shop_report_page(null, null, null, 1001)$$, '22023', 'report rejects page size above the maximum');
select public.shop_read_error($$select public.shop_report_page('2026-02-01', '2026-01-01', null, 100)$$, '22023', 'report rejects inverted date range');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', true);
select public.shop_read_assert((public.shop_dashboard_page(null, 1)->>'shopId') = '72000000-0000-4000-8000-000000000002' and (public.shop_dashboard_page(null, 1)->'totals'->>'customers')::integer = 1, 'foreign user resolves only their own current shop');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000004', true);
select public.shop_read_error($$select public.shop_dashboard_page(null, 1)$$, '42501', 'empty-shop user cannot call dashboard RPC');
reset role;
update public.shop_members set status = 'suspended' where shop_id='72000000-0000-4000-8000-000000000002' and user_id='71000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', true);
select public.shop_read_error($$select public.shop_dashboard_page(null, 1)$$, '42501', 'revoked current-shop membership cannot read a prior shop');

reset role;
update public.shop_members set role = 'shop_owner' where shop_id='72000000-0000-4000-8000-000000000001' and user_id='71000000-0000-4000-8000-000000000002';
update public.shop_members set role = 'cashier' where shop_id='72000000-0000-4000-8000-000000000001' and user_id='71000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select public.shop_read_assert(public.shop_dashboard_page(null, 1)->'summary' is not null, 'cashier keeps dashboard backward-compatible underlying reads');
select public.shop_read_error($$select public.shop_report_page(null, null, null, 1)$$, '42501', 'cashier cannot bypass report or expense permission');
reset role;
delete from public.role_permissions where role='cashier' and permission='payment.read';
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select public.shop_read_error($$select public.shop_dashboard_page(null, 1)$$, '42501', 'dashboard fails closed when an underlying permission is revoked');

reset role;
set local role anon;
select public.shop_read_error($$select public.shop_dashboard_page(null, 1)$$, '42501', 'anonymous role cannot execute dashboard RPC');
reset role;

-- Rehearse the documented non-destructive rollback/roll-forward mechanism.
-- No DROP/CREATE gap: preserve function identities, grants and caller RLS.
do $rollback_capacity$
declare fn regprocedure; definition text;
begin
  foreach fn in array array['public.shop_dashboard_page(uuid,integer)'::regprocedure, 'public.shop_report_page(date,date,uuid,integer)'::regprocedure] loop
    definition := pg_get_functiondef(fn);
    execute replace(replace(definition, 'p_limit > 1000', 'p_limit > 200'), 'between 1 and 1000', 'between 1 and 200');
  end loop;
end;
$rollback_capacity$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select public.shop_read_assert(jsonb_array_length(public.shop_dashboard_page(null, 100)->'summary') = 100, 'rollback preserves old-client reads and execute grant');
select public.shop_read_error($$select public.shop_dashboard_page(null, 1000)$$, '22023', 'rollback restores dashboard capacity200');
select public.shop_read_error($$select public.shop_report_page(null, null, null, 1000)$$, '22023', 'rollback restores report capacity200');
reset role;
do $restore_capacity$
declare fn regprocedure; definition text;
begin
  foreach fn in array array['public.shop_dashboard_page(uuid,integer)'::regprocedure, 'public.shop_report_page(date,date,uuid,integer)'::regprocedure] loop
    definition := pg_get_functiondef(fn);
    execute replace(replace(definition, 'p_limit > 200', 'p_limit > 1000'), 'between 1 and 200', 'between 1 and 1000');
  end loop;
end;
$restore_capacity$;
set local role authenticated;
select public.shop_read_assert(jsonb_array_length(public.shop_dashboard_page(null, 1000)->'summary') = 1000, 'roll-forward restores dashboard capacity1000');
select public.shop_read_assert(jsonb_array_length(public.shop_report_page(null, null, null, 1000)->'report'->'expenses') = 1000, 'roll-forward restores report capacity1000');
reset role;

rollback;
