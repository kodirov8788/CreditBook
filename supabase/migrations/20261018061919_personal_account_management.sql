begin;
alter table creditbook_private.personal_command_receipts drop constraint personal_command_receipts_operation_check;
alter table creditbook_private.personal_command_receipts add constraint personal_command_receipts_operation_check
 check(operation in ('account.create.v1','account.manage.v1'));
alter table public.personal_audit_events drop constraint personal_audit_events_event_type_check;
alter table public.personal_audit_events add constraint personal_audit_events_event_type_check
 check(event_type in ('account.created','account.updated','account.archived','account.unarchived','account.default_changed'));

create function creditbook_private.manage_personal_account(p_command jsonb,p_client_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; target uuid; op text; a public.personal_accounts; pref public.personal_workspace_preferences;
 receipt creditbook_private.personal_command_receipts; fingerprint bytea; command_id uuid:=gen_random_uuid(); result jsonb; event_name text;
begin
 if not creditbook_private.is_current_account_active() then raise exception 'Access denied' using errcode='42501'; end if;
 select id into w from public.personal_workspaces where owner_user_id=auth.uid() and status='active' for update;
 if w is null or not creditbook_private.is_current_account_active() then raise exception 'Access denied' using errcode='42501'; end if;
 if p_client_key is null or p_client_key::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  or p_command is null or jsonb_typeof(p_command) is distinct from 'object' or octet_length(p_command::text)>4096 then
  raise exception 'Invalid command' using errcode='22023';
 end if;
 op:=p_command->>'operation';
 if op is null or op not in ('update','archive','unarchive','default')
  or jsonb_typeof(p_command->'accountId') is distinct from 'string'
  or (p_command->>'accountId') !~ '^[0-9a-f-]{36}$'
  or jsonb_typeof(p_command->'accountVersion') is distinct from 'number'
  or (p_command->>'accountVersion') !~ '^[1-9][0-9]{0,8}$'
  or jsonb_typeof(p_command->'preferencesVersion') is distinct from 'number'
  or (p_command->>'preferencesVersion') !~ '^[1-9][0-9]{0,8}$'
  or exists(select 1 from jsonb_object_keys(p_command) k where k not in ('operation','accountId','accountVersion','preferencesVersion','name','icon','color','includeInTotal')) then
  raise exception 'Invalid fields' using errcode='22023';
 end if;
 begin target:=(p_command->>'accountId')::uuid;
 exception when invalid_text_representation then raise exception 'Invalid account' using errcode='22023'; end;
 fingerprint:=pg_catalog.sha256(pg_catalog.convert_to(p_command::text,'UTF8'));
 select * into receipt from creditbook_private.personal_command_receipts r where r.workspace_id=w
  and r.actor_id=auth.uid() and r.operation='account.manage.v1' and r.client_key=p_client_key;
 if found then
  if receipt.fingerprint<>fingerprint then raise exception 'Key conflict' using errcode='23505'; end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 select * into a from public.personal_accounts where id=target and workspace_id=w for update;
 if not found then raise exception 'Access denied' using errcode='42501'; end if;
 select * into pref from public.personal_workspace_preferences where workspace_id=w for update;
 if a.version<>(p_command->>'accountVersion')::integer or pref.version<>(p_command->>'preferencesVersion')::integer then
  raise exception 'Stale version' using errcode='23505';
 end if;
 if op<>'update' and (p_command ?| array['name','icon','color','includeInTotal']) then raise exception 'Unexpected fields' using errcode='22023'; end if;
 if op='update' then
  if a.status<>'active' or not (p_command ?| array['name','icon','color','includeInTotal']) then raise exception 'Unarchive first' using errcode='22023'; end if;
  if (p_command ? 'name' and (jsonb_typeof(p_command->'name') is distinct from 'string' or char_length(btrim(p_command->>'name')) not between 2 and 80 or p_command->>'name' ~ '[[:cntrl:]]'))
   or (p_command ? 'icon' and (jsonb_typeof(p_command->'icon') is distinct from 'string' or p_command->>'icon' not in ('cash','card','bank','wallet')))
   or (p_command ? 'color' and (jsonb_typeof(p_command->'color') is distinct from 'string' or p_command->>'color' !~ '^#[0-9A-Fa-f]{6}$'))
   or (p_command ? 'includeInTotal' and jsonb_typeof(p_command->'includeInTotal') is distinct from 'boolean') then raise exception 'Invalid appearance' using errcode='22023'; end if;
  update public.personal_accounts set name=coalesce(btrim(p_command->>'name'),name),icon=coalesce(p_command->>'icon',icon),
   color=coalesce(upper(p_command->>'color'),color),include_in_total=coalesce((p_command->>'includeInTotal')::boolean,include_in_total),version=version+1 where id=target;
  event_name:='account.updated';
 elsif op='archive' then
  if a.status<>'active' then raise exception 'Already archived' using errcode='22023'; end if;
  update public.personal_accounts set status='archived',version=version+1 where id=target;
  if pref.default_account_id=target then
   update public.personal_workspace_preferences set default_account_id=(select id from public.personal_accounts where workspace_id=w and status='active' order by created_at,id limit 1),version=version+1 where workspace_id=w;
  end if;
  event_name:='account.archived';
 elsif op='unarchive' then
  if a.status<>'archived' then raise exception 'Already active' using errcode='22023'; end if;
  update public.personal_accounts set status='active',version=version+1 where id=target;
  update public.personal_workspace_preferences set default_account_id=target,version=version+1 where workspace_id=w and default_account_id is null;
  event_name:='account.unarchived';
 else
  if a.status<>'active' then raise exception 'Archived default denied' using errcode='22023'; end if;
  update public.personal_workspace_preferences set default_account_id=target,version=version+1 where workspace_id=w;
  update public.personal_accounts set version=version+1 where id=target;
  event_name:='account.default_changed';
 end if;
 select jsonb_build_object('accountId',target,'accountVersion',version,'preferencesVersion',(select version from public.personal_workspace_preferences where workspace_id=w),'commandId',command_id)
  into result from public.personal_accounts where id=target;
 insert into creditbook_private.personal_command_receipts(id,workspace_id,actor_id,operation,client_key,fingerprint,result)
  values(command_id,w,auth.uid(),'account.manage.v1',p_client_key,fingerprint,result);
 insert into public.personal_audit_events(workspace_id,account_id,actor_id,command_id,event_type) values(w,target,auth.uid(),command_id,event_name);
 return result||jsonb_build_object('replayed',false);
end;
$$;
revoke all on function creditbook_private.manage_personal_account(jsonb,uuid) from public,anon,authenticated;
grant execute on function creditbook_private.manage_personal_account(jsonb,uuid) to authenticated;
create function public.manage_personal_account(p_command jsonb,p_client_key uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select creditbook_private.manage_personal_account(p_command,p_client_key);
$$;
revoke all on function public.manage_personal_account(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.manage_personal_account(jsonb,uuid) to authenticated;
commit;
