-- Track outgoing cash separately from receivables and customer payments.
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  category text not null check (char_length(trim(category)) >= 2),
  amount numeric(14, 2) not null check (amount > 0),
  spent_at date not null default current_date,
  vendor text,
  note text,
  payment_method text not null default 'cash' check (payment_method in ('cash', 'card', 'bank', 'other')),
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now()
);

create index if not exists expenses_user_spent_at_idx on public.expenses(user_id, spent_at desc);
alter table public.expenses enable row level security;
drop policy if exists "Users own expenses" on public.expenses;
create policy "Users own expenses" on public.expenses for all using (user_id = auth.uid()) with check (user_id = auth.uid());
