-- Issue #79: invited users must not receive an unrelated owner shop.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop_id uuid;
  v_shop_name text;
  v_invited_shop_id uuid;
  v_invite_shop_value text := new.raw_user_meta_data->>'creditbook_invite_shop_id';
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;

  if v_invite_shop_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_invited_shop_id := v_invite_shop_value::uuid;
  end if;

  if v_invited_shop_id is not null and exists (
    select 1 from public.shops where id = v_invited_shop_id and status = 'active'
  ) then
    update public.profiles
    set current_shop_id = v_invited_shop_id
    where id = new.id and current_shop_id is null;
    return new;
  end if;

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
