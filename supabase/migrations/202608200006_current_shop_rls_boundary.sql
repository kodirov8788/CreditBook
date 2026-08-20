-- Issue #78: make the persisted current shop the RLS boundary for ordinary users.
-- Platform admins retain their explicit cross-tenant administrative access.

create or replace function public.is_shop_member(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin() or (
    p_shop_id = public.get_current_shop_id()
    and exists (
      select 1
      from public.shop_members m
      join public.shops s on s.id = m.shop_id
      where m.shop_id = p_shop_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and s.status = 'active'
    )
  );
$$;

create or replace function public.has_shop_permission(p_shop_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin() or (
    p_shop_id = public.get_current_shop_id()
    and exists (
      select 1
      from public.shop_members m
      join public.role_permissions rp on rp.role = m.role
      join public.shops s on s.id = m.shop_id
      where m.shop_id = p_shop_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and s.status = 'active'
        and rp.permission = p_permission
    )
  );
$$;

-- Shop switching is an explicit, controlled operation. The list itself is
-- metadata-only and is returned by this security-definer function, while
-- direct table reads remain current-shop scoped.
create or replace function public.list_user_shops()
returns table(id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.name
  from public.shops s
  join public.shop_members m on m.shop_id = s.id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and s.status = 'active'
  order by s.created_at, s.id;
$$;

revoke all on function public.list_user_shops() from public, anon;
grant execute on function public.list_user_shops() to authenticated;

drop policy if exists "Memberships readable by permission" on public.shop_members;
create policy "Memberships readable by permission"
on public.shop_members for select to authenticated
using (
  public.has_shop_permission(shop_id, 'member.read')
  or (user_id = auth.uid() and shop_id = public.get_current_shop_id())
);
