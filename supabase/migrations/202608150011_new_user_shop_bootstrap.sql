-- Give every newly registered account its own starter shop and membership.
-- The RBAC backfill handled accounts that existed before the multi-tenant
-- rollout; this keeps future signups usable without manual database work.

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

  return new;
end;
$$;

alter function public.handle_new_user() set search_path = public;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Repair accounts created after the original RBAC backfill.
insert into public.shops (owner_user_id, name)
select
  u.id,
  coalesce(nullif(trim(p.shop_name), ''), 'Mahalla do''koni')
from auth.users u
left join public.profiles p on p.id = u.id
where not exists (
  select 1 from public.shops s where s.owner_user_id = u.id
);

insert into public.shop_members (shop_id, user_id, role, status, invited_by)
select s.id, s.owner_user_id, 'shop_owner', 'active', s.owner_user_id
from public.shops s
where not exists (
  select 1
  from public.shop_members m
  where m.shop_id = s.id
    and m.user_id = s.owner_user_id
);
