-- Disposable PostgreSQL fixture only. Called BEFORE the pilot migration.
-- No production DSN, real identity, auth token or secret is used.
insert into auth.users (id, email, raw_user_meta_data) values
 ('90000000-0000-4000-8000-000000000001', 'pilot-a@fixture.test', '{}'),
 ('90000000-0000-4000-8000-000000000002', 'not-pilot@fixture.test', '{"personal_pilot":true,"role":"platform_owner"}'),
 ('90000000-0000-4000-8000-000000000003', 'pilot-b@fixture.test', '{}');
-- Create a verified-user fixture without an existing workspace, without deleting
-- any historical row: the anonymous signup branch deliberately skips provisioning.
insert into auth.users (id, email, is_anonymous) values
 ('90000000-0000-4000-8000-000000000004', 'no-workspace@fixture.test', true);
update auth.users set is_anonymous=false where id='90000000-0000-4000-8000-000000000004';
-- Explicit synthetic shop fixtures, independent of the personal allowlist.
insert into public.shops(id, owner_user_id, name) values
 ('90000000-0000-4000-8000-000000000021', '90000000-0000-4000-8000-000000000002', 'Non-pilot shop'),
 ('90000000-0000-4000-8000-000000000022', '90000000-0000-4000-8000-000000000001', 'Other shop');
insert into public.shop_members(shop_id, user_id, role, status) values
 ('90000000-0000-4000-8000-000000000021', '90000000-0000-4000-8000-000000000002', 'shop_owner', 'active'),
 ('90000000-0000-4000-8000-000000000022', '90000000-0000-4000-8000-000000000001', 'shop_owner', 'active'),
 ('90000000-0000-4000-8000-000000000021', '90000000-0000-4000-8000-000000000004', 'cashier', 'invited');
update public.profiles set current_shop_id='90000000-0000-4000-8000-000000000021' where id='90000000-0000-4000-8000-000000000002';
insert into public.platform_roles(user_id, role) values ('90000000-0000-4000-8000-000000000003', 'platform_admin');

set role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', false);
select public.ensure_my_personal_workspace();
select public.create_personal_account(
 '{"name":"Pilot A","currencyCode":"JPY","openingAmountMinor":"10000","openingDate":"2026-01-01","timeZone":"Asia/Tokyo"}',
 '90000000-0000-4000-8000-000000000011');
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', false);
select public.ensure_my_personal_workspace();
select public.create_personal_account(
 '{"name":"Not pilot","currencyCode":"USD","openingAmountMinor":"200","openingDate":"2026-01-01","timeZone":"Asia/Tokyo"}',
 '90000000-0000-4000-8000-000000000012');
reset role;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', false);
insert into public.customers(id, name) values ('90000000-0000-4000-8000-000000000023', 'Preserved customer');

create function public.pilot_assert(ok boolean, label text) returns void
language plpgsql as $$ begin
 if ok is distinct from true then raise exception 'FAIL: %', label; end if;
 raise notice 'PASS: %', label;
end; $$;
create function public.pilot_denied(statement text, label text) returns void
language plpgsql security invoker as $$ begin
 begin execute statement;
 exception when insufficient_privilege then raise notice 'PASS: %', label; return;
 end;
 raise exception 'FAIL (not denied): %', label;
end; $$;

-- Compare actual rows, not dashboard counts. Functions/policies/triggers for
-- existing shop behavior must be byte-for-byte identical after this migration.
create function public.pilot_preserved_data() returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_object_agg(t.table_name, t.rows)
 from (
  select 'shops' as table_name, (select jsonb_agg(to_jsonb(r) order by r.id) from public.shops r) as rows
  union all select 'profiles', (select jsonb_agg(to_jsonb(r) order by r.id) from public.profiles r)
  union all select 'members', (select jsonb_agg(to_jsonb(r) order by r.id) from public.shop_members r)
  union all select 'roles', (select jsonb_agg(to_jsonb(r) order by r.user_id) from public.platform_roles r)
  union all select 'role_permissions', (select jsonb_agg(to_jsonb(r) order by r.role,r.permission) from public.role_permissions r)
  union all select 'audit_logs', (select jsonb_agg(to_jsonb(r) order by r.id) from public.audit_logs r)
  union all select 'customers', (select jsonb_agg(to_jsonb(r) order by r.id) from public.customers r)
  union all select 'debts', (select jsonb_agg(to_jsonb(r) order by r.id) from public.debts r)
  union all select 'payments', (select jsonb_agg(to_jsonb(r) order by r.id) from public.payments r)
  union all select 'expenses', (select jsonb_agg(to_jsonb(r) order by r.id) from public.expenses r)
  union all select 'reminders', (select jsonb_agg(to_jsonb(r) order by r.id) from public.reminders r)
  union all select 'activity', (select jsonb_agg(to_jsonb(r) order by r.id) from public.activity_logs r)
  union all select 'workspaces', (select jsonb_agg(to_jsonb(r) order by r.id) from public.personal_workspaces r)
  union all select 'accounts', (select jsonb_agg(to_jsonb(r) order by r.id) from public.personal_accounts r)
  union all select 'postings', (select jsonb_agg(to_jsonb(r) order by r.id) from public.personal_postings r)
  union all select 'preferences', (select jsonb_agg(to_jsonb(r) order by r.workspace_id) from public.personal_workspace_preferences r)
  union all select 'audit', (select jsonb_agg(to_jsonb(r) order by r.id) from public.personal_audit_events r)
  union all select 'receipts', (select jsonb_agg(to_jsonb(r) order by r.id) from creditbook_private.personal_command_receipts r)
 ) t;
$$;
revoke all on function public.pilot_preserved_data() from public, anon, authenticated, service_role;
create table public.pilot_data_snapshot as select public.pilot_preserved_data() as records;
create table public.pilot_function_snapshot as
 select p.oid, pg_get_functiondef(p.oid) as definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f';
create table public.pilot_policy_snapshot as
 select * from pg_policies where schemaname='public' and tablename not like 'personal_%';
create table public.pilot_trigger_snapshot as
 select t.oid, pg_get_triggerdef(t.oid) as definition from pg_trigger t where not t.tgisinternal;
