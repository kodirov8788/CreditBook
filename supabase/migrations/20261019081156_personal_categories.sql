-- G01 personal categories. This is intentionally isolated from money-command
-- receipts and does not seed, delete, or change any existing personal records.
begin;

create table public.personal_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.personal_workspaces(id) on delete restrict,
  name text not null check (
    name = btrim(name)
    and char_length(name) between 1 and 80
    and name !~ '[[:cntrl:]]'
  ),
  status text not null default 'active' check (status in ('active','archived')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,id)
);

create table creditbook_private.personal_category_command_receipts (
  id uuid primary key,
  workspace_id uuid not null references public.personal_workspaces(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  client_key uuid not null,
  fingerprint bytea not null check (octet_length(fingerprint)=32),
  result jsonb not null check (jsonb_typeof(result)='object'),
  recorded_at timestamptz not null default now(),
  unique (workspace_id,actor_id,client_key)
);

create table public.personal_category_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  category_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null unique references creditbook_private.personal_category_command_receipts(id) on delete restrict,
  before_name text,
  after_name text,
  before_status text check (before_status is null or before_status in ('active','archived')),
  after_status text check (after_status is null or after_status in ('active','archived')),
  category_version integer not null check (category_version > 0),
  recorded_at timestamptz not null default now(),
  foreign key (workspace_id,category_id)
    references public.personal_categories(workspace_id,id) on delete restrict,
  unique (category_id,category_version)
);

create index personal_category_order
  on public.personal_categories(workspace_id,status,created_at,id);
create index personal_category_history
  on public.personal_category_events(workspace_id,recorded_at,id);

alter table public.personal_categories enable row level security;
alter table public.personal_category_events enable row level security;
alter table creditbook_private.personal_category_command_receipts enable row level security;

revoke all on public.personal_categories, public.personal_category_events,
  creditbook_private.personal_category_command_receipts from public, anon, authenticated, service_role;
grant select on public.personal_categories, public.personal_category_events to authenticated;

create policy personal_category_owner_read
on public.personal_categories for select to authenticated
using (creditbook_private.owns_active_personal_workspace(workspace_id));

create policy personal_category_event_owner_read
on public.personal_category_events for select to authenticated
using (creditbook_private.owns_active_personal_workspace(workspace_id));

create function creditbook_private.protect_personal_category_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.workspace_id is distinct from old.workspace_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Category identity cannot be changed.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function creditbook_private.protect_personal_category_identity()
  from public, anon, authenticated, service_role;

create trigger personal_category_protect_identity
before update on public.personal_categories
for each row execute function creditbook_private.protect_personal_category_identity();

create trigger personal_category_events_immutable
before update or delete on public.personal_category_events
for each row execute function creditbook_private.reject_personal_history_mutation();

create trigger personal_category_receipts_immutable
before update or delete on creditbook_private.personal_category_command_receipts
for each row execute function creditbook_private.reject_personal_history_mutation();

-- The definer function is intentionally callable by authenticated users only,
-- but validates the current pilot/account state itself so callers cannot rely
-- on the public invoker wrapper for authorization.
create function creditbook_private.manage_personal_category(
  p_command jsonb,
  p_client_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_category_id uuid := gen_random_uuid();
  v_target_id uuid;
  v_operation text;
  v_name text;
  v_expected_version integer;
  v_fingerprint bytea;
  v_receipt creditbook_private.personal_category_command_receipts;
  v_category public.personal_categories;
  v_before_name text;
  v_before_status text;
  v_command_id uuid := gen_random_uuid();
  v_result jsonb;
begin
  if not creditbook_private.is_current_account_active() then
    raise exception 'Personal access denied.' using errcode = '42501';
  end if;

  select w.id into v_workspace
  from public.personal_workspaces w
  where w.owner_user_id = auth.uid() and w.status = 'active'
  for update;
  if not found or not creditbook_private.is_current_account_active() then
    raise exception 'Personal access denied.' using errcode = '42501';
  end if;

  if p_client_key is null
    or p_client_key::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_command is null
    or jsonb_typeof(p_command) is distinct from 'object'
    or octet_length(p_command::text) > 4096
    or jsonb_typeof(p_command->'operation') is distinct from 'string' then
    raise exception 'Invalid category command.' using errcode = '22023';
  end if;

  v_operation := p_command->>'operation';
  if v_operation = 'create' then
    if exists (select 1 from jsonb_object_keys(p_command) k where k not in ('operation','name'))
      or not (p_command ? 'name')
      or jsonb_typeof(p_command->'name') is distinct from 'string' then
      raise exception 'Invalid category fields.' using errcode = '22023';
    end if;
    v_name := btrim(p_command->>'name');
  elsif v_operation = 'rename' then
    if exists (select 1 from jsonb_object_keys(p_command) k where k not in ('operation','categoryId','categoryVersion','name'))
      or not (p_command ? 'categoryId')
      or not (p_command ? 'categoryVersion')
      or not (p_command ? 'name')
      or jsonb_typeof(p_command->'categoryId') is distinct from 'string'
      or jsonb_typeof(p_command->'categoryVersion') is distinct from 'number'
      or jsonb_typeof(p_command->'name') is distinct from 'string'
      or (p_command->>'categoryId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or (p_command->>'categoryVersion') !~ '^[1-9][0-9]{0,8}$' then
      raise exception 'Invalid category fields.' using errcode = '22023';
    end if;
    v_name := btrim(p_command->>'name');
    v_target_id := (p_command->>'categoryId')::uuid;
    v_expected_version := (p_command->>'categoryVersion')::integer;
  elsif v_operation = 'archive' then
    if exists (select 1 from jsonb_object_keys(p_command) k where k not in ('operation','categoryId','categoryVersion'))
      or not (p_command ? 'categoryId')
      or not (p_command ? 'categoryVersion')
      or jsonb_typeof(p_command->'categoryId') is distinct from 'string'
      or jsonb_typeof(p_command->'categoryVersion') is distinct from 'number'
      or (p_command->>'categoryId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or (p_command->>'categoryVersion') !~ '^[1-9][0-9]{0,8}$' then
      raise exception 'Invalid category fields.' using errcode = '22023';
    end if;
    v_target_id := (p_command->>'categoryId')::uuid;
    v_expected_version := (p_command->>'categoryVersion')::integer;
  else
    raise exception 'Invalid category operation.' using errcode = '22023';
  end if;

  if v_operation in ('create','rename')
    and (char_length(v_name) not between 1 and 80 or v_name ~ '[[:cntrl:]]') then
    raise exception 'Invalid category name.' using errcode = '22023';
  end if;

  -- JSONB text is canonical for objects. Keep the submitted name in this
  -- fingerprint even though the persisted category name is trimmed.
  v_fingerprint := pg_catalog.sha256(pg_catalog.convert_to(p_command::text, 'UTF8'));
  select * into v_receipt
  from creditbook_private.personal_category_command_receipts r
  where r.workspace_id = v_workspace
    and r.actor_id = auth.uid()
    and r.client_key = p_client_key;
  if found then
    if v_receipt.fingerprint is distinct from v_fingerprint then
      raise exception 'Idempotency key was used for another command.' using errcode = '23505';
    end if;
    return v_receipt.result || jsonb_build_object('replayed', true);
  end if;

  if v_operation = 'create' then
    insert into public.personal_categories (id,workspace_id,name)
    values (v_category_id,v_workspace,v_name)
    returning * into v_category;
    v_before_name := null;
    v_before_status := null;
  else
    select * into v_category
    from public.personal_categories c
    where c.id = v_target_id and c.workspace_id = v_workspace
    for update;
    if not found then
      raise exception 'Personal category access denied.' using errcode = '42501';
    end if;
    if v_category.version <> v_expected_version then
      raise exception 'Stale category version.' using errcode = '23505';
    end if;

    v_before_name := v_category.name;
    v_before_status := v_category.status;
    if v_operation = 'rename' then
      if v_category.status <> 'active' then
        raise exception 'Archived categories cannot be renamed.' using errcode = '22023';
      end if;
      update public.personal_categories
      set name = v_name, version = version + 1
      where id = v_category.id and workspace_id = v_workspace
      returning * into v_category;
    else
      if v_category.status <> 'active' then
        raise exception 'Category is already archived.' using errcode = '22023';
      end if;
      update public.personal_categories
      set status = 'archived', version = version + 1
      where id = v_category.id and workspace_id = v_workspace
      returning * into v_category;
    end if;
  end if;

  v_result := jsonb_build_object(
    'categoryId', v_category.id,
    'categoryVersion', v_category.version,
    'commandId', v_command_id
  );
  insert into creditbook_private.personal_category_command_receipts
    (id,workspace_id,actor_id,client_key,fingerprint,result)
  values
    (v_command_id,v_workspace,auth.uid(),p_client_key,v_fingerprint,v_result);
  insert into public.personal_category_events
    (workspace_id,category_id,actor_id,command_id,before_name,after_name,before_status,after_status,category_version)
  values
    (v_workspace,v_category.id,auth.uid(),v_command_id,v_before_name,v_category.name,
      v_before_status,v_category.status,v_category.version);

  return v_result || jsonb_build_object('replayed', false);
end;
$$;
revoke all on function creditbook_private.manage_personal_category(jsonb,uuid)
  from public, anon, authenticated, service_role;
grant execute on function creditbook_private.manage_personal_category(jsonb,uuid) to authenticated;

create function public.manage_personal_category(
  p_command jsonb,
  p_client_key uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select creditbook_private.manage_personal_category(p_command,p_client_key);
$$;
revoke all on function public.manage_personal_category(jsonb,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.manage_personal_category(jsonb,uuid) to authenticated;

commit;
