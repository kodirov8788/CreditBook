\echo 'Checking legacy preservation and signup isolation'
create function public.g01_assert(ok boolean, label text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end; $$;
create function public.g01_denied(statement text, label text) returns void
language plpgsql security invoker as $$ begin
  begin
    execute statement;
  exception when insufficient_privilege then
    raise notice 'PASS: %', label;
    return;
  end;
  raise exception 'FAIL (not denied): %', label;
end; $$;

select public.g01_assert(not exists (
  (select id, owner_user_id, name, status from public.shops except select * from public.g01_legacy_snapshot)
  union all
  (select * from public.g01_legacy_snapshot except select id, owner_user_id, name, status from public.shops)
), 'legacy shops unchanged');
select public.g01_assert(not exists (
  (select * from public.shop_members except select * from public.g01_membership_snapshot)
  union all
  (select * from public.g01_membership_snapshot except select * from public.shop_members)
), 'exact legacy membership and pending-invite rows preserved');
select public.g01_assert(not exists (
  (select id, current_shop_id from public.profiles except select * from public.g01_current_shop_snapshot)
  union all
  (select * from public.g01_current_shop_snapshot except select id, current_shop_id from public.profiles)
), 'exact legacy current-shop selections preserved');
select public.g01_assert((select records = jsonb_build_object(
  'customers', (select jsonb_agg(to_jsonb(t) order by t.id) from public.customers t),
  'debts', (select jsonb_agg(to_jsonb(t) order by t.id) from public.debts t),
  'payments', (select jsonb_agg(to_jsonb(t) order by t.id) from public.payments t),
  'expenses', (select jsonb_agg(to_jsonb(t) order by t.id) from public.expenses t)
) from public.g01_finance_snapshot), 'legacy financial records unchanged');
select public.g01_assert((select count(*) = 0 from public.personal_workspaces), 'migration does not fabricate existing-user workspaces');

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000002', 'personal@example.test', '{"role":"platform_owner","shop_id":"00000000-0000-4000-8000-000000000001"}'),
  ('00000000-0000-4000-8000-000000000003', 'admin@example.test', '{}'),
  ('00000000-0000-4000-8000-000000000004', 'invite@example.test', '{}');
select public.g01_assert((select count(*) = 3 from public.personal_workspaces), 'new signups get one personal workspace');
select public.g01_assert((select count(*) = 1 from public.shops), 'new signups create no shop');
select public.g01_assert((select count(*) = 2 from public.shop_members), 'new signups create no membership');
select public.g01_assert((select count(*) = 0 from public.platform_roles), 'metadata creates no platform authority');
insert into public.platform_roles (user_id, role) values ('00000000-0000-4000-8000-000000000003', 'platform_owner');
insert into auth.users (id, email, is_anonymous) values
  ('00000000-0000-4000-8000-000000000006', 'anonymous@example.test', true);
insert into auth.users (id, email, banned_until) values
  ('00000000-0000-4000-8000-000000000007', 'banned@example.test', now() + interval '1 day');
select public.g01_assert((select count(*) = 0 from public.personal_workspaces
  where owner_user_id='00000000-0000-4000-8000-000000000006'), 'initial anonymous signup does not provision');
select public.g01_assert((select count(*) = 0 from public.personal_workspaces
  where owner_user_id='00000000-0000-4000-8000-000000000007'), 'initial banned signup does not provision');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
select public.g01_assert((select count(*) = 1 from public.personal_workspaces), 'owner sees only own workspace');
select public.g01_assert((select count(*) = 0 from public.personal_workspaces where owner_user_id = '00000000-0000-4000-8000-000000000003'), 'foreign workspace invisible');
select public.ensure_my_personal_workspace();
select public.ensure_my_personal_workspace();
select public.g01_assert((select count(*) = 1 from public.personal_workspaces), 'repeated provisioning is idempotent');
select public.g01_denied($q$insert into public.personal_workspaces(owner_user_id) values ('00000000-0000-4000-8000-000000000001')$q$, 'cannot provision for another user');
select public.g01_denied($q$insert into public.personal_workspaces(owner_user_id,status) values ('00000000-0000-4000-8000-000000000002','active')$q$, 'cannot supply protected status column');
select public.g01_denied($q$update public.personal_workspaces set name='Changed'$q$, 'authenticated cannot update workspace');
select public.g01_denied($q$delete from public.personal_workspaces$q$, 'authenticated cannot delete workspace');
select public.g01_assert(public.get_current_shop_id() is null, 'personal signup has no active shop');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', false);
select public.g01_assert((select count(*) = 1 from public.personal_workspaces), 'platform owner has no blanket personal-data access');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
select public.ensure_my_personal_workspace();
select public.ensure_my_personal_workspace();
select public.g01_assert(public.get_current_shop_id() is not null, 'legacy owner retains shop resolution');
reset role;
select public.g01_assert((select count(*) = 1 from public.personal_workspaces where owner_user_id='00000000-0000-4000-8000-000000000001'), 'existing user lazy provisioning creates exactly one workspace');

update auth.users set banned_until = now() + interval '1 day' where id='00000000-0000-4000-8000-000000000002';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
select public.g01_assert((select count(*) = 0 from public.personal_workspaces), 'banned account cannot read existing workspace');
select public.g01_denied('select public.ensure_my_personal_workspace()', 'banned account cannot provision');
reset role;
update auth.users set banned_until = now() - interval '1 day' where id='00000000-0000-4000-8000-000000000002';
set role authenticated;
select public.g01_assert((select count(*) = 1 from public.personal_workspaces), 'expired ban restores access');
reset role;
update auth.users set is_anonymous=true, banned_until=null where id='00000000-0000-4000-8000-000000000002';
set role authenticated;
select public.g01_assert((select count(*) = 0 from public.personal_workspaces), 'anonymous auth account denied');
select public.g01_denied('select public.ensure_my_personal_workspace()', 'anonymous auth account cannot provision');
select set_config('request.jwt.claim.sub', '', false);
select public.g01_denied('select public.ensure_my_personal_workspace()', 'missing authenticated identity denied');
reset role;
update auth.users set is_anonymous=false where id='00000000-0000-4000-8000-000000000002';
update public.personal_workspaces set status='suspended' where owner_user_id='00000000-0000-4000-8000-000000000002';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
select public.g01_assert((select count(*) = 0 from public.personal_workspaces), 'suspended workspace hidden');
select public.g01_denied('select public.ensure_my_personal_workspace()', 'provisioning cannot reactivate suspended workspace');
reset role;

set role anon;
select public.g01_denied('select * from public.personal_workspaces', 'anon cannot read workspaces');
select public.g01_denied('select public.ensure_my_personal_workspace()', 'anon cannot call provisioning');
reset role;
set role service_role;
select public.g01_denied($q$update public.personal_workspaces set owner_user_id='00000000-0000-4000-8000-000000000009' where owner_user_id='00000000-0000-4000-8000-000000000002'$q$, 'ownership immutable even for service role');
reset role;

\echo 'Checking existing invite activation remains explicit'
insert into public.shop_members (shop_id, user_id, role, status)
select id, '00000000-0000-4000-8000-000000000004', 'viewer', 'invited' from public.shops limit 1;
select id as legacy_shop_id from public.shops limit 1 \gset
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', false);
select public.g01_assert(public.get_current_shop_id() is null, 'pending invite is not shop access');
select public.g01_assert(public.activate_invited_memberships(:'legacy_shop_id') = 1, 'valid invitation activates existing membership');
select public.g01_assert(public.get_current_shop_id() = :'legacy_shop_id'::uuid, 'activated invite resolves shop');
select public.g01_assert(public.activate_invited_memberships(:'legacy_shop_id') = 0, 'replayed invitation changes no membership');
select public.g01_assert(public.get_current_shop_id() = :'legacy_shop_id'::uuid, 'replayed invitation keeps current shop');
reset role;
select public.g01_assert((select count(*) = 1 from public.shops), 'invitation did not create another shop');

-- Test rejected invitation states without modifying the existing RPC contract.
create function public.g01_invite_rejected(shop uuid) returns boolean language plpgsql as $$
begin
  perform public.activate_invited_memberships(shop);
  return false;
exception when no_data_found then return true;
end; $$;
update public.shop_members set status='cancelled' where user_id='00000000-0000-4000-8000-000000000004';
set role authenticated;
select public.g01_assert(public.g01_invite_rejected(:'legacy_shop_id'), 'cancelled invitation cannot activate');
select public.g01_assert(public.get_current_shop_id() is null, 'cancelled membership grants no shop access');
reset role;
update public.shop_members set status='suspended' where user_id='00000000-0000-4000-8000-000000000004';
set role authenticated;
select public.g01_assert(public.g01_invite_rejected(:'legacy_shop_id'), 'suspended membership cannot activate');
reset role;
update public.shop_members set status='invited' where user_id='00000000-0000-4000-8000-000000000004';
update public.shops set status='suspended' where id=:'legacy_shop_id';
set role authenticated;
select public.g01_assert(public.g01_invite_rejected(:'legacy_shop_id'), 'invitation cannot activate a suspended shop');
select public.g01_assert(public.get_current_shop_id() is null, 'suspended shop grants no access');
reset role;
select public.g01_assert((select status='invited' from public.shop_members where user_id='00000000-0000-4000-8000-000000000004'), 'failed activation preserves pending invitation');
update public.shops set status='active' where id=:'legacy_shop_id';
-- Remove only a synthetic fixture workspace to race its lazy first creation.
delete from public.personal_workspaces where owner_user_id='00000000-0000-4000-8000-000000000004';
