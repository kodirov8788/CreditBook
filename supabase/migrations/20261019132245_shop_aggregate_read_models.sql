-- Issue #3: bounded shop read models for dashboard and reporting pages.
--
-- These RPCs deliberately return one JSON value rather than a row set, so a
-- PostgREST max-rows setting cannot truncate aggregate results. They are
-- SECURITY INVOKER functions: current-shop membership, RLS and the caller's
-- underlying permissions remain in effect for every source relation.

begin;

create function public.shop_dashboard_page(
  p_after uuid default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_shop_id uuid := public.get_current_shop_id();
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'p_limit must be between 1 and 200' using errcode = '22023';
  end if;

  if v_shop_id is null
    or not public.is_shop_member(v_shop_id)
    or not public.has_shop_permission(v_shop_id, 'customer.read')
    or not public.has_shop_permission(v_shop_id, 'debt.read')
    or not public.has_shop_permission(v_shop_id, 'payment.read') then
    raise exception 'Current shop read access is required' using errcode = '42501';
  end if;

  return (
    with debt_balances as materialized (
      select d.id, d.customer_id, d.due_date,
        greatest(d.principal - coalesce(sum(p.amount) filter (where p.voided_at is null), 0), 0) as balance
      from public.debts d
      left join public.payments p on p.debt_id = d.id and p.shop_id = v_shop_id
      where d.shop_id = v_shop_id and d.status <> 'cancelled'
      group by d.id, d.customer_id, d.due_date, d.principal
    ), last_payments as materialized (
      select d.customer_id, max(p.paid_at) as last_payment
      from public.debts d
      join public.payments p on p.debt_id = d.id and p.shop_id = v_shop_id and p.voided_at is null
      where d.shop_id = v_shop_id and d.status <> 'cancelled'
      group by d.customer_id
    ), customer_rollups as materialized (
      select c.id, c.name, c.phone, c.created_at,
        coalesce(sum(db.balance), 0) as balance,
        min(db.due_date) filter (where db.balance > 0 and db.due_date is not null) as due_date,
        lp.last_payment
      from public.customers c
      left join debt_balances db on db.customer_id = c.id
      left join last_payments lp on lp.customer_id = c.id
      where c.shop_id = v_shop_id
      group by c.id, c.name, c.phone, c.created_at, lp.last_payment
    ), page_with_lookahead as materialized (
      select cr.*
      from customer_rollups cr
      where p_after is null or cr.id > p_after
      order by cr.id asc
      limit p_limit + 1
    ), page_rows as materialized (
      select * from page_with_lookahead order by id asc limit p_limit
    ), totals as materialized (
      select
        (select count(*) from public.customers c where c.shop_id = v_shop_id) as customers,
        count(*) filter (where cr.balance > 0) as active,
        coalesce(sum(cr.balance), 0) as outstanding,
        coalesce(sum(cr.balance) filter (where cr.due_date < (now() at time zone 'UTC')::date), 0) as overdue
      from customer_rollups cr
    ), collected as materialized (
      select coalesce(sum(p.amount), 0) as collected_this_month
      from public.payments p
      join public.debts d on d.id = p.debt_id and d.shop_id = v_shop_id
      where p.shop_id = v_shop_id
        and p.voided_at is null
        and d.status <> 'cancelled'
        and p.paid_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
        and p.paid_at < (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC'
    )
    select jsonb_build_object(
      'shopId', v_shop_id,
      'summary', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pr.id, 'name', pr.name, 'phone', pr.phone, 'balance', pr.balance,
        'due_date', pr.due_date, 'last_payment', pr.last_payment, 'created_at', pr.created_at
      ) order by pr.id asc) from page_rows pr), '[]'::jsonb),
      'totals', jsonb_build_object(
        'customers', t.customers, 'active', t.active, 'outstanding', t.outstanding,
        'overdue', t.overdue, 'collectedThisMonth', co.collected_this_month
      ),
      'nextCursor', case when (select count(*) from page_with_lookahead) > p_limit
        then (select id from page_rows order by id desc limit 1) else null end
    )
    from totals t cross join collected co
  );
end;
$function$;

create function public.shop_report_page(
  p_from date default null,
  p_to date default null,
  p_after uuid default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_shop_id uuid := public.get_current_shop_id();
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'p_limit must be between 1 and 200' using errcode = '22023';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'p_from must not be after p_to' using errcode = '22023';
  end if;

  if v_shop_id is null
    or not public.is_shop_member(v_shop_id)
    or not public.has_shop_permission(v_shop_id, 'report.read')
    or not public.has_shop_permission(v_shop_id, 'customer.read')
    or not public.has_shop_permission(v_shop_id, 'debt.read')
    or not public.has_shop_permission(v_shop_id, 'payment.read')
    or not public.has_shop_permission(v_shop_id, 'expense.read') then
    raise exception 'Current shop report access is required' using errcode = '42501';
  end if;

  return (
    with active_debts as materialized (
      select d.id, d.customer_id, d.principal, d.due_date, d.created_at,
        greatest(d.principal - coalesce(sum(p.amount) filter (where p.voided_at is null), 0), 0) as balance
      from public.debts d
      left join public.payments p on p.debt_id = d.id and p.shop_id = v_shop_id
      where d.shop_id = v_shop_id and d.status <> 'cancelled'
      group by d.id, d.customer_id, d.principal, d.due_date, d.created_at
    ), period_debts as materialized (
      select * from active_debts d
      where (p_from is null or (d.created_at at time zone 'UTC')::date >= p_from)
        and (p_to is null or (d.created_at at time zone 'UTC')::date <= p_to)
    ), period_payments as materialized (
      select p.* from public.payments p
      where p.shop_id = v_shop_id and p.voided_at is null
        and (p_from is null or (p.paid_at at time zone 'UTC')::date >= p_from)
        and (p_to is null or (p.paid_at at time zone 'UTC')::date <= p_to)
    ), period_expenses as materialized (
      select e.* from public.expenses e
      where e.shop_id = v_shop_id and e.voided_at is null
        and (p_from is null or e.spent_at >= p_from)
        and (p_to is null or e.spent_at <= p_to)
    ), page_with_lookahead as materialized (
      select e.* from period_expenses e
      where p_after is null or e.id > p_after
      order by e.id asc
      limit p_limit + 1
    ), page_rows as materialized (
      select * from page_with_lookahead order by id asc limit p_limit
    ), monthly as materialized (
      select month,
        coalesce(sum(credits), 0) as credits,
        coalesce(sum(collected), 0) as collected,
        coalesce(sum(expenses), 0) as expenses
      from (
        select to_char(d.created_at at time zone 'UTC', 'YYYY-MM') as month, d.principal as credits, 0::numeric as collected, 0::numeric as expenses from period_debts d
        union all
        select to_char(p.paid_at at time zone 'UTC', 'YYYY-MM'), 0::numeric, p.amount, 0::numeric from period_payments p
        union all
        select to_char(e.spent_at, 'YYYY-MM'), 0::numeric, 0::numeric, e.amount from period_expenses e
      ) entries
      group by month
    ), report_totals as materialized (
      select
        (select coalesce(sum(principal), 0) from period_debts) as new_credits,
        (select coalesce(sum(amount), 0) from period_payments) as collected,
        (select coalesce(sum(amount), 0) from period_expenses) as expenses_total,
        (select coalesce(sum(balance), 0) from active_debts) as outstanding,
        (select coalesce(sum(balance), 0) from active_debts where due_date < (now() at time zone 'UTC')::date and balance > 0) as overdue_amount,
        (select count(*) from active_debts where due_date < (now() at time zone 'UTC')::date and balance > 0) as overdue_count,
        (select count(distinct customer_id) from active_debts where balance > 0) as active_customers
    )
    select jsonb_build_object(
      'shopId', v_shop_id,
      'report', jsonb_build_object(
        'from', p_from, 'to', p_to, 'newCredits', rt.new_credits, 'collected', rt.collected,
        'expensesTotal', rt.expenses_total, 'netCashflow', rt.collected - rt.expenses_total,
        'outstanding', rt.outstanding, 'overdueAmount', rt.overdue_amount,
        'overdueCount', rt.overdue_count, 'activeCustomers', rt.active_customers,
        'monthly', coalesce((select jsonb_agg(jsonb_build_object(
          'month', m.month, 'credits', m.credits, 'collected', m.collected,
          'expenses', m.expenses, 'netCashflow', m.collected - m.expenses
        ) order by m.month asc) from monthly m), '[]'::jsonb),
        'expenses', coalesce((select jsonb_agg(jsonb_build_object(
          'id', pr.id, 'category', pr.category, 'amount', pr.amount, 'spent_at', pr.spent_at,
          'vendor', pr.vendor, 'note', pr.note, 'payment_method', pr.payment_method,
          'voided_at', pr.voided_at, 'void_reason', pr.void_reason, 'created_at', pr.created_at
        ) order by pr.id asc) from page_rows pr), '[]'::jsonb)
      ),
      'nextCursor', case when (select count(*) from page_with_lookahead) > p_limit
        then (select id from page_rows order by id desc limit 1) else null end,
      'expenseCount', (select count(*) from period_expenses)
    )
    from report_totals rt
  );
end;
$function$;

revoke all on function public.shop_dashboard_page(uuid, integer) from public, anon, authenticated;
revoke all on function public.shop_report_page(date, date, uuid, integer) from public, anon, authenticated;
grant execute on function public.shop_dashboard_page(uuid, integer) to authenticated;
grant execute on function public.shop_report_page(date, date, uuid, integer) to authenticated;

-- Rollback (manual, coordinated with the application rollout; never execute
-- automatically):
-- drop function if exists public.shop_dashboard_page(uuid, integer);
-- drop function if exists public.shop_report_page(date, date, uuid, integer);

commit;
