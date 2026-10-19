\echo 'Checking final personal-pilot allowlist, RLS and RPC boundaries'

select public.pilot_assert((select count(*)=0 from creditbook_private.personal_pilot_allowlist), 'migration enrols no user implicitly');
select public.pilot_assert((select relrowsecurity from pg_class where oid='creditbook_private.personal_pilot_allowlist'::regclass), 'private allowlist has RLS enabled');
select public.pilot_assert((select records=public.pilot_preserved_data() from public.pilot_data_snapshot), 'migration preserves all existing shop and personal rows exactly');
select public.pilot_assert(not exists (
 select 1 from public.pilot_function_snapshot s where s.definition is distinct from pg_get_functiondef(s.oid)
), 'all existing public RPCs including signup and invitations are unchanged');
select public.pilot_assert(not exists (
 (select * from pg_policies where schemaname='public' and tablename not like 'personal_%' except select * from public.pilot_policy_snapshot)
 union all
 (select * from public.pilot_policy_snapshot except select * from pg_policies where schemaname='public' and tablename not like 'personal_%')
), 'shop policies are unchanged');
select public.pilot_assert(not exists (
 select 1 from public.pilot_trigger_snapshot s where s.definition is distinct from pg_get_triggerdef(s.oid)
), 'all existing signup and business triggers are unchanged');

select a.id as a_account, w.id as a_workspace from public.personal_accounts a
 join public.personal_workspaces w on w.id=a.workspace_id
 where w.owner_user_id='90000000-0000-4000-8000-000000000001' \gset
select a.id as foreign_account, w.id as foreign_workspace from public.personal_accounts a
 join public.personal_workspaces w on w.id=a.workspace_id
 where w.owner_user_id='90000000-0000-4000-8000-000000000002' \gset

set role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', false);
select public.pilot_assert(not public.has_personal_pilot_access(), 'editable metadata does not grant pilot access');
select public.pilot_assert(public.get_current_shop_id()='90000000-0000-4000-8000-000000000021'::uuid, 'non-pilot retains current shop resolution');
select public.pilot_assert(public.has_shop_permission('90000000-0000-4000-8000-000000000021', 'customer.read'), 'non-pilot retains own shop permission');
select public.pilot_assert(not public.has_shop_permission('90000000-0000-4000-8000-000000000022', 'customer.read'), 'non-pilot shop owner cannot access another shop');
select public.pilot_assert((select count(*)=1 from public.customers where id='90000000-0000-4000-8000-000000000023'), 'non-pilot can still read existing shop customer');
select public.pilot_assert(not creditbook_private.is_current_account_active(), 'private status helper has the same pilot guard');
select public.pilot_assert(not creditbook_private.owns_active_personal_workspace(:'foreign_workspace'), 'non-pilot cannot use a private owner helper');
select public.pilot_assert((select count(*)=0 from public.personal_workspaces), 'non-pilot workspaces are RLS hidden');
select public.pilot_assert((select count(*)=0 from public.personal_accounts), 'non-pilot accounts are RLS hidden');
select public.pilot_assert((select count(*)=0 from public.personal_postings), 'non-pilot financial history is RLS hidden');
select public.pilot_assert((select count(*)=0 from public.personal_workspace_preferences), 'non-pilot preferences are RLS hidden');
select public.pilot_assert((select count(*)=0 from public.personal_audit_events), 'non-pilot audit history is RLS hidden');
select public.pilot_denied('select * from creditbook_private.personal_pilot_allowlist', 'client cannot read the allowlist');
select public.pilot_denied($q$insert into creditbook_private.personal_pilot_allowlist(user_id) values(auth.uid())$q$, 'client cannot self-enrol');
select public.pilot_denied('update creditbook_private.personal_pilot_allowlist set enabled=true', 'client cannot re-enable the pilot');
select public.pilot_denied('delete from creditbook_private.personal_pilot_allowlist', 'client cannot remove pilot restrictions');
select public.pilot_denied('select * from creditbook_private.personal_command_receipts', 'client cannot read private idempotency receipts');
select public.pilot_denied('select public.ensure_my_personal_workspace()', 'non-pilot cannot provision or replay provisioning');
select public.pilot_denied('select public.get_personal_accounts(0)', 'non-pilot cannot call account read RPC');
select public.pilot_denied($q$select public.create_personal_account('{}',gen_random_uuid())$q$, 'non-pilot cannot call create RPC');
select public.pilot_denied($q$select creditbook_private.create_personal_account('{}',gen_random_uuid())$q$, 'direct private create RPC is guarded');
select public.pilot_denied($q$select public.manage_personal_account('{}',gen_random_uuid())$q$, 'non-pilot cannot call management RPC');
select public.pilot_denied($q$select creditbook_private.manage_personal_account('{}',gen_random_uuid())$q$, 'direct private management RPC is guarded');
select public.pilot_denied($q$insert into public.personal_postings(workspace_id) values(gen_random_uuid())$q$, 'direct posting inserts stay forbidden');
select public.pilot_denied($q$update public.personal_accounts set name='Tampered'$q$, 'direct account writes stay forbidden');
select public.pilot_denied('delete from public.personal_audit_events', 'direct audit deletion stays forbidden');
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000004', false);
select public.pilot_denied('insert into public.personal_workspaces(owner_user_id) values(auth.uid())', 'RLS denies direct self-provisioning without pilot approval');
select set_config('request.jwt.claim.sub', '', false);
select public.pilot_assert(not public.has_personal_pilot_access(), 'missing subject never grants access');
reset role;

set role anon;
select public.pilot_denied('select public.has_personal_pilot_access()', 'anon cannot execute pilot RPC');
select public.pilot_denied('select * from public.personal_workspaces', 'anon cannot query workspaces');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000003', false);
select public.pilot_assert(public.is_platform_admin(), 'non-pilot admin fixture really has a platform role');
select public.pilot_assert(not public.has_personal_pilot_access(), 'platform admin role does not grant personal pilot access');
select public.pilot_denied('select public.get_personal_accounts(0)', 'non-pilot platform admin cannot read personal accounts by RPC');
reset role;

select public.pilot_assert((select not prosecdef and pronargs=0 and provolatile='s' from pg_proc where oid='public.has_personal_pilot_access()'::regprocedure), 'public pilot wrapper is a stable invoker with no identity parameter');
select public.pilot_assert(not has_function_privilege('anon','public.has_personal_pilot_access()','EXECUTE')
 and has_function_privilege('authenticated','public.has_personal_pilot_access()','EXECUTE'), 'public pilot wrapper has explicit minimal execution grants');
select public.pilot_assert((select prosecdef and 'search_path=""'=any(proconfig) from pg_proc where oid='creditbook_private.is_current_account_active()'::regprocedure), 'private guard definer pins an empty search path');
set role service_role;
select public.pilot_denied('insert into creditbook_private.personal_pilot_allowlist(user_id) values(gen_random_uuid())', 'service API role has no allowlist write grant');
reset role;

-- Database administrator enrolment is the only setup path. Multiple synthetic
-- approved identities exercise owner isolation, not a production pilot expansion.
insert into creditbook_private.personal_pilot_allowlist(user_id) values
 ('90000000-0000-4000-8000-000000000001'),
 ('90000000-0000-4000-8000-000000000003'),
 ('90000000-0000-4000-8000-000000000004');
set role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', false);
select public.pilot_assert(public.has_personal_pilot_access(), 'approved current identity is allowed');
select public.pilot_assert((select count(*)=1 from public.personal_workspaces), 'approved owner sees only own workspace');
select public.pilot_assert((select count(*)=1 from public.personal_accounts), 'approved owner sees only own account');
select public.pilot_assert((select count(*)=1 from public.personal_postings), 'approved owner sees only own financial history');
select public.pilot_assert((select count(*)=1 from public.personal_workspace_preferences), 'approved owner sees only own preferences');
select public.pilot_assert((select count(*)=1 from public.personal_audit_events), 'approved owner sees only own audit history');
select public.pilot_assert((select (public.get_personal_accounts(0)->'accounts'->0->>'balanceMinor')='10000'), 'approved read RPC preserves exact JPY amount');
select public.pilot_assert(not creditbook_private.owns_active_personal_workspace(:'foreign_workspace'), 'approved owner cannot claim foreign workspace');
select public.pilot_assert((select count(*)=0 from public.personal_accounts where id=:'foreign_account'), 'foreign account remains hidden from approved owner');
select public.ensure_my_personal_workspace();
select public.ensure_my_personal_workspace();
select public.pilot_assert((select count(*)=1 from public.personal_workspaces), 'approved provisioning retries are idempotent');
select public.pilot_denied($q$insert into creditbook_private.personal_pilot_allowlist(user_id) values('90000000-0000-4000-8000-000000000002')$q$, 'approved client cannot enrol another account');

-- Second approved identity is still isolated from A and the non-pilot.
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000003', false);
select public.pilot_assert(public.has_personal_pilot_access(), 'second approved fixture has permission');
select public.pilot_assert((select count(*)=0 from public.personal_accounts), 'approved B cannot see A accounts');
select public.pilot_assert(public.is_platform_admin(), 'second approved fixture really is platform admin');
select public.pilot_assert((select count(*)=0 from public.personal_postings), 'approved B cannot see A postings');
select public.pilot_assert(not creditbook_private.owns_active_personal_workspace(:'a_workspace'), 'approved B cannot use private ownership helper on A');

-- No automatic workspace creation is hidden behind the permission RPC.
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000004', false);
select public.pilot_assert(public.has_personal_pilot_access(), 'approved no-workspace fixture passes pilot gate');
select public.pilot_assert((select count(*)=0 from public.personal_workspaces), 'permission check does not provision a workspace');
select public.ensure_my_personal_workspace();
select public.ensure_my_personal_workspace();
select public.pilot_assert((select count(*)=1 from public.personal_workspaces), 'lazy approved initialization creates exactly one workspace');
select public.pilot_assert(public.activate_invited_memberships('90000000-0000-4000-8000-000000000021')=1, 'existing pending invitation still activates after pilot migration');
select public.pilot_assert(public.activate_invited_memberships('90000000-0000-4000-8000-000000000021')=0, 'invitation replay remains idempotent after pilot migration');

-- The same JWT subject is reused while the server-side permission changes.
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', false);
reset role;
update creditbook_private.personal_pilot_allowlist set enabled=false where user_id='90000000-0000-4000-8000-000000000001';
set role authenticated;
select public.pilot_assert(not public.has_personal_pilot_access(), 'revocation applies without changing JWT subject');
select public.pilot_assert((select count(*)=0 from public.personal_postings), 'revoked subject cannot read existing history');
select public.pilot_denied($q$select public.create_personal_account('{"name":"Pilot A","currencyCode":"JPY","openingAmountMinor":"10000","openingDate":"2026-01-01","timeZone":"Asia/Tokyo"}', '90000000-0000-4000-8000-000000000011')$q$, 'revocation denies replay of a previously successful command');
reset role;
update creditbook_private.personal_pilot_allowlist set enabled=true where user_id='90000000-0000-4000-8000-000000000001';
update auth.users set banned_until=now()+interval '1 day' where id='90000000-0000-4000-8000-000000000001';
set role authenticated;
select public.pilot_assert(not public.has_personal_pilot_access(), 'fresh ban denies a previously allowed JWT subject');
select public.pilot_assert((select count(*)=0 from public.personal_accounts), 'banned approved owner cannot read existing money');
select public.pilot_denied('select public.ensure_my_personal_workspace()', 'banned approved owner cannot provision');
reset role;
update auth.users set banned_until=now()-interval '1 day' where id='90000000-0000-4000-8000-000000000001';
set role authenticated;
select public.pilot_assert(public.has_personal_pilot_access(), 'expired ban restores only existing approved access');
reset role;
update auth.users set is_anonymous=true where id='90000000-0000-4000-8000-000000000001';
set role authenticated;
select public.pilot_assert(not public.has_personal_pilot_access(), 'anonymous approved identity is denied');
select public.pilot_denied($q$select creditbook_private.manage_personal_account('{}',gen_random_uuid())$q$, 'anonymous approved identity cannot use private management');
reset role;
update auth.users set is_anonymous=false, banned_until=null where id='90000000-0000-4000-8000-000000000001';
update auth.users set deleted_at=now() where id='90000000-0000-4000-8000-000000000001';
set role authenticated;
select public.pilot_assert(not public.has_personal_pilot_access(), 'soft-deleted approved identity cannot reuse the same JWT subject');
select public.pilot_assert((select count(*)=0 from public.personal_postings), 'soft-deleted identity cannot read financial history');
select public.pilot_denied('select public.get_personal_accounts(0)', 'soft-deleted identity cannot use the read RPC');
reset role;
update auth.users set deleted_at=null where id='90000000-0000-4000-8000-000000000001';
update public.personal_workspaces set status='suspended' where id=:'a_workspace';
set role authenticated;
select public.pilot_assert((select count(*)=0 from public.personal_accounts), 'suspended approved workspace remains hidden');
select public.pilot_denied('select public.ensure_my_personal_workspace()', 'pilot permit cannot reactivate suspended workspace');
select public.pilot_denied('select public.get_personal_accounts(0)', 'pilot permit cannot read suspended workspace by RPC');
reset role;
update public.personal_workspaces set status='active' where id=:'a_workspace';

-- Final-state positive financial write and exact replay also pass the guard.
set role authenticated;
select public.create_personal_account(
 '{"name":"Approved write","currencyCode":"JPY","openingAmountMinor":"-7","openingDate":"2026-01-01","timeZone":"Asia/Tokyo"}',
 '90000000-0000-4000-8000-000000000013');
select public.pilot_assert((public.create_personal_account(
 '{"name":"Approved write","currencyCode":"JPY","openingAmountMinor":"-7","openingDate":"2026-01-01","timeZone":"Asia/Tokyo"}',
 '90000000-0000-4000-8000-000000000013')->>'replayed')::boolean, 'approved exact replay remains idempotent');
select public.pilot_assert((select count(*)=2 from public.personal_accounts), 'approved write and retry create only one additional account');
select public.pilot_assert((select sum(amount_minor)=9993 from public.personal_postings), 'post-migration approved writes reconcile exactly');
reset role;

-- Non-pilot data was hidden, not deleted; denied writes created no receipts.
select public.pilot_assert((select count(*)=1 from public.personal_accounts where workspace_id=:'foreign_workspace'), 'non-pilot original account is preserved');
select public.pilot_assert((select sum(amount_minor)=200 from public.personal_postings where workspace_id=:'foreign_workspace'), 'non-pilot original posting amount is preserved');
select public.pilot_assert((select count(*)=2 from creditbook_private.personal_command_receipts where actor_id='90000000-0000-4000-8000-000000000001'), 'denied and replayed writes create no extra receipts');

-- Exercise the actual SQL signup trigger after migration (not GoTrue signup).
select public.pilot_assert(exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='on_auth_user_created' and tgenabled='O'), 'SQL auth insert trigger remains attached and enabled');
insert into auth.users(id,email,raw_user_meta_data) values
 ('90000000-0000-4000-8000-000000000005','after-migration@fixture.test','{"personal_pilot":true}');
select public.pilot_assert((select count(*)=1 from public.profiles where id='90000000-0000-4000-8000-000000000005'), 'SQL signup trigger still creates a profile');
select public.pilot_assert((select count(*)=1 from public.personal_workspaces where owner_user_id='90000000-0000-4000-8000-000000000005'), 'unchanged SQL signup trigger still provisions one empty personal workspace');
set role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000005',false);
select public.pilot_assert(not public.has_personal_pilot_access(), 'new signup cannot self-enrol using metadata');
select public.pilot_assert((select count(*)=0 from public.personal_workspaces), 'unapproved new signup cannot read the empty workspace');
select public.pilot_assert(public.get_current_shop_id() is null, 'new signup does not fabricate shop authority');
reset role;

\echo 'PASS: pilot final-state SQL/RLS assertions; not real JWT verification or PostgREST HTTP acceptance.'
