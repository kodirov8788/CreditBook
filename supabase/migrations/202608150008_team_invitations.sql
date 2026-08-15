-- Issue #37: activate the invited shop membership after a Supabase Auth invite.

drop function if exists public.activate_invited_memberships();

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
  return v_count;
end;
$$;

revoke all on function public.activate_invited_memberships(uuid) from public;
grant execute on function public.activate_invited_memberships(uuid) to authenticated;
