-- Both callers use the same authenticated owner, command, and valid v4 key.
-- The sleep intentionally holds the transaction after the RPC returns.
\if :{?conflict_name}
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('g02.conflict_name', :'conflict_name', true);
do $$
declare result jsonb; caller text := current_setting('g02.conflict_name');
begin
  begin
    result:=public.create_personal_account(jsonb_build_object(
      'name',caller,'currencyCode','UZS',
      'openingAmountMinor',case when caller='Conflicting A' then '11' else '22' end,
      'openingDate','2026-01-01','timeZone','UTC'),
      '44444444-4444-4444-8444-444444444444');
    insert into public.g02_conflict_results values(caller,'success',result);
  exception when unique_violation then
    insert into public.g02_conflict_results values(caller,'conflict',null);
  end;
end;
$$;
select pg_sleep(1);
commit;
\else
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select public.create_personal_account(
  jsonb_build_object('name','Concurrent wallet','currencyCode','UZS','openingAmountMinor','7',
    'openingDate','2026-01-01','timeZone','UTC'),
  '33333333-3333-4333-8333-333333333333');
select pg_sleep(1);
commit;
\endif
