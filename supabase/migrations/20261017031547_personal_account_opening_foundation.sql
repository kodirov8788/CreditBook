-- G02 local foundation. Keep G01's production/UI release block in force.
begin;

create table public.personal_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.personal_workspaces(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 80 and name !~ '[[:cntrl:]]'),
  icon text not null default 'wallet' check (icon in ('cash','card','bank','wallet')),
  color text not null default '#18794E' check (char_length(color)=7 and color ~ '^#[0-9A-F]{6}$'),
  currency_code text not null,
  scale smallint not null,
  status text not null default 'active' check (status in ('active','archived')),
  include_in_total boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  unique (workspace_id,id),
  unique (workspace_id,id,currency_code,scale),
  check ((currency_code in ('UZS','USD') and scale=2) or (currency_code='JPY' and scale=0))
);

create table public.personal_postings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  account_id uuid not null,
  currency_code text not null,
  scale smallint not null,
  kind text not null check (kind='opening'),
  amount_minor bigint not null,
  effective_date date not null check (effective_date >= date '0001-01-01' and effective_date <= date '9999-12-31'),
  recorded_at timestamptz not null default now(),
  foreign key (workspace_id,account_id,currency_code,scale)
    references public.personal_accounts(workspace_id,id,currency_code,scale) on delete restrict,
  check ((scale=2 and amount_minor between -100000000000000 and 100000000000000)
    or (scale=0 and amount_minor between -1000000000000 and 1000000000000))
);
create unique index personal_one_opening on public.personal_postings(workspace_id,account_id) where kind='opening';
create index personal_account_order on public.personal_accounts(workspace_id,created_at,id);
create index personal_posting_history on public.personal_postings(workspace_id,account_id,recorded_at,id);

create table public.personal_workspace_preferences (
  workspace_id uuid primary key references public.personal_workspaces(id) on delete restrict,
  default_account_id uuid,
  time_zone text not null check (char_length(time_zone) between 1 and 64),
  version integer not null default 1 check (version > 0),
  foreign key (workspace_id,default_account_id)
    references public.personal_accounts(workspace_id,id) on delete restrict
);

create table creditbook_private.personal_command_receipts (
  id uuid primary key,
  workspace_id uuid not null references public.personal_workspaces(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  operation text not null check (operation='account.create.v1'),
  client_key uuid not null,
  fingerprint bytea not null check (octet_length(fingerprint)=32),
  result jsonb not null check (jsonb_typeof(result)='object'),
  recorded_at timestamptz not null default now(),
  unique(workspace_id,actor_id,operation,client_key)
);

create table public.personal_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  account_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null unique references creditbook_private.personal_command_receipts(id) on delete restrict,
  event_type text not null check (event_type='account.created'),
  recorded_at timestamptz not null default now(),
  foreign key(workspace_id,account_id) references public.personal_accounts(workspace_id,id) on delete restrict
);
create index personal_audit_history on public.personal_audit_events(workspace_id,recorded_at,id);

alter table public.personal_accounts enable row level security;
alter table public.personal_postings enable row level security;
alter table public.personal_workspace_preferences enable row level security;
alter table public.personal_audit_events enable row level security;
alter table creditbook_private.personal_command_receipts enable row level security;
revoke all on public.personal_accounts, public.personal_postings, public.personal_workspace_preferences,
  public.personal_audit_events, creditbook_private.personal_command_receipts from public,anon,authenticated,service_role;
grant select on public.personal_accounts, public.personal_postings,
  public.personal_workspace_preferences, public.personal_audit_events to authenticated;

create function creditbook_private.owns_active_personal_workspace(p_workspace uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select creditbook_private.is_current_account_active() and exists (
    select 1 from public.personal_workspaces w
    where w.id=p_workspace and w.owner_user_id=auth.uid() and w.status='active'
  );
$$;
revoke all on function creditbook_private.owns_active_personal_workspace(uuid) from public,anon,authenticated;
grant execute on function creditbook_private.owns_active_personal_workspace(uuid) to authenticated;

create policy personal_account_owner_read on public.personal_accounts for select to authenticated
  using (creditbook_private.owns_active_personal_workspace(workspace_id));
create policy personal_posting_owner_read on public.personal_postings for select to authenticated
  using (creditbook_private.owns_active_personal_workspace(workspace_id));
create policy personal_preferences_owner_read on public.personal_workspace_preferences for select to authenticated
  using (creditbook_private.owns_active_personal_workspace(workspace_id));
create policy personal_audit_owner_read on public.personal_audit_events for select to authenticated
  using (creditbook_private.owns_active_personal_workspace(workspace_id));

create function creditbook_private.reject_personal_history_mutation()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception 'Financial history is immutable.' using errcode='42501';
end;
$$;
revoke all on function creditbook_private.reject_personal_history_mutation() from public,anon,authenticated;
create trigger personal_postings_immutable before update or delete on public.personal_postings
  for each row execute function creditbook_private.reject_personal_history_mutation();
create trigger personal_audit_immutable before update or delete on public.personal_audit_events
  for each row execute function creditbook_private.reject_personal_history_mutation();
create trigger personal_receipts_immutable before update or delete on creditbook_private.personal_command_receipts
  for each row execute function creditbook_private.reject_personal_history_mutation();

create function creditbook_private.protect_personal_account_identity()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id
    or new.currency_code is distinct from old.currency_code or new.scale is distinct from old.scale
    or new.created_at is distinct from old.created_at then
    raise exception 'Account identity cannot be changed.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function creditbook_private.protect_personal_account_identity() from public,anon,authenticated;
create trigger personal_account_identity before update on public.personal_accounts
  for each row execute function creditbook_private.protect_personal_account_identity();

create function creditbook_private.require_personal_opening()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (select count(*) from public.personal_postings p
    where p.workspace_id=new.workspace_id and p.account_id=new.id and p.kind='opening') <> 1 then
    raise exception 'Account requires exactly one opening posting.' using errcode='23514';
  end if;
  return null;
end;
$$;
revoke all on function creditbook_private.require_personal_opening() from public,anon,authenticated;
create constraint trigger personal_account_requires_opening after insert on public.personal_accounts
  deferrable initially deferred for each row execute function creditbook_private.require_personal_opening();

create function creditbook_private.validate_personal_default()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name=new.time_zone) then
    raise exception 'Invalid time zone.' using errcode='22023';
  end if;
  if new.default_account_id is not null and not exists (
    select 1 from public.personal_accounts a where a.id=new.default_account_id
      and a.workspace_id=new.workspace_id and a.status='active'
  ) then
    raise exception 'Default account must be active in this workspace.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function creditbook_private.validate_personal_default() from public,anon,authenticated;
create trigger personal_default_validate before insert or update on public.personal_workspace_preferences
  for each row execute function creditbook_private.validate_personal_default();

create function creditbook_private.require_active_personal_default()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists (select 1 from public.personal_workspace_preferences p
    join public.personal_accounts a on a.id=p.default_account_id and a.workspace_id=p.workspace_id
    where a.id=new.id and a.status<>'active') then
    raise exception 'Default account must remain active.' using errcode='23514';
  end if;
  return null;
end;
$$;
revoke all on function creditbook_private.require_active_personal_default() from public,anon,authenticated;
create constraint trigger personal_default_remains_active after update on public.personal_accounts
  deferrable initially deferred for each row execute function creditbook_private.require_active_personal_default();

-- Privilege is needed ONLY because table DML is denied to callers; every direct
-- helper call performs the same full guard. Wrapper origin is never trusted.
create function creditbook_private.create_personal_account(p_command jsonb,p_client_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_workspace uuid;
  v_name text;
  v_currency text;
  v_scale smallint;
  v_limit bigint;
  v_amount bigint;
  v_date date;
  v_timezone text;
  v_icon text;
  v_color text;
  v_include boolean;
  v_fingerprint bytea;
  v_receipt creditbook_private.personal_command_receipts;
  v_preferences public.personal_workspace_preferences;
  v_account uuid := gen_random_uuid();
  v_posting uuid := gen_random_uuid();
  v_command uuid := gen_random_uuid();
  v_result jsonb;
begin
  if not creditbook_private.is_current_account_active() then
    raise exception 'Shaxsiy hisob uchun ruxsat yo''q.' using errcode='42501';
  end if;
  select w.id into v_workspace from public.personal_workspaces w
    where w.owner_user_id=auth.uid() and w.status='active' for update;
  if not found then raise exception 'Shaxsiy hisob uchun ruxsat yo''q.' using errcode='42501'; end if;
  if not creditbook_private.is_current_account_active() then
    raise exception 'Shaxsiy hisob uchun ruxsat yo''q.' using errcode='42501';
  end if;

  if p_client_key is null or p_client_key::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_command is null or jsonb_typeof(p_command) is distinct from 'object'
    or octet_length(p_command::text)>4096 then
    raise exception 'Invalid account command.' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_command) k where k not in
    ('name','currencyCode','openingAmountMinor','openingDate','timeZone','icon','color','includeInTotal'))
    or jsonb_typeof(p_command->'name') is distinct from 'string'
    or jsonb_typeof(p_command->'currencyCode') is distinct from 'string'
    or jsonb_typeof(p_command->'openingAmountMinor') is distinct from 'string'
    or jsonb_typeof(p_command->'openingDate') is distinct from 'string'
    or jsonb_typeof(p_command->'timeZone') is distinct from 'string'
    or (p_command ? 'icon' and jsonb_typeof(p_command->'icon') is distinct from 'string')
    or (p_command ? 'color' and jsonb_typeof(p_command->'color') is distinct from 'string')
    or (p_command ? 'includeInTotal' and jsonb_typeof(p_command->'includeInTotal') is distinct from 'boolean') then
    raise exception 'Invalid account fields.' using errcode='22023';
  end if;
  v_name:=btrim(p_command->>'name');
  v_currency:=p_command->>'currencyCode';
  v_timezone:=p_command->>'timeZone';
  v_icon:=coalesce(p_command->>'icon','wallet');
  v_color:=upper(coalesce(p_command->>'color','#18794E'));
  v_include:=coalesce((p_command->>'includeInTotal')::boolean,true);
  if char_length(v_name) not between 2 and 80 or v_name ~ '[[:cntrl:]]' or v_currency not in ('UZS','JPY','USD')
    or char_length(v_timezone) not between 1 and 64
    or v_icon not in ('cash','card','bank','wallet') or char_length(v_color)<>7 or v_color !~ '^#[0-9A-F]{6}$'
    or char_length(p_command->>'openingAmountMinor')>16
    or (p_command->>'openingAmountMinor') !~ '^-?(0|[1-9][0-9]*)$'
    or (p_command->>'openingAmountMinor') ~ '[[:space:]]'
    or char_length(p_command->>'openingDate')<>10
    or (p_command->>'openingDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Invalid account values.' using errcode='22023';
  end if;
  v_scale:=case when v_currency='JPY' then 0 else 2 end;
  v_limit:=case when v_scale=0 then 1000000000000 else 100000000000000 end;
  v_amount:=(p_command->>'openingAmountMinor')::bigint;
  if v_amount < -v_limit or v_amount > v_limit then
    raise exception 'Account exceeds one trillion currency units.' using errcode='22023';
  end if;
  begin
    v_date:=(p_command->>'openingDate')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Invalid opening date.' using errcode='22023';
  end;
  if v_date < date '0001-01-01' or v_date > date '9999-12-31' then
    raise exception 'Invalid opening date.' using errcode='22023';
  end if;
  v_fingerprint:=pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object(
    'operation','account.create.v1','name',v_name,'currencyCode',v_currency,
    'openingAmountMinor',v_amount::text,'openingDate',to_char(v_date,'YYYY-MM-DD'),'timeZone',v_timezone,
    'icon',v_icon,'color',v_color,'includeInTotal',v_include
  )::text,'UTF8'));
  -- Read AFTER locking workspace, BEFORE mutable-state checks, so concurrent
  -- retries replay and later state/settings changes never recreate the account.
  select * into v_receipt from creditbook_private.personal_command_receipts r
    where r.workspace_id=v_workspace and r.actor_id=auth.uid()
      and r.operation='account.create.v1' and r.client_key=p_client_key;
  if found then
    if v_receipt.fingerprint is distinct from v_fingerprint then
      raise exception 'Idempotency key was used for another command.' using errcode='23505';
    end if;
    return v_receipt.result || jsonb_build_object('replayed',true);
  end if;

  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name=v_timezone) then
    raise exception 'Invalid time zone.' using errcode='22023';
  end if;
  select * into v_preferences from public.personal_workspace_preferences where workspace_id=v_workspace;
  if found and v_preferences.time_zone <> v_timezone then
    raise exception 'Use the workspace time zone; settings changes are separate.' using errcode='22023';
  end if;
  if v_date > (clock_timestamp() at time zone coalesce(v_preferences.time_zone,v_timezone))::date then
    raise exception 'Opening date cannot be in the future.' using errcode='22023';
  end if;
  insert into public.personal_workspace_preferences(workspace_id,time_zone)
    values(v_workspace,v_timezone) on conflict(workspace_id) do nothing;
  insert into public.personal_accounts(id,workspace_id,name,icon,color,currency_code,scale,include_in_total)
    values(v_account,v_workspace,v_name,v_icon,v_color,v_currency,v_scale,v_include);
  insert into public.personal_postings(id,workspace_id,account_id,currency_code,scale,kind,amount_minor,effective_date)
    values(v_posting,v_workspace,v_account,v_currency,v_scale,'opening',v_amount,v_date);
  update public.personal_workspace_preferences
    set default_account_id=v_account,version=version+1
    where workspace_id=v_workspace and default_account_id is null;
  select * into v_preferences from public.personal_workspace_preferences where workspace_id=v_workspace;
  v_result:=jsonb_build_object('commandId',v_command,'accountId',v_account,
    'openingPostingId',v_posting,'accountVersion',1,'preferencesVersion',v_preferences.version);
  insert into creditbook_private.personal_command_receipts(id,workspace_id,actor_id,operation,client_key,fingerprint,result)
    values(v_command,v_workspace,auth.uid(),'account.create.v1',p_client_key,v_fingerprint,v_result);
  insert into public.personal_audit_events(workspace_id,account_id,actor_id,command_id,event_type)
    values(v_workspace,v_account,auth.uid(),v_command,'account.created');
  return v_result || jsonb_build_object('replayed',false);
end;
$$;
revoke all on function creditbook_private.create_personal_account(jsonb,uuid) from public,anon,authenticated;
grant execute on function creditbook_private.create_personal_account(jsonb,uuid) to authenticated;

create function public.create_personal_account(p_command jsonb,p_client_key uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select creditbook_private.create_personal_account(p_command,p_client_key);
$$;
revoke all on function public.create_personal_account(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_personal_account(jsonb,uuid) to authenticated;

commit;
