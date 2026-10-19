select public.pilot_assert(public.pilot_preserved_data()=(select records from public.pilot_data_snapshot),
 'historical backfill replay and all eight pending migrations preserve every synthetic legacy application row');
select public.pilot_assert((select jsonb_agg(to_jsonb(u) order by u.id) from auth.users u)=
 (select records from public.upgrade_auth_snapshot),'upgrade preserves synthetic Auth identities exactly');
select public.pilot_assert(not exists(select 1 from public.upgrade_function_snapshot s
 left join pg_proc p on p.oid=s.oid where p.oid is null or pg_get_functiondef(p.oid)<>s.definition),
 'upgrade leaves existing public function definitions unchanged');
select public.pilot_assert(not exists(
 (select * from public.upgrade_policy_snapshot except select * from pg_policies)
 union all
 (select * from pg_policies where schemaname='public' and tablename not like 'personal_%'
  except select * from public.upgrade_policy_snapshot)), 'upgrade preserves shop policies');
select public.pilot_assert(not exists(select 1 from public.upgrade_trigger_snapshot s
 left join pg_trigger t on t.oid=s.oid where t.oid is null or pg_get_triggerdef(t.oid)<>s.definition),
 'upgrade preserves existing signup and shop triggers');
select public.pilot_assert((select count(*)=0 from public.personal_books),
 'legacy currency accounts are not automatically adopted as JPY books');
select public.pilot_assert((select count(*)=0 from creditbook_private.personal_pilot_allowlist),
 'upgrade never silently enrolls a pilot identity');
select public.pilot_assert((select count(*)=0 from public.personal_categories) and
 (select count(*)=0 from public.personal_entries),'upgrade invents no categories or financial entries');
select public.pilot_assert(to_regprocedure('public.get_personal_accounts(integer)') is not null
 and to_regprocedure('public.manage_personal_account(jsonb,uuid)') is not null
 and to_regprocedure('public.get_personal_book()') is not null
 and to_regprocedure('public.manage_personal_category(jsonb,uuid)') is not null
 and to_regprocedure('public.create_personal_entries(jsonb,uuid)') is not null
 and to_regprocedure('public.shop_dashboard_page(uuid,integer)') is not null
 and to_regprocedure('public.shop_report_page(date,date,uuid,integer)') is not null,
 'all pending personal and shop read-model RPCs exist');
select public.pilot_assert(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','creditbook_private') and c.relkind='r'
 and c.relname not like '%snapshot' and not c.relrowsecurity), 'application tables retain RLS');

set role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000002',false);
select public.pilot_assert(not public.has_personal_pilot_access(),'non-enrolled legacy owner is denied personal pilot');
select public.pilot_assert((select count(*)=1 from public.customers),
 'non-enrolled personal user retains existing shop access');
reset role;
-- Enrollment is an explicit synthetic LOCAL fixture action, never part of DDL.
insert into creditbook_private.personal_pilot_allowlist(user_id)
 values ('90000000-0000-4000-8000-000000000001');
set role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',false);
select public.pilot_assert(public.get_personal_book()->>'state'='legacy_setup_required',
 'explicitly enrolled existing owner gets legacy setup, not an automatic money merge');
select public.pilot_assert((select count(*)=1 from public.personal_accounts),
 'enrolled owner reads its original account only');
reset role;
