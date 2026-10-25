-- Fail rather than claim concurrency from two potentially serial invocations.
do $$
declare deadline timestamptz:=clock_timestamp()+interval '15 seconds';
begin
 loop
  perform pg_stat_clear_snapshot();
  if (select count(*) from pg_stat_activity where application_name='creditbook-book-race')=2
   and exists(select 1 from pg_stat_activity where application_name='creditbook-book-race' and wait_event_type='Lock') then
   raise notice 'PASS: observed two live book sessions with real lock contention';
   return;
  end if;
  if clock_timestamp()>deadline then raise exception 'FAIL: concurrent overlap was not observed'; end if;
  perform pg_sleep(0.05);
 end loop;
end;
$$;
