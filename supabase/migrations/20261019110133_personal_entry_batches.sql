-- G03 manual JPY create/batch foundation. No adoption/backfill of legacy money.
-- Reviewed/executed only in a newly owned disposable local PostgreSQL fixture.
begin;

create table creditbook_private.personal_entry_command_receipts (
  id uuid primary key,
  workspace_id uuid not null references public.personal_workspaces(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  client_key uuid not null,
  fingerprint bytea not null check (octet_length(fingerprint)=32),
  result jsonb not null check (jsonb_typeof(result)='object'),
  recorded_at timestamptz not null default now(),
  unique (workspace_id,actor_id,client_key),
  unique (workspace_id,id,actor_id)
);

create table public.personal_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  account_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id,account_id)
    references public.personal_accounts(workspace_id,id) on delete restrict,
  unique (workspace_id,account_id,id)
);

create table public.personal_entry_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  account_id uuid not null,
  entry_id uuid not null,
  version integer not null check (version>0),
  actor_id uuid not null,
  command_id uuid not null,
  kind text not null check (kind in ('income','expense')),
  amount_minor bigint not null check (amount_minor between 1 and 1000000000000),
  currency_code text not null check (currency_code='JPY'),
  scale smallint not null check (scale=0),
  category_id uuid not null,
  category_name text not null check (char_length(category_name) between 1 and 80),
  effective_date date not null check (effective_date between date '0001-01-01' and date '9999-12-31'),
  note text not null default '' check (char_length(note)<=2000),
  recorded_at timestamptz not null default now(),
  foreign key (workspace_id,account_id,entry_id)
    references public.personal_entries(workspace_id,account_id,id) on delete restrict,
  foreign key (workspace_id,account_id,currency_code,scale)
    references public.personal_accounts(workspace_id,id,currency_code,scale) on delete restrict,
  foreign key (workspace_id,category_id)
    references public.personal_categories(workspace_id,id) on delete restrict,
  foreign key (workspace_id,command_id,actor_id)
    references creditbook_private.personal_entry_command_receipts(workspace_id,id,actor_id) on delete restrict,
  unique (entry_id,version),
  unique (workspace_id,account_id,entry_id,id)
);

-- Existing opening rows and the one-opening partial index are retained.
alter table public.personal_postings drop constraint personal_postings_kind_check;
alter table public.personal_postings add constraint personal_postings_kind_check
  check (kind in ('opening','income','expense'));
alter table public.personal_postings add constraint personal_entry_posting_values
  check (kind='opening' or (currency_code='JPY' and scale=0 and
    ((kind='income' and amount_minor>0) or (kind='expense' and amount_minor<0))));
alter table public.personal_postings add constraint personal_entry_posting_identity
  unique (workspace_id,account_id,id);

create table public.personal_entry_posting_links (
  workspace_id uuid not null,
  account_id uuid not null,
  entry_id uuid not null,
  revision_id uuid primary key,
  posting_id uuid not null unique,
  foreign key (workspace_id,account_id,entry_id,revision_id)
    references public.personal_entry_revisions(workspace_id,account_id,entry_id,id) on delete restrict,
  foreign key (workspace_id,account_id,posting_id)
    references public.personal_postings(workspace_id,account_id,id) on delete restrict
);
create index personal_entries_account on public.personal_entries(workspace_id,account_id,created_at,id);
create index personal_entry_effective_history on public.personal_entry_revisions(workspace_id,effective_date,id);
create index personal_entry_category_history on public.personal_entry_revisions(workspace_id,category_id,effective_date);
create index personal_entry_revision_command on public.personal_entry_revisions(workspace_id,command_id,actor_id);
create index personal_entry_link_posting on public.personal_entry_posting_links(workspace_id,account_id,posting_id);

alter table creditbook_private.personal_entry_command_receipts enable row level security;
alter table public.personal_entries enable row level security;
alter table public.personal_entry_revisions enable row level security;
alter table public.personal_entry_posting_links enable row level security;
revoke all on creditbook_private.personal_entry_command_receipts,public.personal_entries,
  public.personal_entry_revisions,public.personal_entry_posting_links from public,anon,authenticated,service_role;
grant select on public.personal_entries,public.personal_entry_revisions,public.personal_entry_posting_links to authenticated;
create policy personal_entry_owner_read on public.personal_entries for select to authenticated
  using (creditbook_private.owns_active_personal_workspace(workspace_id));
create policy personal_entry_revision_owner_read on public.personal_entry_revisions for select to authenticated
  using (creditbook_private.owns_active_personal_workspace(workspace_id));
create policy personal_entry_link_owner_read on public.personal_entry_posting_links for select to authenticated
  using (creditbook_private.owns_active_personal_workspace(workspace_id));
create trigger personal_entries_immutable before update or delete on public.personal_entries
  for each row execute function creditbook_private.reject_personal_history_mutation();
create trigger personal_entry_revisions_immutable before update or delete on public.personal_entry_revisions
  for each row execute function creditbook_private.reject_personal_history_mutation();
create trigger personal_entry_links_immutable before update or delete on public.personal_entry_posting_links
  for each row execute function creditbook_private.reject_personal_history_mutation();
create trigger personal_entry_receipts_immutable before update or delete on creditbook_private.personal_entry_command_receipts
  for each row execute function creditbook_private.reject_personal_history_mutation();

-- Composite FKs protect tenant identity; this also protects the linked effect.
create function creditbook_private.validate_personal_entry_link()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists (
    select 1 from public.personal_entry_revisions r
    join public.personal_postings p on p.id=new.posting_id
      and p.workspace_id=r.workspace_id and p.account_id=r.account_id
    where r.id=new.revision_id and r.entry_id=new.entry_id
      and r.workspace_id=new.workspace_id and r.account_id=new.account_id
      and p.currency_code=r.currency_code and p.scale=r.scale and p.kind=r.kind
      and p.effective_date=r.effective_date
      and p.amount_minor=case when r.kind='income' then r.amount_minor else -r.amount_minor end
  ) then
    raise exception 'Entry posting does not match its revision.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function creditbook_private.validate_personal_entry_link() from public,anon,authenticated,service_role;
create trigger personal_entry_link_validate before insert on public.personal_entry_posting_links
  for each row execute function creditbook_private.validate_personal_entry_link();

-- Check at COMMIT: the command inserts its receipt before its entries, then
-- revisions/postings before links. Even a future privileged writer cannot
-- commit a money effect without the complete immutable audit chain.
create function creditbook_private.require_personal_entry_chain()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_complete boolean;
begin
  if TG_TABLE_SCHEMA='public' and TG_TABLE_NAME='personal_postings' then
    if new.kind='opening' then return null; end if;
    select exists(select 1 from public.personal_entry_posting_links l
      where l.posting_id=new.id and l.workspace_id=new.workspace_id and l.account_id=new.account_id)
      into v_complete;
  elsif TG_TABLE_SCHEMA='public' and TG_TABLE_NAME='personal_entries' then
    select exists(select 1 from public.personal_entry_revisions r
      where r.entry_id=new.id and r.workspace_id=new.workspace_id and r.account_id=new.account_id and r.version=1)
      into v_complete;
  elsif TG_TABLE_SCHEMA='public' and TG_TABLE_NAME='personal_entry_revisions' then
    select exists(select 1 from public.personal_entry_posting_links l
      where l.revision_id=new.id and l.workspace_id=new.workspace_id and l.account_id=new.account_id)
      into v_complete;
  elsif TG_TABLE_SCHEMA='creditbook_private' and TG_TABLE_NAME='personal_entry_command_receipts' then
    select exists(select 1 from public.personal_entry_revisions r
      where r.command_id=new.id and r.workspace_id=new.workspace_id and r.actor_id=new.actor_id)
      into v_complete;
  end if;
  if v_complete is distinct from true then
    raise exception 'Entry requires a complete immutable posting and audit chain.' using errcode='23514';
  end if;
  return null;
end;
$$;
revoke all on function creditbook_private.require_personal_entry_chain() from public,anon,authenticated,service_role;
create constraint trigger personal_posting_requires_entry after insert on public.personal_postings
  deferrable initially deferred for each row execute function creditbook_private.require_personal_entry_chain();
create constraint trigger personal_entry_requires_revision after insert on public.personal_entries
  deferrable initially deferred for each row execute function creditbook_private.require_personal_entry_chain();
create constraint trigger personal_revision_requires_posting after insert on public.personal_entry_revisions
  deferrable initially deferred for each row execute function creditbook_private.require_personal_entry_chain();
create constraint trigger personal_entry_receipt_requires_revision after insert on creditbook_private.personal_entry_command_receipts
  deferrable initially deferred for each row execute function creditbook_private.require_personal_entry_chain();

create function creditbook_private.create_personal_entries(p_command jsonb,p_client_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_workspace uuid;
  v_account public.personal_accounts;
  v_receipt creditbook_private.personal_entry_command_receipts;
  v_item jsonb;
  v_category uuid;
  v_category_name text;
  v_date date;
  v_amount bigint;
  v_income numeric := 0;
  v_expense numeric := 0;
  v_balance numeric;
  v_fingerprint bytea;
  v_command_id uuid := gen_random_uuid();
  v_entry_id uuid;
  v_revision_id uuid;
  v_posting_id uuid;
  v_prepared jsonb := '[]';
  v_results jsonb := '[]';
  v_result jsonb;
begin
  if not creditbook_private.is_current_account_active() then
    raise exception 'Personal access denied.' using errcode='42501';
  end if;
  select w.id into v_workspace from public.personal_workspaces w
    where w.owner_user_id=auth.uid() and w.status='active' for update;
  if not found or not creditbook_private.is_current_account_active() then
    raise exception 'Personal access denied.' using errcode='42501';
  end if;
  if p_client_key is null
    or p_client_key::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_command is null or jsonb_typeof(p_command) is distinct from 'object'
    or octet_length(p_command::text)>65536 then
    raise exception 'Invalid entry command.' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_command) k where k<>'entries')
    or jsonb_typeof(p_command->'entries') is distinct from 'array' then
    raise exception 'Invalid entry fields.' using errcode='22023';
  end if;
  if jsonb_array_length(p_command->'entries') not between 1 and 100 then
    raise exception 'Entry batch must contain 1 to 100 items.' using errcode='22023';
  end if;
  v_fingerprint := pg_catalog.sha256(pg_catalog.convert_to(p_command::text,'UTF8'));
  select * into v_receipt from creditbook_private.personal_entry_command_receipts r
    where r.workspace_id=v_workspace and r.actor_id=auth.uid() and r.client_key=p_client_key;
  if found then
    if v_receipt.fingerprint is distinct from v_fingerprint then
      raise exception 'Idempotency key was used for another command.' using errcode='23505';
    end if;
    return v_receipt.result || jsonb_build_object('replayed',true);
  end if;
  select a.* into v_account from public.personal_accounts a
    join public.personal_books b on b.workspace_id=a.workspace_id and b.account_id=a.id
    where b.workspace_id=v_workspace for update of a;
  if not found or v_account.status<>'active' or v_account.currency_code<>'JPY' or v_account.scale<>0 then
    raise exception 'Active personal JPY book required.' using errcode='42501';
  end if;

  -- Shape-check before casts; lock all category rows in a deterministic order.
  for v_item in select value from jsonb_array_elements(p_command->'entries') loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'Invalid entry item.' using errcode='22023';
    end if;
    if exists (select 1 from jsonb_object_keys(v_item) k where k not in
        ('kind','amountMinor','currencyCode','categoryId','effectiveDate','note'))
      or jsonb_typeof(v_item->'kind') is distinct from 'string'
      or jsonb_typeof(v_item->'amountMinor') is distinct from 'string'
      or jsonb_typeof(v_item->'currencyCode') is distinct from 'string'
      or jsonb_typeof(v_item->'categoryId') is distinct from 'string'
      or jsonb_typeof(v_item->'effectiveDate') is distinct from 'string'
      or (v_item ? 'note' and jsonb_typeof(v_item->'note') is distinct from 'string') then
      raise exception 'Invalid entry item fields.' using errcode='22023';
    end if;
    if v_item->>'kind' not in ('income','expense') or v_item->>'currencyCode'<>'JPY'
      or (v_item->>'amountMinor') !~ '^[1-9][0-9]{0,12}$'
      or (v_item->>'categoryId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or char_length(v_item->>'effectiveDate')<>10
      or (v_item->>'effectiveDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or char_length(coalesce(v_item->>'note',''))>2000
      or translate(coalesce(v_item->>'note',''),E'\t\n\r','') ~ '[[:cntrl:]]'
      or coalesce(v_item->>'note','') ~ U&'[\0080-\009F]' then
      raise exception 'Invalid entry item values.' using errcode='22023';
    end if;
    v_amount := (v_item->>'amountMinor')::bigint;
    if v_amount>1000000000000 then
      raise exception 'Entry amount exceeds storage bound.' using errcode='22023';
    end if;
    begin
      v_date := (v_item->>'effectiveDate')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Invalid entry date.' using errcode='22023';
    end;
    if v_date not between date '0001-01-01' and date '9999-12-31'
      or to_char(v_date,'YYYY-MM-DD')<>v_item->>'effectiveDate' then
      raise exception 'Invalid entry date.' using errcode='22023';
    end if;
  end loop;
  perform c.id from public.personal_categories c
    where c.workspace_id=v_workspace and c.id in (
      select (value->>'categoryId')::uuid from jsonb_array_elements(p_command->'entries'))
    order by c.id for update;

  select coalesce(sum(p.amount_minor),0) into v_balance from public.personal_postings p
    where p.workspace_id=v_workspace and p.account_id=v_account.id;
  for v_item in select value from jsonb_array_elements(p_command->'entries') loop
    v_category := (v_item->>'categoryId')::uuid;
    select name into v_category_name from public.personal_categories
      where workspace_id=v_workspace and id=v_category and status='active';
    if not found then
      raise exception 'Active owned category required.' using errcode='42501';
    end if;
    v_amount := (v_item->>'amountMinor')::bigint;
    if v_item->>'kind'='income' then v_income:=v_income+v_amount;
    else v_expense:=v_expense+v_amount; end if;
    v_entry_id:=gen_random_uuid(); v_revision_id:=gen_random_uuid(); v_posting_id:=gen_random_uuid();
    v_prepared := v_prepared || jsonb_build_array(v_item || jsonb_build_object(
      'entryId',v_entry_id,'revisionId',v_revision_id,'postingId',v_posting_id,
      'categoryName',v_category_name,'note',coalesce(v_item->>'note','')));
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'entryId',v_entry_id,'revisionId',v_revision_id,'postingId',v_posting_id,'version',1));
  end loop;
  v_balance := v_balance+v_income-v_expense;
  -- Atomic batches have one committed balance, not per-item temporary bounds.
  if v_balance not between -1000000000000 and 1000000000000 then
    raise exception 'Final book balance exceeds storage bound.' using errcode='22023';
  end if;
  v_result := jsonb_build_object('commandId',v_command_id,'entries',v_results,
    'balanceMinor',v_balance::text,'incomeMinor',v_income::text,'expenseMinor',v_expense::text,
    'negativeBalance',v_balance<0);
  insert into creditbook_private.personal_entry_command_receipts
    (id,workspace_id,actor_id,client_key,fingerprint,result)
    values(v_command_id,v_workspace,auth.uid(),p_client_key,v_fingerprint,v_result);
  for v_item in select value from jsonb_array_elements(v_prepared) loop
    v_entry_id:=(v_item->>'entryId')::uuid; v_revision_id:=(v_item->>'revisionId')::uuid;
    v_posting_id:=(v_item->>'postingId')::uuid; v_amount:=(v_item->>'amountMinor')::bigint;
    insert into public.personal_entries(id,workspace_id,account_id)
      values(v_entry_id,v_workspace,v_account.id);
    insert into public.personal_entry_revisions
      (id,workspace_id,account_id,entry_id,version,actor_id,command_id,kind,amount_minor,
        currency_code,scale,category_id,category_name,effective_date,note)
      values(v_revision_id,v_workspace,v_account.id,v_entry_id,1,auth.uid(),v_command_id,
        v_item->>'kind',v_amount,'JPY',0,(v_item->>'categoryId')::uuid,
        v_item->>'categoryName',(v_item->>'effectiveDate')::date,v_item->>'note');
    insert into public.personal_postings
      (id,workspace_id,account_id,currency_code,scale,kind,amount_minor,effective_date)
      values(v_posting_id,v_workspace,v_account.id,'JPY',0,v_item->>'kind',
        case when v_item->>'kind'='income' then v_amount else -v_amount end,
        (v_item->>'effectiveDate')::date);
    insert into public.personal_entry_posting_links(workspace_id,account_id,entry_id,revision_id,posting_id)
      values(v_workspace,v_account.id,v_entry_id,v_revision_id,v_posting_id);
  end loop;
  return v_result || jsonb_build_object('replayed',false);
end;
$$;
revoke all on function creditbook_private.create_personal_entries(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function creditbook_private.create_personal_entries(jsonb,uuid) to authenticated;
create function public.create_personal_entries(p_command jsonb,p_client_key uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select creditbook_private.create_personal_entries(p_command,p_client_key);
$$;
revoke all on function public.create_personal_entries(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_personal_entries(jsonb,uuid) to authenticated;
commit;
