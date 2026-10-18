begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
select set_config('g02.race_name',:'caller',true);
do $$ declare a public.g02_manage_race_fixture; cmd jsonb;
begin
 -- Both workers deliberately use the version present before either worker.
 select * into a from public.g02_manage_race_fixture;
 cmd:=jsonb_build_object('operation','update','accountId',a.id,'accountVersion',a.version,'preferencesVersion',a.preferences_version,'name',current_setting('g02.race_name'));
 begin
  perform public.manage_personal_account(cmd,gen_random_uuid());
  insert into public.g02_manage_race_results values(current_setting('g02.race_name'),'success');
 exception when unique_violation then
  insert into public.g02_manage_race_results values(current_setting('g02.race_name'),'conflict');
 end;
end $$;
select pg_sleep(1);
commit;
