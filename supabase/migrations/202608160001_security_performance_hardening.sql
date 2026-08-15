-- Keep static permission metadata readable without allowing client writes.
drop policy if exists "Authenticated users can read role permissions" on public.role_permissions;
create policy "Authenticated users can read role permissions"
  on public.role_permissions
  for select
  to authenticated
  using (true);

-- Cover foreign keys used by tenant-scoped history and membership queries.
create index if not exists activity_logs_customer_id_idx on public.activity_logs(customer_id);
create index if not exists activity_logs_user_id_idx on public.activity_logs(user_id);
create index if not exists payments_customer_id_idx on public.payments(customer_id);
create index if not exists payments_user_id_idx on public.payments(user_id);
create index if not exists reminders_customer_id_idx on public.reminders(customer_id);
create index if not exists reminders_debt_id_idx on public.reminders(debt_id);
create index if not exists reminders_user_id_idx on public.reminders(user_id);
create index if not exists shop_members_invited_by_idx on public.shop_members(invited_by);

-- Wrap stable auth and permission lookups in SELECT so PostgreSQL can evaluate
-- them once per statement instead of once per candidate row.
drop policy if exists "Users can view their profile" on public.profiles;
create policy "Users can view their profile"
  on public.profiles for select
  using (id = (select auth.uid()));

drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
  on public.profiles for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Users can view their platform role" on public.platform_roles;
create policy "Users can view their platform role"
  on public.platform_roles for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Customers creatable by permission" on public.customers;
create policy "Customers creatable by permission"
  on public.customers for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_shop_permission(shop_id, 'customer.create')));

drop policy if exists "Debts creatable by permission" on public.debts;
create policy "Debts creatable by permission"
  on public.debts for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_shop_permission(shop_id, 'debt.create')));

drop policy if exists "Payments creatable by permission" on public.payments;
create policy "Payments creatable by permission"
  on public.payments for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_shop_permission(shop_id, 'payment.create')));

drop policy if exists "Expenses creatable by permission" on public.expenses;
create policy "Expenses creatable by permission"
  on public.expenses for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_shop_permission(shop_id, 'expense.create')));

drop policy if exists "Reminders creatable by permission" on public.reminders;
create policy "Reminders creatable by permission"
  on public.reminders for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_shop_permission(shop_id, 'reminder.create')));

drop policy if exists "Activity creatable by permission" on public.activity_logs;
create policy "Activity creatable by permission"
  on public.activity_logs for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_shop_permission(shop_id, 'activity.create')));

drop policy if exists "Memberships readable by permission" on public.shop_members;
create policy "Memberships readable by permission"
  on public.shop_members for select to authenticated
  using ((select public.has_shop_permission(shop_id, 'member.read')) or user_id = (select auth.uid()));
