\echo 'Checking personal-account create RPC, RLS, and immutability'

create function public.g02_assert(ok boolean, label text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'PASS: %', label;
end;
$$;

create function public.g02_expect_sqlstate(statement text, expected_state text, label text) returns void
language plpgsql security invoker as $$
declare actual_state text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate;
    if actual_state = expected_state then
      raise notice 'PASS: %', label;
      return;
    end if;
    raise exception 'FAIL: % expected SQLSTATE %, got %', label, expected_state, actual_state;
  end;
  raise exception 'FAIL: % expected SQLSTATE %, statement succeeded', label, expected_state;
end;
$$;

insert into auth.users (id, email, is_anonymous, banned_until) values
  ('10000000-0000-4000-8000-000000000001', 'owner@fixtures.example.test', false, null),
  ('10000000-0000-4000-8000-000000000002', 'foreign@fixtures.example.test', false, null),
  ('10000000-0000-4000-8000-000000000003', 'admin@fixtures.example.test', false, null),
  ('10000000-0000-4000-8000-000000000004', 'inactive@fixtures.example.test', false, null),
  ('10000000-0000-4000-8000-000000000005', 'anonymous@fixtures.example.test', true, null),
  ('10000000-0000-4000-8000-000000000006', 'banned@fixtures.example.test', false, now() + interval '1 day'),
  ('10000000-0000-4000-8000-000000000007', 'kiritimati@fixtures.example.test', false, null),
  ('10000000-0000-4000-8000-000000000008', 'pago-pago@fixtures.example.test', false, null);
insert into public.platform_roles (user_id, role)
values ('10000000-0000-4000-8000-000000000003', 'platform_admin');

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select public.ensure_my_personal_workspace();
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
select public.ensure_my_personal_workspace();
reset role;

-- The project signup trigger creates workspaces for normal users. Remove only
-- this synthetic workspace so the RPC's no-auto-provision guarantee is tested.
delete from public.personal_workspaces where owner_user_id='10000000-0000-4000-8000-000000000004';
set role anon;
select public.g02_expect_sqlstate(
  $$select public.create_personal_account('{"name":"Anon wallet","currencyCode":"UZS","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '11111111-1111-4111-8111-111111111111')$$,
  '42501', 'anon cannot call account creation');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', false);
select public.g02_expect_sqlstate(
  $$select public.create_personal_account('{"name":"Banned wallet","currencyCode":"UZS","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '11111111-1111-4111-8111-111111111112')$$,
  '42501', 'banned account cannot create');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', false);
select public.g02_expect_sqlstate(
  $$select public.create_personal_account('{"name":"Anon user wallet","currencyCode":"UZS","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '11111111-1111-4111-8111-111111111113')$$,
  '42501', 'anonymous account cannot create');
select set_config('request.jwt.claim.sub', '', false);
select public.g02_expect_sqlstate(
  $$select public.create_personal_account('{"name":"No identity","currencyCode":"UZS","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '11111111-1111-4111-8111-111111111114')$$,
  '42501', 'missing authentication identity cannot create');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
select public.g02_expect_sqlstate(
  $$select public.create_personal_account('{"name":"No workspace","currencyCode":"UZS","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '11111111-1111-4111-8111-111111111115')$$,
  '42501', 'missing workspace is not auto-provisioned by create');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
create temp table g02_results (label text primary key, result jsonb not null);
insert into g02_results values ('first', public.create_personal_account(
  jsonb_build_object('name','Main wallet','currencyCode','UZS','openingAmountMinor','10000000','openingDate','2026-01-01','timeZone','Asia/Tokyo'),
  '22222222-2222-4222-8222-222222222222'));
select public.g02_assert((select result ?& array['commandId','accountId','openingPostingId','accountVersion','preferencesVersion','replayed']
  and jsonb_typeof(result->'commandId')='string' and jsonb_typeof(result->'accountId')='string'
  and jsonb_typeof(result->'openingPostingId')='string' and result->'accountVersion'='1'::jsonb
  and result->'preferencesVersion'='2'::jsonb and result->'replayed'='false'::jsonb from g02_results where label='first'),
  'first result has exact create contract and initial preferences version two');
select public.g02_assert((select time_zone='Asia/Tokyo' and version=2 from public.personal_workspace_preferences),
  'first create stores requested time zone');

insert into g02_results values ('replay', public.create_personal_account(
  jsonb_build_object('name','Main wallet','currencyCode','UZS','openingAmountMinor','10000000','openingDate','2026-01-01','timeZone','Asia/Tokyo'),
  '22222222-2222-4222-8222-222222222222'));
select public.g02_assert((select result->'replayed'='true'::jsonb from g02_results where label='replay')
  and (select result->>'accountId' from g02_results where label='first')=(select result->>'accountId' from g02_results where label='replay')
  and (select count(*)=1 from public.personal_accounts), 'same key replays without extra account');
select public.g02_expect_sqlstate(
  $$select public.create_personal_account('{"name":"Changed wallet","currencyCode":"UZS","openingAmountMinor":"10000000","openingDate":"2026-01-01","timeZone":"Asia/Tokyo"}'::jsonb, '22222222-2222-4222-8222-222222222222')$$,
  '23505', 'same key with changed canonical command is rejected');

insert into g02_results values ('second', public.create_personal_account(
  jsonb_build_object('name','Second wallet','currencyCode','USD','openingAmountMinor','0','openingDate','2026-01-01','timeZone','Asia/Tokyo'),
  '22222222-2222-4222-8222-222222222239'));
select public.g02_assert((select default_account_id=(select (result->>'accountId')::uuid from g02_results where label='first') and version=2
  from public.personal_workspace_preferences), 'second create preserves first default and preferences version');

select public.g02_expect_sqlstate(
  $$select public.create_personal_account('{"name":"UTC wallet","currencyCode":"USD","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '22222222-2222-4222-8222-222222222223')$$,
  '22023', 'new create cannot change stored time zone');
reset role;
update public.personal_workspace_preferences set time_zone='UTC'
  where workspace_id=(select id from public.personal_workspaces where owner_user_id='10000000-0000-4000-8000-000000000001');
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
insert into g02_results values ('state-replay', public.create_personal_account(
  jsonb_build_object('name','Main wallet','currencyCode','UZS','openingAmountMinor','10000000','openingDate','2026-01-01','timeZone','Asia/Tokyo'),
  '22222222-2222-4222-8222-222222222222'));
select public.g02_assert((select result->'replayed'='true'::jsonb from g02_results where label='state-replay'),
  'identical replay is found before mutable time-zone validation');
set datestyle to 'SQL, DMY';
insert into g02_results values ('datestyle-replay', public.create_personal_account(
  jsonb_build_object('name','Main wallet','currencyCode','UZS','openingAmountMinor','10000000','openingDate','2026-01-01','timeZone','Asia/Tokyo'),
  '22222222-2222-4222-8222-222222222222'));
select public.g02_assert((select result->'replayed'='true'::jsonb from g02_results where label='datestyle-replay'),
  'date fingerprint remains ISO-stable under a non-ISO DateStyle');
set datestyle to 'ISO, YMD';

select public.g02_expect_sqlstate($$select public.create_personal_account('"not-object"'::jsonb, '22222222-2222-4222-8222-222222222224')$$, '22023', 'non-object JSON rejected');
select public.g02_expect_sqlstate($$select public.create_personal_account('{"name":"Bad","currencyCode":"UZS","openingAmountMinor":0,"openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '22222222-2222-4222-8222-222222222225')$$, '22023', 'non-string amount rejected');
select public.g02_expect_sqlstate($$select public.create_personal_account('{"name":"Bad","currencyCode":"UZS","openingAmountMinor":"01","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '22222222-2222-4222-8222-222222222240')$$, '22023', 'non-canonical money string rejected');
select public.g02_expect_sqlstate($$select public.create_personal_account('{"name":"Bad","currencyCode":"UZS","openingAmountMinor":"1.0","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '22222222-2222-4222-8222-222222222241')$$, '22023', 'decimal money string rejected');
select public.g02_expect_sqlstate($$select public.create_personal_account('{"name":"Bad","currencyCode":"UZS","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"UTC","icon":"coin"}'::jsonb, '22222222-2222-4222-8222-222222222242')$$, '22023', 'invalid optional icon rejected');
select public.g02_expect_sqlstate($$select public.create_personal_account('{"name":"Bad","currencyCode":"UZS","openingAmountMinor":"0","openingDate":"2026-02-30","timeZone":"UTC"}'::jsonb, '22222222-2222-4222-8222-222222222226')$$, '22023', 'invalid calendar date rejected');
select public.g02_expect_sqlstate($$select public.create_personal_account('{"name":"Bad","currencyCode":"UZS","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"Mars/Olympus"}'::jsonb, '22222222-2222-4222-8222-222222222227')$$, '22023', 'invalid time zone rejected');
select public.g02_expect_sqlstate($$select public.create_personal_account('{"name":"Bad","currencyCode":"UZS","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"UTC","ownerId":"10000000-0000-4000-8000-000000000002"}'::jsonb, '22222222-2222-4222-8222-222222222228')$$, '22023', 'unknown JSON key rejected');
select public.g02_expect_sqlstate($$select public.create_personal_account(jsonb_build_object('name', E'Bad\nname','currencyCode','UZS','openingAmountMinor','0','openingDate','2026-01-01','timeZone','UTC'), '22222222-2222-4222-8222-222222222238')$$, '22023', 'control characters in account name rejected');
select public.g02_expect_sqlstate($$select public.create_personal_account('{"name":"Bad","currencyCode":"UZS","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, null::uuid)$$, '22023', 'null client key rejected');
select public.g02_expect_sqlstate($$select public.create_personal_account('{"name":"Bad","currencyCode":"UZS","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '22222222-2222-3222-8222-222222222229')$$, '22023', 'non-v4 client key rejected');

select public.g02_expect_sqlstate(format($fmt$select public.create_personal_account(jsonb_build_object('name','Future wallet','currencyCode','UZS','openingAmountMinor','0','openingDate',to_char((clock_timestamp() at time zone 'UTC')::date + 1,'YYYY-MM-DD'),'timeZone','UTC'), '22222222-2222-4222-8222-222222222230')$fmt$), '22023', 'date after today in stored zone rejected');

insert into g02_results values ('usd-max', public.create_personal_account(
  jsonb_build_object('name','USD cash','currencyCode','USD','openingAmountMinor','100000000000000','openingDate','2026-01-01','timeZone','UTC','icon','cash','color','#1a2b3c','includeInTotal',false),
  '22222222-2222-4222-8222-222222222231'));
insert into g02_results values ('jpy-min', public.create_personal_account(
  jsonb_build_object('name','JPY cash','currencyCode','JPY','openingAmountMinor','-1000000000000','openingDate','2024-02-29','timeZone','UTC'),
  '22222222-2222-4222-8222-222222222232'));
insert into g02_results values ('zero', public.create_personal_account(
  jsonb_build_object('name','Zero cash','currencyCode','UZS','openingAmountMinor','-0','openingDate','2026-01-01','timeZone','UTC'),
  '22222222-2222-4222-8222-222222222233'));
select public.g02_assert((select amount_minor=0 from public.personal_postings where account_id=(select (result->>'accountId')::uuid from g02_results where label='zero')),
  'negative zero normalizes to zero');
insert into g02_results values ('zero-replay', public.create_personal_account(
  jsonb_build_object('name',' Zero cash ','currencyCode','UZS','openingAmountMinor','0','openingDate','2026-01-01','timeZone','UTC','color','#18794e'),
  '22222222-2222-4222-8222-222222222233'));
select public.g02_assert((select result->'replayed'='true'::jsonb from g02_results where label='zero-replay'),
  'trimmed name, normalized color, and negative zero replay canonically');
select public.g02_expect_sqlstate($$select public.create_personal_account('{"name":"USD over","currencyCode":"USD","openingAmountMinor":"100000000000001","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '22222222-2222-4222-8222-222222222234')$$, '22023', 'USD minor-unit overflow rejected');
select public.g02_expect_sqlstate($$select public.create_personal_account('{"name":"JPY over","currencyCode":"JPY","openingAmountMinor":"1000000000001","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '22222222-2222-4222-8222-222222222235')$$, '22023', 'JPY minor-unit overflow rejected');

insert into g02_results values ('helper', creditbook_private.create_personal_account(
  jsonb_build_object('name','Helper cash','currencyCode','UZS','openingAmountMinor','5000000','openingDate','2026-01-01','timeZone','UTC'),
  '22222222-2222-4222-8222-222222222236'));
select public.g02_assert((select result->'replayed'='false'::jsonb from g02_results where label='helper'),
  'guarded private helper is executable by authenticated caller');
select public.g02_assert((select sum(amount_minor)=15000000 from public.personal_postings where currency_code='UZS'),
  'UZS ledger sum is exactly 15000000 minor units (150000 UZS), including excluded account');
reset role;
update public.personal_accounts set include_in_total=false where id=(select (result->>'accountId')::uuid from g02_results where label='helper');
select public.g02_assert((select sum(amount_minor)=15000000 from public.personal_postings where currency_code='UZS'),
  'include-in-total changes no ledger history');

create temp table g02_rollback_snapshot as
select (select count(*) from public.personal_accounts) as account_count,
  (select count(*) from public.personal_postings) as posting_count,
  (select count(*) from public.personal_audit_events) as audit_count,
  (select jsonb_agg(to_jsonb(p) order by p.workspace_id) from public.personal_workspace_preferences p) as preferences;

create function public.g02_fail_audit_once() returns trigger language plpgsql as $$
begin
  if current_setting('g02.fail_audit', true)='on' then
    raise exception 'injected audit failure';
  end if;
  return new;
end;
$$;
create trigger g02_injected_audit_failure before insert on public.personal_audit_events
for each row execute function public.g02_fail_audit_once();
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select set_config('g02.fail_audit', 'on', false);
select public.g02_expect_sqlstate($$select public.create_personal_account('{"name":"Atomic retry","currencyCode":"USD","openingAmountMinor":"10","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '22222222-2222-4222-8222-222222222237')$$, 'P0001', 'injected audit failure aborts create');
reset role;
select public.g02_assert((select count(*)=0 from public.personal_accounts where name='Atomic retry')
  and (select count(*)=0 from creditbook_private.personal_command_receipts where client_key='22222222-2222-4222-8222-222222222237')
  and (select posting_count=(select count(*) from public.personal_postings) and audit_count=(select count(*) from public.personal_audit_events)
    and preferences=(select jsonb_agg(to_jsonb(p) order by p.workspace_id) from public.personal_workspace_preferences p) from g02_rollback_snapshot),
  'audit failure rolls back account, posting, audit, preferences, and receipt');
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select set_config('g02.fail_audit', 'off', false);
insert into g02_results values ('atomic-retry', public.create_personal_account(
  jsonb_build_object('name','Atomic retry','currencyCode','USD','openingAmountMinor','10','openingDate','2026-01-01','timeZone','UTC'),
  '22222222-2222-4222-8222-222222222237'));
select public.g02_assert((select result->'replayed'='false'::jsonb from g02_results where label='atomic-retry'),
  'same key succeeds after atomic rollback');

select public.g02_expect_sqlstate($$update public.personal_accounts set name='No direct DML'$$, '42501', 'authenticated cannot directly update accounts');
select public.g02_expect_sqlstate($$delete from public.personal_postings$$, '42501', 'authenticated cannot directly delete postings');
select public.g02_expect_sqlstate($$select * from creditbook_private.personal_command_receipts$$, '42501', 'authenticated cannot read private receipts');
select public.g02_expect_sqlstate(format('update public.personal_accounts set currency_code=%L where id=%L', 'JPY', (select result->>'accountId' from g02_results where label='first')), '42501', 'authenticated cannot directly change account identity');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
select public.g02_assert((select count(*)=0 from public.personal_accounts), 'foreign user cannot read accounts');
select public.g02_assert((select count(*)=0 from public.personal_postings), 'foreign user cannot read postings');
select public.g02_assert((select count(*)=0 from public.personal_workspace_preferences), 'foreign user cannot read preferences');
select public.g02_assert((select count(*)=0 from public.personal_audit_events), 'foreign user cannot read audit events');
select public.g02_expect_sqlstate($$insert into public.personal_accounts(workspace_id,name,currency_code,scale) values ('00000000-0000-4000-8000-000000000001','Direct', 'UZS',2)$$, '42501', 'foreign user cannot directly insert accounts');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
select public.g02_assert((select count(*)=0 from public.personal_accounts), 'platform admin has no personal-data bypass');
reset role;

update auth.users set banned_until=now() + interval '1 day' where id='10000000-0000-4000-8000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select public.g02_assert((select count(*)=0 from public.personal_accounts), 'banned owner cannot read existing accounts');
select public.g02_expect_sqlstate($$select public.create_personal_account('{"name":"Main wallet","currencyCode":"UZS","openingAmountMinor":"10000000","openingDate":"2026-01-01","timeZone":"Asia/Tokyo"}'::jsonb, '22222222-2222-4222-8222-222222222222')$$, '42501', 'banned owner cannot replay public create');
select public.g02_expect_sqlstate($$select creditbook_private.create_personal_account('{"name":"Helper cash","currencyCode":"UZS","openingAmountMinor":"5000000","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '22222222-2222-4222-8222-222222222236')$$, '42501', 'banned owner cannot call guarded private helper');
select set_config('request.jwt.claim.sub', '', false);
select public.g02_expect_sqlstate($$select creditbook_private.create_personal_account('{"name":"No identity","currencyCode":"UZS","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '22222222-2222-4222-8222-222222222243')$$, '42501', 'missing identity cannot call guarded private helper');
reset role;
update auth.users set banned_until=null where id='10000000-0000-4000-8000-000000000001';
update public.personal_workspaces set status='suspended' where owner_user_id='10000000-0000-4000-8000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select public.g02_assert((select count(*)=0 from public.personal_accounts), 'suspended workspace hides existing accounts');
select public.g02_expect_sqlstate($$select public.create_personal_account('{"name":"Suspended wallet","currencyCode":"USD","openingAmountMinor":"0","openingDate":"2026-01-01","timeZone":"UTC"}'::jsonb, '22222222-2222-4222-8222-222222222244')$$, '42501', 'suspended workspace cannot create');
reset role;
update public.personal_workspaces set status='active' where owner_user_id='10000000-0000-4000-8000-000000000001';

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', false);
insert into g02_results values ('kiritimati-today', public.create_personal_account(
  jsonb_build_object('name','Kiritimati today','currencyCode','USD','openingAmountMinor','0',
    'openingDate',to_char((clock_timestamp() at time zone 'Pacific/Kiritimati')::date,'YYYY-MM-DD'),'timeZone','Pacific/Kiritimati'),
  '22222222-2222-4222-8222-222222222245'));
select public.g02_assert((select result->'replayed'='false'::jsonb from g02_results where label='kiritimati-today'),
  'Kiritimati local today is accepted independently of server UTC date');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', false);
select public.g02_expect_sqlstate($$select public.create_personal_account(jsonb_build_object('name','Pago Pago future','currencyCode','USD','openingAmountMinor','0','openingDate',to_char((clock_timestamp() at time zone 'Pacific/Kiritimati')::date,'YYYY-MM-DD'),'timeZone','Pacific/Pago_Pago'), '22222222-2222-4222-8222-222222222246')$$, '22023', 'Kiritimati today is future in Pago Pago');
reset role;

create function public.g02_expect_deferred_and_unique() returns void language plpgsql as $$
declare v_workspace uuid; v_account uuid; v_first uuid; v_helper uuid; state text;
begin
  select id into v_workspace from public.personal_workspaces where owner_user_id='10000000-0000-4000-8000-000000000001';
  select id into v_first from public.personal_accounts where name='Main wallet';
  select id into v_helper from public.personal_accounts where name='Helper cash';
  begin
    insert into public.personal_accounts(workspace_id,name,currency_code,scale) values(v_workspace,'Deferred account','UZS',2) returning id into v_account;
    set constraints all immediate;
    raise exception 'missing opening unexpectedly committed';
  exception when others then
    get stacked diagnostics state=returned_sqlstate;
    if state <> '23514' then raise; end if;
  end;
  begin
    insert into public.personal_accounts(workspace_id,name,currency_code,scale) values(v_workspace,'Unique account','UZS',2) returning id into v_account;
    insert into public.personal_postings(workspace_id,account_id,currency_code,scale,kind,amount_minor,effective_date) values(v_workspace,v_account,'UZS',2,'opening',1,'2026-01-01');
    insert into public.personal_postings(workspace_id,account_id,currency_code,scale,kind,amount_minor,effective_date) values(v_workspace,v_account,'UZS',2,'opening',2,'2026-01-01');
    raise exception 'duplicate opening unexpectedly inserted';
  exception when unique_violation then
    raise notice 'PASS: partial unique opening index rejects duplicate opening';
  end;
  begin
    update public.personal_accounts set status='archived' where id=v_first;
    set constraints all immediate;
    raise exception 'archived default unexpectedly committed';
  exception when others then
    get stacked diagnostics state=returned_sqlstate;
    if state <> '23514' then raise; end if;
  end;
  update public.personal_accounts set status='archived' where id=v_first;
  update public.personal_workspace_preferences set default_account_id=v_helper where workspace_id=v_workspace;
  set constraints all immediate;
  raise notice 'PASS: default archive needs repair and succeeds when repaired in one transaction';
  begin
    update public.personal_accounts set currency_code='JPY' where id=v_helper;
    raise exception 'account identity unexpectedly changed';
  exception when insufficient_privilege then
    raise notice 'PASS: account identity is immutable';
  end;
  begin
    update public.personal_postings set amount_minor=99 where account_id=v_helper;
    raise exception 'posting history unexpectedly changed';
  exception when insufficient_privilege then
    raise notice 'PASS: posting history is immutable';
  end;
  begin
    update public.personal_audit_events set event_type='account.created' where account_id=v_helper;
    raise exception 'audit history unexpectedly changed';
  exception when insufficient_privilege then
    raise notice 'PASS: audit history is immutable';
  end;
  begin
    update creditbook_private.personal_command_receipts set result='{}'::jsonb where client_key='22222222-2222-4222-8222-222222222236';
    raise exception 'receipt history unexpectedly changed';
  exception when insufficient_privilege then
    raise notice 'PASS: receipt history is immutable';
  end;
  raise notice 'PASS: deferred opening constraint rejects account without opening';
end;
$$;
select public.g02_expect_deferred_and_unique();

-- Exhaustive denied-DML matrix over production tables (fixtures excluded).
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
do $$
declare target text; identity_column text;
begin
  for target,identity_column in select * from (values
    ('public.personal_accounts','id'),('public.personal_postings','id'),
    ('public.personal_workspace_preferences','workspace_id'),('public.personal_audit_events','id'),
    ('creditbook_private.personal_command_receipts','id')) t(name,col)
  loop
    perform public.g02_expect_sqlstate(format('insert into %s default values',target),'42501','authenticated INSERT denied: '||target);
    perform public.g02_expect_sqlstate(format('update %s set %I=%I where false',target,identity_column,identity_column),'42501','authenticated UPDATE denied: '||target);
    perform public.g02_expect_sqlstate(format('delete from %s where false',target),'42501','authenticated DELETE denied: '||target);
  end loop;
end;
$$;
reset role;
set role anon;
do $$
declare target text; identity_column text;
begin
  for target,identity_column in select * from (values
    ('public.personal_accounts','id'),('public.personal_postings','id'),
    ('public.personal_workspace_preferences','workspace_id'),('public.personal_audit_events','id'),
    ('creditbook_private.personal_command_receipts','id')) t(name,col)
  loop
    perform public.g02_expect_sqlstate(format('insert into %s default values',target),'42501','anon INSERT denied: '||target);
    perform public.g02_expect_sqlstate(format('update %s set %I=%I where false',target,identity_column,identity_column),'42501','anon UPDATE denied: '||target);
    perform public.g02_expect_sqlstate(format('delete from %s where false',target),'42501','anon DELETE denied: '||target);
  end loop;
end;
$$;
reset role;

-- Synthetic race observations only; this table is NOT in the migration.
create table public.g02_conflict_results(caller text primary key,outcome text not null,result jsonb);
grant insert on public.g02_conflict_results to authenticated;
