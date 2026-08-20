-- Issue #60: get_current_shop_id() always preferred any shop the user owns,
-- so invited team members silently acted in their own auto-provisioned shop
-- instead of the shop they were invited to. Fix: persist which shop is
-- "current" per user, and set it explicitly at signup and at invite acceptance.

alter table public.profiles
  add column if not exists current_shop_id uuid references public.shops(id) on delete set null;

-- Resolve the current shop from the persisted preference first; fall back to
-- the old owner-preferring guess only when nothing has been set yet (e.g. an
-- account that predates this migration and hasn't re-triggered a set-point).
create or replace function public.get_current_shop_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shop_id uuid;
begin
  select p.current_shop_id
    into v_shop_id
    from public.profiles p
    join public.shop_members m on m.shop_id = p.current_shop_id
    join public.shops s on s.id = p.current_shop_id
   where p.id = auth.uid()
     and m.user_id = auth.uid()
     and m.status = 'active'
     and s.status = 'active';

  if v_shop_id is not null then
    return v_shop_id;
  end if;

  select m.shop_id
    into v_shop_id
    from public.shop_members m
    join public.shops s on s.id = m.shop_id
   where m.user_id = auth.uid()
     and m.status = 'active'
     and s.status = 'active'
   order by (m.role = 'shop_owner') desc, m.created_at, m.shop_id
   limit 1;

  return v_shop_id;
end;
$$;

grant execute on function public.get_current_shop_id() to authenticated;

-- A freshly bootstrapped account's current shop is the shop it just got.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop_id uuid;
  v_shop_name text;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;

  select coalesce(nullif(trim(p.shop_name), ''), 'Mahalla do''koni')
  into v_shop_name
  from public.profiles p
  where p.id = new.id;

  insert into public.shops (owner_user_id, name)
  select new.id, v_shop_name
  where not exists (
    select 1 from public.shops s where s.owner_user_id = new.id
  )
  returning id into v_shop_id;

  if v_shop_id is null then
    select s.id into v_shop_id
    from public.shops s
    where s.owner_user_id = new.id
    order by s.created_at, s.id
    limit 1;
  end if;

  insert into public.shop_members (shop_id, user_id, role, status, invited_by)
  values (v_shop_id, new.id, 'shop_owner', 'active', new.id)
  on conflict (shop_id, user_id) do nothing;

  update public.profiles set current_shop_id = v_shop_id where id = new.id and current_shop_id is null;

  return new;
end;
$$;

alter function public.handle_new_user() set search_path = public;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Accepting an invite is the moment the user is actively switching into that
-- shop -- this is the actual bug fix: make it the current shop.
create or replace function public.activate_invited_memberships(p_shop_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.shop_members
  set status = 'active'
  where user_id = auth.uid()
    and shop_id = p_shop_id
    and status = 'invited';
  get diagnostics v_count = row_count;

  if v_count > 0 then
    update public.profiles set current_shop_id = p_shop_id where id = auth.uid();
  end if;

  return v_count;
end;
$$;

revoke all on function public.activate_invited_memberships(uuid) from public;
grant execute on function public.activate_invited_memberships(uuid) to authenticated;

-- Explicit shop switch for a user who belongs to more than one shop.
create or replace function public.switch_current_shop(p_shop_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
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

grant execute on function public.switch_current_shop(uuid) to authenticated;

-- One-time backfill: give every existing account a current shop so behavior
-- doesn't change for users who already have exactly one shop membership.
update public.profiles p
set current_shop_id = (
  select m.shop_id
  from public.shop_members m
  join public.shops s on s.id = m.shop_id
  where m.user_id = p.id and m.status = 'active' and s.status = 'active'
  order by (m.role = 'shop_owner') desc, m.created_at, m.shop_id
  limit 1
)
where p.current_shop_id is null;
