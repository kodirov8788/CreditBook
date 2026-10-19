-- Run after the first backfill and again after a replay to detect duplicates.
do $$ begin
 if (select count(*) from public.activity_logs where metadata->>'entity_id' in
 ('81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000004'))<>2 then
  raise exception 'FAIL: backfill must create exactly two linked historical activity rows';
 end if;
 if not exists(select 1 from public.activity_logs a join public.expenses e
 on a.metadata->>'entity_id'=e.id::text
 where e.id='81000000-0000-4000-8000-000000000003' and a.event_type='expense'
 and a.user_id=e.user_id and a.shop_id=e.shop_id and a.created_at=e.created_at
 and a.metadata->>'operation'='backfill' and (a.metadata->>'amount')::numeric=e.amount) then
  raise exception 'FAIL: backfilled expense lost its identity, time, owner, amount or shop';
 end if;
 if not exists(select 1 from public.activity_logs a join public.reminders r
 on a.metadata->>'entity_id'=r.id::text
 where r.id='81000000-0000-4000-8000-000000000004' and a.event_type='reminder'
 and a.user_id=r.user_id and a.shop_id=r.shop_id and a.customer_id=r.customer_id
 and a.created_at=r.created_at and a.metadata->>'operation'='backfill'
 and a.metadata->>'status'=r.status and a.metadata->>'channel'=r.channel) then
  raise exception 'FAIL: backfilled reminder lost its identity, time, owner, state or shop';
 end if;
 raise notice 'PASS: historical repair/replay has exactly two correctly linked activities';
end $$;
