-- Issue #49: keep membership writes server-managed and protect the last owner.

-- The remote migration history contains current_shop_resolution, but older
-- production schema introspection showed its DDL was not present. Repair the
-- current-shop primitives idempotently before the membership safeguards below.
alter table public.profiles
  add column if not exists current_shop_id uuid references public.shops(id) on delete set null;

create or replace function public.get_current_shop_id()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_shop_id uuid;
begin
  select p.current_shop_id into v_shop_id
  from public.profiles p
  join public.shop_members m on m.shop_id = p.current_shop_id and m.user_id = auth.uid() and m.status = 'active'
  join public.shops s on s.id = p.current_shop_id and s.status = 'active'
  where p.id = auth.uid();

  if v_shop_id is not null then
    return v_shop_id;
  end if;

  select m.shop_id into v_shop_id
  from public.shop_members m
  join public.shops s on s.id = m.shop_id
  where m.user_id = auth.uid() and m.status = 'active' and s.status = 'active'
  order by (m.role = 'shop_owner') desc, m.created_at, m.shop_id
  limit 1;
  return v_shop_id;
end;
$$;

grant execute on function public.get_current_shop_id() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_shop_id uuid;
  v_shop_name text;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;

  select coalesce(nullif(trim(p.shop_name), ''), 'Mahalla do''koni') into v_shop_name
  from public.profiles p where p.id = new.id;

  insert into public.shops (owner_user_id, name)
  select new.id, v_shop_name
  where not exists (select 1 from public.shops s where s.owner_user_id = new.id)
  returning id into v_shop_id;

  if v_shop_id is null then
    select s.id into v_shop_id from public.shops s where s.owner_user_id = new.id order by s.created_at, s.id limit 1;
  end if;

  insert into public.shop_members (shop_id, user_id, role, status, invited_by)
  values (v_shop_id, new.id, 'shop_owner', 'active', new.id)
  on conflict (shop_id, user_id) do nothing;

  update public.profiles set current_shop_id = v_shop_id where id = new.id and current_shop_id is null;
  return new;
end;
$$;

alter function public.handle_new_user() set search_path = pg_catalog, public;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.switch_current_shop(p_shop_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.shop_members m
    join public.shops s on s.id = m.shop_id
    where m.shop_id = p_shop_id and m.user_id = auth.uid() and m.status = 'active' and s.status = 'active'
  ) then
    raise exception 'Bu shopga a''zo emassiz.' using errcode = '42501';
  end if;
  update public.profiles set current_shop_id = p_shop_id where id = auth.uid();
  return p_shop_id;
end;
$$;

revoke all on function public.switch_current_shop(uuid) from public, anon, authenticated;
grant execute on function public.switch_current_shop(uuid) to authenticated;

update public.profiles p
set current_shop_id = (
  select m.shop_id from public.shop_members m
  join public.shops s on s.id = m.shop_id
  where m.user_id = p.id and m.status = 'active' and s.status = 'active'
  order by (m.role = 'shop_owner') desc, m.created_at, m.shop_id
  limit 1
)
where p.current_shop_id is null;

drop policy if exists "Memberships manageable by permission" on public.shop_members;

create or replace function public.prevent_last_owner_removal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_count integer;
begin
  if tg_op = 'DELETE' then
    if old.role = 'shop_owner' and old.status = 'active' then
      perform 1 from public.shops where id = old.shop_id for update;
      select count(*) into v_owner_count
      from public.shop_members
      where shop_id = old.shop_id
        and role = 'shop_owner'
        and status = 'active';
      if v_owner_count <= 1 then
        raise exception 'Oxirgi shop owner''ni o''chirib bo''lmaydi.' using errcode = '23514';
      end if;
    end if;
    return old;
  end if;

  if old.role = 'shop_owner'
    and old.status = 'active'
    and (new.role is distinct from old.role or new.status is distinct from old.status)
  then
    perform 1 from public.shops where id = old.shop_id for update;
    select count(*) into v_owner_count
    from public.shop_members
    where shop_id = old.shop_id
      and role = 'shop_owner'
      and status = 'active';
    if v_owner_count <= 1 then
      raise exception 'Oxirgi shop owner''ni o''zgartirib bo''lmaydi.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists shop_members_last_owner_guard on public.shop_members;
create trigger shop_members_last_owner_guard
before update or delete on public.shop_members
for each row execute function public.prevent_last_owner_removal();

revoke all on function public.prevent_last_owner_removal() from public, anon, authenticated;

-- The current-shop selector is safe only for authenticated users with an active membership.
revoke all on function public.switch_current_shop(uuid) from public, anon, authenticated;
grant execute on function public.switch_current_shop(uuid) to authenticated;

-- Keep invite activation idempotent while refusing to switch a user into an unrelated shop.
create or replace function public.activate_invited_memberships(p_shop_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1
    from public.shop_members m
    join public.shops s on s.id = m.shop_id
    where m.user_id = auth.uid()
      and m.shop_id = p_shop_id
      and m.status in ('invited', 'active')
      and s.status = 'active'
  ) then
    raise exception 'Taklif topilmadi yoki muddati tugagan.' using errcode = 'P0002';
  end if;

  update public.shop_members
  set status = 'active'
  where user_id = auth.uid()
    and shop_id = p_shop_id
    and status = 'invited';
  get diagnostics v_count = row_count;

  update public.profiles
  set current_shop_id = p_shop_id
  where id = auth.uid();

  return v_count;
end;
$$;

revoke all on function public.activate_invited_memberships(uuid) from public, anon, authenticated;
grant execute on function public.activate_invited_memberships(uuid) to authenticated;
