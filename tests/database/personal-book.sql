select public.pilot_assert((select records=public.pilot_preserved_data() from public.book_original_data), 'book migration preserves all prior rows exactly');
select public.pilot_assert((select count(*)=0 from public.personal_books), 'book migration never adopts legacy accounts');
select public.pilot_assert((select relrowsecurity from pg_class where oid='public.personal_books'::regclass), 'book mapping has RLS');

insert into auth.users(id,email) values
 ('91000000-0000-4000-8000-000000000001','book-a@fixture.test'),
 ('91000000-0000-4000-8000-000000000002','book-b@fixture.test'),
 ('91000000-0000-4000-8000-000000000003','book-race@fixture.test'),
 ('91000000-0000-4000-8000-000000000004','book-audit@fixture.test'),
 ('91000000-0000-4000-8000-000000000005','book-distinct-race@fixture.test');
insert into creditbook_private.personal_pilot_allowlist(user_id) values
 ('91000000-0000-4000-8000-000000000001'),('91000000-0000-4000-8000-000000000002'),('91000000-0000-4000-8000-000000000003'),
 ('91000000-0000-4000-8000-000000000004'),('91000000-0000-4000-8000-000000000005');

create function public.book_error(statement text, expected_code text, expected_message text, label text)
returns void language plpgsql security invoker as $$
declare actual text; detail text;
begin
 begin execute statement;
 exception when others then
  get stacked diagnostics actual=returned_sqlstate, detail=message_text;
  if actual=expected_code and (expected_message is null or detail=expected_message) then
   raise notice 'PASS: %',label; return;
  end if;
  raise exception 'FAIL: % expected % got %: %',label,expected_code,actual,detail;
 end;
 raise exception 'FAIL: % did not reject',label;
end; $$;

set role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',false);
select public.pilot_assert(public.get_personal_book()->>'state'='empty','new owner starts empty');
select public.initialize_personal_book('{"openingAmountMinor":"0","openingDate":"2026-01-01"}','91000000-0000-4000-8000-000000000011') as created \gset
select public.pilot_assert(public.get_personal_book()->'book'->>'balanceMinor'='0','zero JPY opening is retained exactly');
select public.pilot_assert(public.get_personal_book()->'book'->>'currencyCode'='JPY','new book uses JPY');
select public.pilot_assert(public.get_personal_book()->'book'->>'timeZone'='Asia/Tokyo','new book uses Tokyo');
select public.pilot_assert(public.get_personal_book()->'book'->>'defaultPaymentMethod'='cash' and public.get_personal_book()->'book'->>'defaultEntryKind'='expense','cash and expense are labels, not extra accounts');
select public.pilot_assert((select count(*)=1 from public.personal_postings where kind='opening'),'exactly one immutable opening per fresh owner');
select public.pilot_assert(public.initialize_personal_book('{"openingAmountMinor":"0","openingDate":"2026-01-01"}','91000000-0000-4000-8000-000000000011')->>'replayed'='true','same key and payload replays');
select public.book_error($q$select public.initialize_personal_book('{"openingAmountMinor":"1","openingDate":"2026-01-01"}','91000000-0000-4000-8000-000000000011')$q$,'23505',null,'changed payload conflicts');
select public.book_error($q$select public.initialize_personal_book('{"openingAmountMinor":"0","openingDate":"2026-01-01"}',gen_random_uuid())$q$,'PT409','BOOK_EXISTS','second new book is blocked');
select public.book_error($q$select public.create_personal_account('{"name":"Bypass","currencyCode":"JPY","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"Asia/Tokyo"}',gen_random_uuid())$q$,'PT409','BOOK_EXISTS','legacy public create cannot open another account');
select public.book_error($q$select creditbook_private.create_personal_account('{"name":"Bypass","currencyCode":"JPY","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"Asia/Tokyo"}',gen_random_uuid())$q$,'PT409','BOOK_EXISTS','legacy private create cannot open another account');
select public.pilot_denied('insert into public.personal_books(workspace_id,account_id) values(gen_random_uuid(),gen_random_uuid())','client cannot forge book mapping');
select public.pilot_denied('update public.personal_books set account_id=gen_random_uuid()','client cannot reassign book');
select public.pilot_denied('delete from public.personal_books','client cannot delete book');

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',false);
select public.pilot_assert((select count(*)=0 from public.personal_books),'other pilot cannot see owner book');
select public.book_error($q$select public.initialize_personal_book('{"openingAmountMinor":"1.5","openingDate":"2026-01-01"}',gen_random_uuid())$q$,'22023',null,'JPY fractional opening rejected');
select public.book_error($q$select public.initialize_personal_book('{"openingAmountMinor":"0","openingDate":"2026-01-01","currencyCode":"USD"}',gen_random_uuid())$q$,'22023',null,'client cannot override JPY');
select public.book_error($q$select public.create_personal_account('{"name":"USD bypass","currencyCode":"USD","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"Asia/Tokyo"}',gen_random_uuid())$q$,'22023',null,'legacy create cannot choose another book currency');
select public.book_error($q$select public.create_personal_account('{"name":"Zone bypass","currencyCode":"JPY","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"UTC"}',gen_random_uuid())$q$,'22023',null,'legacy create cannot choose another book zone');
select public.initialize_personal_book('{"openingAmountMinor":"-10000","openingDate":"2026-01-01"}','91000000-0000-4000-8000-000000000012');
select public.pilot_assert(public.get_personal_book()->'book'->>'balanceMinor'='-10000','signed opening remains exact without rounding');
select public.manage_personal_account(jsonb_build_object('operation','archive',
 'accountId',public.get_personal_book()->'book'->>'id','accountVersion',1,'preferencesVersion',2),gen_random_uuid());
select public.pilot_assert(public.get_personal_book()->'book'->>'status'='archived','archived book and its balance remain visible');
select public.book_error($q$select public.initialize_personal_book('{"openingAmountMinor":"0","openingDate":"2026-01-01"}',gen_random_uuid())$q$,'PT409','BOOK_EXISTS','archive does not free another balance-bearing slot');

-- Prior G01 synthetic owner already had a legacy account before this migration.
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',false);
select public.pilot_assert(public.get_personal_book()->>'code'='LEGACY_SETUP_REQUIRED','legacy owner is not silently adopted');
select public.book_error($q$select public.initialize_personal_book('{"openingAmountMinor":"0","openingDate":"2026-01-01"}',gen_random_uuid())$q$,'PT409','LEGACY_SETUP_REQUIRED','legacy balances block implicit fresh start');
select public.pilot_assert((select count(*)=0 from public.personal_books),'legacy owner still has no mapping');
reset role;

-- Privileged fixtures prove identity/FK/immutability defenses separately from grants.
select id as b_workspace from public.personal_workspaces where owner_user_id='91000000-0000-4000-8000-000000000002' \gset
select id as a_account from public.personal_accounts where workspace_id=(select id from public.personal_workspaces where owner_user_id='91000000-0000-4000-8000-000000000001') \gset
select id as legacy_workspace from public.personal_workspaces where owner_user_id='90000000-0000-4000-8000-000000000001' \gset
select public.book_error(format('insert into public.personal_books(workspace_id,account_id) values(%L,%L)',:'legacy_workspace',:'a_account'),'23505',null,'account cannot belong to two books');
select id as fresh_workspace from public.personal_workspaces where owner_user_id='91000000-0000-4000-8000-000000000004' \gset
select a.id as legacy_account from public.personal_accounts a where workspace_id=:'legacy_workspace' order by created_at,id limit 1 \gset
select public.book_error(format('insert into public.personal_books(workspace_id,account_id) values(%L,%L)',:'fresh_workspace',:'legacy_account'),'23503',null,'cross-workspace book link fails composite foreign key');
select public.book_error('update public.personal_books set account_id=gen_random_uuid()','42501',null,'privileged mapping reassignment is immutable');
select public.book_error('delete from public.personal_books','42501',null,'privileged mapping deletion is immutable');
update creditbook_private.personal_pilot_allowlist set enabled=false where user_id='91000000-0000-4000-8000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',false);
select public.pilot_assert((select count(*)=0 from public.personal_books),'revocation hides book mapping');
select public.pilot_denied('select public.get_personal_book()','revocation blocks book read RPC');
select public.pilot_denied($q$select public.initialize_personal_book('{"openingAmountMinor":"0","openingDate":"2026-01-01"}','91000000-0000-4000-8000-000000000011')$q$,'revocation blocks even initialization replay');
reset role;
update creditbook_private.personal_pilot_allowlist set enabled=true where user_id='91000000-0000-4000-8000-000000000001';

-- Audit failure rolls back account, opening, book mapping and receipt together.
create function public.book_fail_audit() returns trigger language plpgsql as $$
begin
 if new.actor_id='91000000-0000-4000-8000-000000000004' then raise exception 'Synthetic audit failure'; end if;
 return new;
end; $$;
create trigger book_audit_failure before insert on public.personal_audit_events for each row execute function public.book_fail_audit();
set role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000004',false);
select public.book_error($q$select public.initialize_personal_book('{"openingAmountMinor":"100","openingDate":"2026-01-01"}','91000000-0000-4000-8000-000000000014')$q$,'P0001','Synthetic audit failure','audit failure aborts initialization');
select public.pilot_assert((select count(*)=0 from public.personal_books),'failed audit leaves no book');
select public.pilot_assert((select count(*)=0 from public.personal_accounts),'failed audit leaves no account');
select public.pilot_assert((select count(*)=0 from public.personal_postings),'failed audit leaves no opening');
reset role;
select public.pilot_assert((select count(*)=0 from creditbook_private.personal_command_receipts where actor_id='91000000-0000-4000-8000-000000000004'),'failed audit leaves no receipt');
drop trigger book_audit_failure on public.personal_audit_events;
drop function public.book_fail_audit();
set role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000004',false);
select public.initialize_personal_book('{"openingAmountMinor":"100","openingDate":"2026-01-01"}','91000000-0000-4000-8000-000000000014');
select public.pilot_assert(public.get_personal_book()->'book'->>'balanceMinor'='100','retry after audit rollback succeeds with same key');
reset role;
-- No legacy row, shop definition or shop access was altered by G02 operations.
select public.pilot_assert(not exists (
 select 1 from public.book_original_data s, lateral jsonb_each(s.records) old
 where old.value<>'null'::jsonb and not (public.pilot_preserved_data()->old.key @> old.value)
),'all prior records remain byte-for-byte represented after book operations');
set role anon;
select public.pilot_denied('select * from public.personal_books','anonymous role cannot read books');
select public.pilot_denied('select public.get_personal_book()','anonymous role cannot call book read RPC');
reset role;
