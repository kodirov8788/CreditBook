-- G02: new personal books only. Never backfill/adopt/convert legacy balances.
begin;

create table public.personal_books (
  workspace_id uuid primary key references public.personal_workspaces(id) on delete restrict,
  account_id uuid not null unique,
  currency_code text not null default 'JPY' check (currency_code='JPY'),
  scale smallint not null default 0 check (scale=0),
  created_at timestamptz not null default now(),
  foreign key (workspace_id,account_id,currency_code,scale)
    references public.personal_accounts(workspace_id,id,currency_code,scale) on delete restrict
);
alter table public.personal_books enable row level security;
revoke all on public.personal_books from public,anon,authenticated,service_role;
grant select on public.personal_books to authenticated;
create policy personal_book_owner_read on public.personal_books for select to authenticated
  using (creditbook_private.owns_active_personal_workspace(workspace_id));
create trigger personal_book_immutable before update or delete on public.personal_books
  for each row execute function creditbook_private.reject_personal_history_mutation();

-- Apply to every insertion path, including legacy public/private create RPCs.
-- Existing create helpers lock this same workspace; the extra lock also protects
-- future insertion paths. An archived book still occupies the unique book slot.
create function creditbook_private.enforce_personal_single_book()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if TG_WHEN='BEFORE' then
    perform 1 from public.personal_workspaces where id=new.workspace_id for update;
    if exists(select 1 from public.personal_books where workspace_id=new.workspace_id) then
      raise exception 'BOOK_EXISTS' using errcode='PT409';
    end if;
    if exists(select 1 from public.personal_accounts where workspace_id=new.workspace_id) then
      raise exception 'LEGACY_SETUP_REQUIRED' using errcode='PT409';
    end if;
    if new.currency_code<>'JPY' or new.scale<>0 or not exists (
      select 1 from public.personal_workspace_preferences
      where workspace_id=new.workspace_id and time_zone='Asia/Tokyo'
    ) then
      raise exception 'New personal books require JPY and Asia/Tokyo' using errcode='22023';
    end if;
  else
    insert into public.personal_books(workspace_id,account_id) values(new.workspace_id,new.id);
  end if;
  return new;
end;
$$;
revoke all on function creditbook_private.enforce_personal_single_book() from public,anon,authenticated,service_role;
create trigger personal_single_book_before before insert on public.personal_accounts
  for each row execute function creditbook_private.enforce_personal_single_book();
create trigger personal_single_book_after after insert on public.personal_accounts
  for each row execute function creditbook_private.enforce_personal_single_book();

create function public.get_personal_book()
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare w uuid; result jsonb;
begin
  if not creditbook_private.is_current_account_active() then
    raise exception 'Access denied' using errcode='42501';
  end if;
  select id into w from public.personal_workspaces where owner_user_id=auth.uid() and status='active';
  if w is null then
    if exists(select 1 from public.personal_workspaces where owner_user_id=auth.uid()) then
      raise exception 'Access denied' using errcode='42501';
    end if;
    return jsonb_build_object('state','empty');
  end if;
  select jsonb_build_object('state','ready','book',jsonb_build_object(
    'id',a.id,'name',a.name,'status',a.status,'currencyCode',a.currency_code,'scale',a.scale,
    'balanceMinor',coalesce((select sum(p.amount_minor)::text from public.personal_postings p
      where p.workspace_id=w and p.account_id=a.id),'0'),
    'timeZone',pref.time_zone,'defaultPaymentMethod','cash','defaultEntryKind','expense'))
  into result from public.personal_books b join public.personal_accounts a
    on a.workspace_id=b.workspace_id and a.id=b.account_id
    join public.personal_workspace_preferences pref on pref.workspace_id=b.workspace_id
  where b.workspace_id=w;
  if result is not null then return result; end if;
  if exists(select 1 from public.personal_accounts where workspace_id=w) then
    return jsonb_build_object('state','legacy_setup_required','code','LEGACY_SETUP_REQUIRED');
  end if;
  return jsonb_build_object('state','empty');
end;
$$;
revoke all on function public.get_personal_book() from public,anon,authenticated,service_role;
grant execute on function public.get_personal_book() to authenticated;

-- One atomic command delegates exact money, audit, idempotency and opening to
-- the existing guarded helper. The trigger binds its one newly created account.
create function public.initialize_personal_book(p_command jsonb,p_client_key uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if not creditbook_private.is_current_account_active() then
    raise exception 'Access denied' using errcode='42501';
  end if;
  if p_command is null or jsonb_typeof(p_command) is distinct from 'object'
    or octet_length(p_command::text)>1024
    or exists(select 1 from jsonb_object_keys(p_command) k where k not in ('openingAmountMinor','openingDate'))
    or jsonb_typeof(p_command->'openingAmountMinor') is distinct from 'string'
    or jsonb_typeof(p_command->'openingDate') is distinct from 'string' then
    raise exception 'Invalid book command' using errcode='22023';
  end if;
  perform public.ensure_my_personal_workspace();
  return public.create_personal_account(jsonb_build_object(
    'name','Shaxsiy hisob','currencyCode','JPY','timeZone','Asia/Tokyo','icon','cash',
    'openingAmountMinor',p_command->>'openingAmountMinor','openingDate',p_command->>'openingDate'),p_client_key);
end;
$$;
revoke all on function public.initialize_personal_book(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.initialize_personal_book(jsonb,uuid) to authenticated;
commit;
