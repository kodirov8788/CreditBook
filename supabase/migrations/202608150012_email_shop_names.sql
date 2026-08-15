-- Make default shop names distinguishable in platform administration.
-- User-selected names remain unchanged; only legacy placeholders are updated.

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

  select case
    when trim(coalesce(p.shop_name, '')) in ('', 'My shop', 'Mahalla do''koni')
      then 'My shop — ' || coalesce(nullif(trim(new.email), ''), 'user-' || left(new.id::text, 8))
    else trim(p.shop_name)
  end
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

  return new;
end;
$$;

alter function public.handle_new_user() set search_path = public;
revoke all on function public.handle_new_user() from public, anon, authenticated;

update public.shops s
set name = 'My shop — ' || lower(trim(u.email))
from auth.users u
where s.owner_user_id = u.id
  and lower(trim(s.name)) in ('my shop', 'mahalla do''koni')
  and nullif(trim(u.email), '') is not null;
