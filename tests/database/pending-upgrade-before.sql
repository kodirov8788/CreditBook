-- Only the newly owned disposable PostgreSQL runner calls this fixture.
-- Earlier fixture includes two legacy accounts, separate currencies, shops,
-- memberships and a customer. Add shop financial history before the upgrade.
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', false);
insert into public.debts(id,user_id,shop_id,customer_id,title,principal,due_date)
values ('90000000-0000-4000-8000-000000000031',
 '90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000021',
 '90000000-0000-4000-8000-000000000023','Synthetic preserved debt',1000,'2026-01-01');
insert into public.payments(id,user_id,shop_id,customer_id,debt_id,amount)
values ('90000000-0000-4000-8000-000000000032',
 '90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000021',
 '90000000-0000-4000-8000-000000000023','90000000-0000-4000-8000-000000000031',100);
insert into public.expenses(id,user_id,shop_id,category,amount,spent_at)
values ('90000000-0000-4000-8000-000000000033',
 '90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000021',
 'Synthetic expense',50,'2026-01-01');
insert into public.reminders(id,user_id,shop_id,customer_id,channel,message,scheduled_for)
values ('90000000-0000-4000-8000-000000000034',
 '90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000021',
 '90000000-0000-4000-8000-000000000023','manual','Synthetic reminder','2026-01-02');

-- Prove the old backfill is safe even on populated history; never repair the
-- hosted migration table to hide a filename mismatch.
update public.pilot_data_snapshot set records=public.pilot_preserved_data();
create table public.upgrade_auth_snapshot as
 select jsonb_agg(to_jsonb(u) order by u.id) as records from auth.users u;
create table public.upgrade_function_snapshot as
 select p.oid,pg_get_functiondef(p.oid) as definition from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f';
create table public.upgrade_policy_snapshot as
 select * from pg_policies where schemaname='public' and tablename not like 'personal_%';
create table public.upgrade_trigger_snapshot as
 select t.oid,pg_get_triggerdef(t.oid) as definition from pg_trigger t
 join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where not t.tgisinternal and n.nspname in ('auth','public') and c.relname not like 'personal_%';
