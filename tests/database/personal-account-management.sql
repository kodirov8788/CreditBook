\echo 'Checking account management without financial mutation'
insert into auth.users(id,email,is_anonymous) values ('30000000-0000-4000-8000-000000000001','management@fixtures.example.test',false);
set role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false);
do $$ declare cash uuid; bank uuid; v integer; pv integer; k uuid:=gen_random_uuid(); cmd jsonb; r jsonb; before_money numeric;
begin
 cash:=(public.create_personal_account('{"name":"Naqd","currencyCode":"UZS","openingAmountMinor":"10000000","openingDate":"2026-01-01","timeZone":"UTC"}',gen_random_uuid())->>'accountId')::uuid;
 bank:=(public.create_personal_account('{"name":"Bank","currencyCode":"UZS","openingAmountMinor":"5000000","openingDate":"2026-01-01","timeZone":"UTC"}',gen_random_uuid())->>'accountId')::uuid;
 select sum(amount_minor) into before_money from public.personal_postings;
 select version into pv from public.personal_workspace_preferences;
 cmd:=jsonb_build_object('operation','update','accountId',bank,'accountVersion',1,'preferencesVersion',pv,'name','Karta','includeInTotal',false);
 r:=public.manage_personal_account(cmd,k);
 perform public.g02_assert(r->>'replayed'='false','metadata command recorded');
 perform public.g02_assert(public.get_personal_accounts()->'totals'->0->>'includedMinor'='10000000','management excludes balance from visible total');
 perform public.g02_assert((select sum(amount_minor) from public.personal_postings)=before_money,'rename and include preference never change financial records');
 perform public.g02_assert(public.manage_personal_account(cmd,k)->>'replayed'='true','management replay preserves original result');
 perform public.g02_expect_sqlstate(format('select public.manage_personal_account(%L::jsonb,%L::uuid)',cmd||'{"name":"Different"}'::jsonb,k),'23505','same management key changed input conflicts');
 perform public.g02_expect_sqlstate(format('select public.manage_personal_account(%L::jsonb,gen_random_uuid())',cmd),'23505','stale account version conflicts');
 r:=public.manage_personal_account(jsonb_build_object('operation','archive','accountId',cash,'accountVersion',1,'preferencesVersion',pv),gen_random_uuid());
 perform public.g02_assert((public.get_personal_accounts()->'preferences'->>'defaultAccountId')::uuid=bank,'archived default replaced with oldest active');
 perform public.g02_assert((select count(*) from public.personal_postings)=2 and (select sum(amount_minor) from public.personal_postings)=before_money,'archive preserves all opening history');
 perform public.g02_assert(public.get_personal_accounts()->'totals'->0->>'archivedMinor'='10000000','archived money shown separately');
 select version into pv from public.personal_workspace_preferences;
 perform public.g02_expect_sqlstate(format('select public.manage_personal_account(%L::jsonb,gen_random_uuid())',jsonb_build_object('operation','update','accountId',cash,'accountVersion',2,'preferencesVersion',pv,'name','Cannot edit')),'22023','archived account must be unarchived before editing');
 r:=public.manage_personal_account(jsonb_build_object('operation','archive','accountId',bank,'accountVersion',2,'preferencesVersion',pv),gen_random_uuid());
 perform public.g02_assert(public.get_personal_accounts()->'preferences'->'defaultAccountId'='null'::jsonb,'archiving last active clears default');
 select version into pv from public.personal_workspace_preferences;
 r:=public.manage_personal_account(jsonb_build_object('operation','unarchive','accountId',cash,'accountVersion',2,'preferencesVersion',pv),gen_random_uuid());
 perform public.g02_assert((public.get_personal_accounts()->'preferences'->>'defaultAccountId')::uuid=cash,'unarchive repairs missing default');
 select version into pv from public.personal_workspace_preferences;
 r:=public.manage_personal_account(jsonb_build_object('operation','unarchive','accountId',bank,'accountVersion',3,'preferencesVersion',pv),gen_random_uuid());
 select version into v from public.personal_accounts where id=bank;
 r:=public.manage_personal_account(jsonb_build_object('operation','default','accountId',bank,'accountVersion',v,'preferencesVersion',pv),gen_random_uuid());
 perform public.g02_assert((public.get_personal_accounts()->'preferences'->>'defaultAccountId')::uuid=bank,'owner can choose active default');
 select version into pv from public.personal_workspace_preferences;
 perform public.g02_expect_sqlstate(format('select public.manage_personal_account(%L::jsonb,gen_random_uuid())',jsonb_build_object('operation','archive','accountId',gen_random_uuid(),'accountVersion',1,'preferencesVersion',pv)),'42501','foreign or unknown account denied');
 perform public.g02_assert((select count(*) from public.personal_postings)=2 and (select sum(amount_minor) from public.personal_postings)=before_money,'all management actions preserve exact opening reconciliation');
end $$;
reset role;
-- A real second owner/account proves the tenant predicate, rather than merely
-- testing a random absent UUID. No elevation is assigned to either user.
insert into auth.users(id,email,is_anonymous) values ('30000000-0000-4000-8000-000000000002','management-foreign@fixtures.example.test',false);
set role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000002',false);
select set_config('g02.foreign_account',public.create_personal_account('{"name":"Foreign unchanged","currencyCode":"UZS","openingAmountMinor":"123","openingDate":"2026-01-01","timeZone":"UTC"}',gen_random_uuid())->>'accountId',false);
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false);
do $$ declare op text; cmd jsonb; before_audit bigint; before_posts bigint;
begin
 select count(*) into before_audit from public.personal_audit_events;
 select count(*) into before_posts from public.personal_postings;
 foreach op in array array['update','archive','unarchive','default'] loop
  cmd:=jsonb_build_object('operation',op,'accountId',current_setting('g02.foreign_account'),'accountVersion',1,'preferencesVersion',2);
  if op='update' then cmd:=cmd||'{"name":"Foreign changed"}'::jsonb; end if;
  perform public.g02_expect_sqlstate(format('select public.manage_personal_account(%L::jsonb,gen_random_uuid())',cmd),'42501','real foreign account command denied: '||op);
  perform public.g02_expect_sqlstate(format('select creditbook_private.manage_personal_account(%L::jsonb,gen_random_uuid())',cmd),'42501','private helper independently denies foreign account: '||op);
 end loop;
 perform public.g02_assert((select count(*) from public.personal_audit_events)=before_audit and (select count(*) from public.personal_postings)=before_posts,'foreign attempts leave own audit and postings unchanged');
end $$;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000002',false);
select public.g02_assert((select name='Foreign unchanged' and status='active' and version=1 from public.personal_accounts),'foreign account remains untouched');
select public.g02_assert((select count(*) from public.personal_audit_events)=1 and (select count(*) from public.personal_postings)=1,'foreign history remains unchanged');
reset role;

-- Inject failure only in this disposable fixture, then prove every metadata,
-- default, receipt and audit change rolls back before retrying the same key.
create function public.g02_fail_management_audit() returns trigger language plpgsql as $$
begin if current_setting('g02.fail_audit',true)='on' then raise exception 'Injected audit failure' using errcode='ZQ002'; end if; return new; end $$;
create trigger g02_fail_management_audit before insert on public.personal_audit_events for each row execute function public.g02_fail_management_audit();
set role authenticated;
do $$ declare aid uuid:=(select id from public.personal_accounts limit 1); k uuid:=gen_random_uuid(); cmd jsonb; r jsonb;
begin
 cmd:=jsonb_build_object('operation','archive','accountId',aid,'accountVersion',1,'preferencesVersion',2);
 perform set_config('g02.fail_audit','on',true);
 perform public.g02_expect_sqlstate(format('select public.manage_personal_account(%L::jsonb,%L::uuid)',cmd,k),'ZQ002','required audit failure aborts management');
 perform public.g02_assert((select status='active' and version=1 from public.personal_accounts),'audit failure rolls back account state');
 perform public.g02_assert((select default_account_id=aid and version=2 from public.personal_workspace_preferences),'audit failure rolls back default');
 perform set_config('g02.fail_audit','off',true);
 r:=public.manage_personal_account(cmd,k);
 perform public.g02_assert(r->>'replayed'='false','same key succeeds after full rollback, without orphan receipt');
end $$;
reset role;
drop trigger g02_fail_management_audit on public.personal_audit_events;
drop function public.g02_fail_management_audit();

create table public.g02_manage_race_results(caller text,result text);
grant select,insert on public.g02_manage_race_results to authenticated;
create table public.g02_manage_race_fixture as select a.id,a.workspace_id,a.version,
 p.version preferences_version,
 (select count(*) from public.personal_audit_events e where e.workspace_id=a.workspace_id) audit_count,
 (select count(*) from creditbook_private.personal_command_receipts r where r.workspace_id=a.workspace_id) receipt_count
 from public.personal_accounts a join public.personal_workspace_preferences p on p.workspace_id=a.workspace_id
 join public.personal_workspaces w on w.id=a.workspace_id where w.owner_user_id='30000000-0000-4000-8000-000000000001' and a.name='Naqd';
grant select on public.g02_manage_race_fixture to authenticated;
