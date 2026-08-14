-- Keep customer creation and its optional opening debt in one transaction.
create or replace function public.create_customer_with_opening_debt(
  p_name text,
  p_phone text default null,
  p_address text default null,
  p_notes text default null,
  p_amount numeric default 0,
  p_due_date date default null
)
returns public.customers
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_customer public.customers;
begin
  if auth.uid() is null then
    raise exception 'Kirish talab qilinadi.' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Mijoz ismini kiriting.' using errcode = '22023';
  end if;

  if p_amount is null then
    p_amount := 0;
  end if;

  if p_amount < 0 then
    raise exception 'Qarz summasi manfiy bo''lmasin.' using errcode = '22023';
  end if;

  insert into public.customers (user_id, name, phone, address, notes)
  values (
    auth.uid(),
    trim(p_name),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_address, '')), ''),
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning * into v_customer;

  if p_amount > 0 then
    insert into public.debts (user_id, customer_id, principal, due_date, title)
    values (auth.uid(), v_customer.id, p_amount, p_due_date, 'Qarz');
  end if;

  return v_customer;
end;
$function$;

grant execute on function public.create_customer_with_opening_debt(text, text, text, text, numeric, date) to authenticated;
