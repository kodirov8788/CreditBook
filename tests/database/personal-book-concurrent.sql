-- Both rounds are observed by a third session while one waits on the other's
-- real workspace row lock. Sleeping after initialization retains that lock.
select set_config('application_name','creditbook-book-race',false);
begin;
set local role authenticated;
\if :different_keys
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000005',true);
do $$ begin
 perform public.initialize_personal_book('{"openingAmountMinor":"0","openingDate":"2026-01-01"}',gen_random_uuid());
 exception when sqlstate 'PT409' then
  if sqlerrm<>'BOOK_EXISTS' then raise; end if;
end; $$;
\else
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
select public.initialize_personal_book('{"openingAmountMinor":"10000","openingDate":"2026-01-01"}','91000000-0000-4000-8000-000000000013');
\endif
select pg_sleep(3);
commit;
