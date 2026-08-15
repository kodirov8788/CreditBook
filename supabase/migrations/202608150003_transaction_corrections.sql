-- Preserve transaction history while allowing safe corrections.
alter table public.payments
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;

create or replace function public.cancel_credit_atomic(
  p_customer_id uuid,
  p_debt_id uuid,
  p_reason text default null
)
returns public.debts
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_debt public.debts;
  v_active_payments integer;
begin
  if auth.uid() is null then
    raise exception 'Kirish talab qilinadi.' using errcode = '42501';
  end if;

  select d.*
    into v_debt
    from public.debts d
   where d.id = p_debt_id
     and d.customer_id = p_customer_id
     and d.user_id = auth.uid()
   for update;

  if not found then
    raise exception 'Qarz topilmadi.' using errcode = 'P0002';
  end if;

  select count(*)
    into v_active_payments
    from public.payments p
   where p.debt_id = v_debt.id
     and p.user_id = auth.uid()
     and p.voided_at is null;

  if v_active_payments > 0 then
    raise exception 'To''lovli qarzni bekor qilishdan oldin to''lovni bekor qiling.' using errcode = '22023';
  end if;

  update public.debts
     set status = 'cancelled',
         notes = concat_ws(E'\n', nullif(notes, ''), nullif(trim(coalesce(p_reason, '')), ''))
   where id = v_debt.id
     and user_id = auth.uid()
   returning * into v_debt;

  return v_debt;
end;
$function$;

create or replace function public.void_payment_atomic(
  p_customer_id uuid,
  p_payment_id uuid,
  p_reason text default null
)
returns public.payments
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_payment public.payments;
  v_principal numeric;
  v_active_paid numeric;
  v_debt_status text;
begin
  if auth.uid() is null then
    raise exception 'Kirish talab qilinadi.' using errcode = '42501';
  end if;

  select p.*
    into v_payment
    from public.payments p
   where p.id = p_payment_id
     and p.customer_id = p_customer_id
     and p.user_id = auth.uid()
     and p.voided_at is null
   for update;

  if not found then
    raise exception 'To''lov topilmadi yoki allaqachon bekor qilingan.' using errcode = 'P0002';
  end if;

  select d.principal, d.status
    into v_principal, v_debt_status
    from public.debts d
   where d.id = v_payment.debt_id
     and d.user_id = auth.uid()
   for update;

  if not found then
    raise exception 'Qarz topilmadi.' using errcode = 'P0002';
  end if;

  update public.payments
     set voided_at = now(),
         void_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = v_payment.id
     and user_id = auth.uid()
   returning * into v_payment;

  if v_debt_status <> 'cancelled' then
    select coalesce(sum(p.amount), 0)
      into v_active_paid
      from public.payments p
     where p.debt_id = v_payment.debt_id
       and p.user_id = auth.uid()
       and p.voided_at is null;

    update public.debts
       set status = case when v_active_paid >= v_principal then 'paid' else 'open' end
     where id = v_payment.debt_id
       and user_id = auth.uid();
  end if;

  return v_payment;
end;
$function$;

grant execute on function public.cancel_credit_atomic(uuid, uuid, text) to authenticated;
grant execute on function public.void_payment_atomic(uuid, uuid, text) to authenticated;
