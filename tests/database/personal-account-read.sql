\echo 'Checking exact personal read model and pagination'
insert into auth.users(id,email,is_anonymous) values
 ('20000000-0000-4000-8000-000000000001','read-owner@fixtures.example.test',false),
 ('20000000-0000-4000-8000-000000000002','read-other@fixtures.example.test',false);
set role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false);
select public.g02_assert(public.get_personal_accounts()->'accounts'='[]'::jsonb,'empty personal list is available without shop');
select public.create_personal_account('{"name":"Naqd","currencyCode":"UZS","openingAmountMinor":"10000000","openingDate":"2026-01-01","timeZone":"UTC"}',gen_random_uuid());
select public.create_personal_account('{"name":"Bank","currencyCode":"UZS","openingAmountMinor":"5000000","openingDate":"2026-01-01","timeZone":"UTC"}',gen_random_uuid());
select public.g02_assert(public.get_personal_accounts()->'totals'->0->>'includedMinor'='15000000','cash and bank reconcile to 150000 UZS');
select public.g02_assert(public.get_personal_accounts()->'preferences'->>'timeZone'='UTC','stored timezone returned');
reset role;
update public.personal_accounts set include_in_total=false where name='Bank' and workspace_id=(select id from public.personal_workspaces where owner_user_id='20000000-0000-4000-8000-000000000001');
set role authenticated;
select public.g02_assert(public.get_personal_accounts()->'totals'->0->>'includedMinor'='10000000','exclude changes included total');
select public.g02_assert((select sum(amount_minor) from public.personal_postings)=15000000,'exclude preserves all underlying financial postings');
do $$ begin for i in 1..100 loop
 perform public.create_personal_account(jsonb_build_object('name','Large '||i,'currencyCode','UZS','openingAmountMinor','100000000000000','openingDate','2026-01-01','timeZone','UTC'),gen_random_uuid());
end loop; end $$;
select public.g02_assert(public.get_personal_accounts()->'totals'->0->>'includedMinor'='10000000010000000','aggregate remains exact beyond JS safe integer');
select public.g02_assert(jsonb_typeof(public.get_personal_accounts()->'totals'->0->'includedMinor')='string','money is text in JSON');
select public.g02_assert(jsonb_array_length(public.get_personal_accounts()->'accounts')=50,'first page bounded to fifty');
select public.g02_assert((public.get_personal_accounts()->>'nextOffset')::integer=50,'first next offset valid');
select public.g02_assert(jsonb_array_length(public.get_personal_accounts(100)->'accounts')=2 and public.get_personal_accounts(100)->'nextOffset'='null'::jsonb,'last page ends correctly');
select public.g02_assert(public.get_personal_accounts(100)->'totals'=public.get_personal_accounts()->'totals','totals cover all pages');
select public.g02_expect_sqlstate('select public.get_personal_accounts(-1)','22023','negative offset rejected');
select public.g02_assert(public.get_personal_accounts(100000)->'nextOffset'='null'::jsonb,'pagination boundary never produces invalid next link');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',false);
select public.g02_assert(public.get_personal_accounts()->'accounts'='[]'::jsonb and public.get_personal_accounts()->'totals'='[]'::jsonb,'foreign financial rows and totals invisible');
reset role;
update public.personal_workspaces set status='suspended' where owner_user_id='20000000-0000-4000-8000-000000000002';
set role authenticated;
select public.g02_expect_sqlstate('select public.get_personal_accounts()','42501','suspended workspace denied');
reset role;
set role anon;
select public.g02_expect_sqlstate('select public.get_personal_accounts()','42501','anonymous read RPC denied');
reset role;
