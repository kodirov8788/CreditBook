-- Serialize payments for a customer and keep allocation + debt status updates atomic.
create or replace function public.record_payment_atomic(
  p_customer_id uuid,
  p_amount numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_debt record;
  v_paid numeric;
  v_open numeric;
  v_part numeric;
  v_left numeric := p_amount;
  v_payments jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Kirish talab qilinadi.' using errcode = '42501';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'To''lov summasini kiriting.' using errcode = '22023';
  end if;

  -- Every writer using this function locks the customer's open debts first.
  -- A second concurrent payment waits, then re-reads the committed balance.
  for v_debt in
    select d.id, d.principal
    from public.debts d
    where d.user_id = auth.uid()
      and d.customer_id = p_customer_id
      and d.status = 'open'
    order by d.created_at, d.id
    for update
  loop
    select coalesce(sum(p.amount), 0)
      into v_paid
      from public.payments p
     where p.user_id = auth.uid()
       and p.debt_id = v_debt.id;

    v_open := greatest(v_debt.principal - v_paid, 0);
    if v_open > 0 and v_left > 0 then
      v_part := least(v_left, v_open);

      insert into public.payments (user_id, customer_id, debt_id, amount, note)
      values (auth.uid(), p_customer_id, v_debt.id, v_part, nullif(trim(coalesce(p_note, '')), ''));

      if v_part >= v_open then
        update public.debts
           set status = 'paid'
         where id = v_debt.id
           and user_id = auth.uid();
      end if;

      v_left := v_left - v_part;
      v_payments := v_payments || jsonb_build_array(jsonb_build_object('debt_id', v_debt.id, 'amount', v_part));
    end if;
  end loop;

  if v_left > 0 or jsonb_array_length(v_payments) = 0 then
    raise exception 'To''lov qoldiqdan oshmasin.' using errcode = '22023';
  end if;

  return jsonb_build_object('paid', p_amount, 'payments', v_payments);
end;
$function$;

grant execute on function public.record_payment_atomic(uuid, numeric, text) to authenticated;
