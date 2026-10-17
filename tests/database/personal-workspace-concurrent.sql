begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
select public.ensure_my_personal_workspace();
-- Hold the first transaction open while the other caller reaches uniqueness.
select pg_sleep(1);
commit;
