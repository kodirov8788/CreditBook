-- Seed only synthetic rows before business activity triggers are installed.
insert into auth.users(id,email) values
 ('81000000-0000-4000-8000-000000000001','backfill@fixture.test');
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',false);
insert into public.customers(id,user_id,shop_id,name)
select '81000000-0000-4000-8000-000000000002',id,current_shop_id,'Synthetic old customer'
from public.profiles where id='81000000-0000-4000-8000-000000000001';
insert into public.expenses(id,user_id,shop_id,category,amount,spent_at,created_at)
select '81000000-0000-4000-8000-000000000003',id,current_shop_id,'Old expense',25,
 '2026-01-01','2026-01-01T01:00:00Z' from public.profiles
where id='81000000-0000-4000-8000-000000000001';
insert into public.reminders(id,user_id,shop_id,customer_id,channel,message,created_at)
select '81000000-0000-4000-8000-000000000004',id,current_shop_id,
 '81000000-0000-4000-8000-000000000002','manual','Synthetic old reminder','2026-01-02T02:00:00Z'
from public.profiles where id='81000000-0000-4000-8000-000000000001';
do $$ begin
 if (select count(*) from public.expenses where id='81000000-0000-4000-8000-000000000003')<>1
 or (select count(*) from public.reminders where id='81000000-0000-4000-8000-000000000004')<>1
 or exists(select 1 from public.activity_logs where metadata->>'entity_id' in
 ('81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000004')) then
  raise exception 'FAIL: historical repair fixture must have source rows without activity';
 end if;
 raise notice 'PASS: pre-trigger expense/reminder exist without activity records';
end $$;
