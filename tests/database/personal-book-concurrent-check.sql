select id as race_workspace from public.personal_workspaces where owner_user_id='91000000-0000-4000-8000-000000000003' \gset
select public.pilot_assert((select count(*)=1 from public.personal_books where workspace_id=:'race_workspace'),'parallel initialization creates one book');
select public.pilot_assert((select count(*)=1 from public.personal_accounts where workspace_id=:'race_workspace'),'parallel initialization creates one account');
select public.pilot_assert((select count(*)=1 and sum(amount_minor)=10000 from public.personal_postings where workspace_id=:'race_workspace'),'parallel initialization creates one exact opening');
select public.pilot_assert((select count(*)=1 from creditbook_private.personal_command_receipts where workspace_id=:'race_workspace'),'parallel initialization creates one receipt');
select public.pilot_assert((select count(*)=1 from public.personal_audit_events where workspace_id=:'race_workspace'),'parallel initialization creates one audit');
select id as distinct_workspace from public.personal_workspaces where owner_user_id='91000000-0000-4000-8000-000000000005' \gset
select public.pilot_assert((select count(*)=1 from public.personal_books where workspace_id=:'distinct_workspace'),'different parallel keys still create one book');
select public.pilot_assert((select count(*)=1 from public.personal_accounts where workspace_id=:'distinct_workspace'),'different parallel keys create one account');
select public.pilot_assert((select count(*)=1 and sum(amount_minor)=0 from public.personal_postings where workspace_id=:'distinct_workspace'),'different parallel keys create one zero opening');
