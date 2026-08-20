-- Issue #49: keep membership writes server-managed and protect the last owner.

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
