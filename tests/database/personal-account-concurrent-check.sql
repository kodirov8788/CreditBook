\echo 'Checking concurrent idempotent account creation'
create function public.g02_concurrent_assert(ok boolean, label text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end;
$$;

select public.g02_concurrent_assert((select count(*)=1 from public.personal_accounts where name='Concurrent wallet'),
  'same request creates one account under concurrent callers');
select public.g02_concurrent_assert((select count(*)=1 from public.personal_postings p join public.personal_accounts a on a.id=p.account_id where a.name='Concurrent wallet' and p.kind='opening'),
  'concurrent account has one opening posting');
select public.g02_concurrent_assert((select count(*)=1 from public.personal_audit_events e join public.personal_accounts a on a.id=e.account_id where a.name='Concurrent wallet'),
  'concurrent request creates one audit event');
select public.g02_concurrent_assert((select count(*)=1 from creditbook_private.personal_command_receipts where client_key='33333333-3333-4333-8333-333333333333'),
  'concurrent request creates one receipt');
select public.g02_concurrent_assert((select count(*)=2 and count(*) filter(where outcome='success')=1
  and count(*) filter(where outcome='conflict')=1 from public.g02_conflict_results),
  'conflicting concurrent payloads produce one success and one 23505');
select public.g02_concurrent_assert((select count(*)=1 from public.personal_accounts where name in ('Conflicting A','Conflicting B')),
  'conflicting concurrent commands leave one account');
select public.g02_concurrent_assert((select count(*)=1 from public.personal_postings p join public.personal_accounts a on a.id=p.account_id
  where a.name in ('Conflicting A','Conflicting B')),
  'conflicting concurrent commands leave one posting');
select public.g02_concurrent_assert((select count(*)=1 from public.personal_audit_events e join public.personal_accounts a on a.id=e.account_id
  where a.name in ('Conflicting A','Conflicting B')),
  'conflicting concurrent commands leave one audit');
select public.g02_concurrent_assert((select count(*)=1 from creditbook_private.personal_command_receipts
  where client_key='44444444-4444-4444-8444-444444444444'),
  'conflicting concurrent commands leave one receipt');
