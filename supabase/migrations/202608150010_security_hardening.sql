-- Issue #40: restrict database function execution to the roles that need it.
-- Trigger and event-trigger functions are not API endpoints and must not be
-- callable through PostgREST. RLS helper functions are only needed by signed
-- in users and the application's tenant policies.

revoke all on function public.activate_invited_memberships(uuid) from public, anon, authenticated;
grant execute on function public.activate_invited_memberships(uuid) to authenticated;

revoke all on function public.get_current_shop_id() from public, anon, authenticated;
grant execute on function public.get_current_shop_id() to authenticated;

revoke all on function public.has_shop_permission(uuid, text) from public, anon, authenticated;
grant execute on function public.has_shop_permission(uuid, text) to authenticated;

revoke all on function public.is_platform_admin() from public, anon, authenticated;
grant execute on function public.is_platform_admin() to authenticated;

revoke all on function public.is_shop_member(uuid) from public, anon, authenticated;
grant execute on function public.is_shop_member(uuid) to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;

alter function public.set_updated_at() set search_path = pg_catalog;
