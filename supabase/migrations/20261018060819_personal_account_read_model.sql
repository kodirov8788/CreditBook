begin;
-- Read-only owner view. Aggregate in Postgres to avoid Data API row caps and
-- serialize exact sums as text rather than lossy JSON numbers.
create function public.get_personal_accounts(p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_workspace uuid; v_result jsonb;
begin
  if p_offset < 0 or p_offset > 100000 or p_offset is null then
    raise exception 'Invalid offset.' using errcode='22023';
  end if;
  if not creditbook_private.is_current_account_active() then
    raise exception 'Personal access denied.' using errcode='42501';
  end if;
  select id into v_workspace from public.personal_workspaces
    where owner_user_id=auth.uid() and status='active';
  if v_workspace is null then
    raise exception 'Personal workspace unavailable.' using errcode='42501';
  end if;
  with balances as (
    select a.*, coalesce((select sum(p.amount_minor) from public.personal_postings p
      where p.workspace_id=a.workspace_id and p.account_id=a.id),0) as balance
    from public.personal_accounts a where a.workspace_id=v_workspace
  ), page as (
    select * from balances order by created_at,id limit 50 offset p_offset
  ), totals as (
    select currency_code,scale,
      coalesce(sum(balance) filter(where include_in_total and status='active'),0)::text as included,
      coalesce(sum(balance) filter(where status='archived'),0)::text as archived
    from balances group by currency_code,scale
  )
  select jsonb_build_object(
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'icon',icon,'color',color,
      'currencyCode',currency_code,'scale',scale,'status',status,'includeInTotal',include_in_total,
      'version',version,'balanceMinor',balance::text) order by created_at,id) from page),'[]'::jsonb),
    'totals',coalesce((select jsonb_agg(jsonb_build_object('currencyCode',currency_code,'scale',scale,
      'includedMinor',included,'archivedMinor',archived) order by currency_code) from totals),'[]'::jsonb),
    'preferences',coalesce((select jsonb_build_object('defaultAccountId',default_account_id,
      'timeZone',time_zone,'version',version) from public.personal_workspace_preferences where workspace_id=v_workspace),'null'::jsonb),
    'paginationLimitReached',p_offset=100000 and (select count(*) from balances)>100050,
    'nextOffset',case when p_offset<100000 and (select count(*) from balances)>p_offset+50 then p_offset+50 else null end
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_personal_accounts(integer) from public,anon,authenticated;
grant execute on function public.get_personal_accounts(integer) to authenticated;
commit;
