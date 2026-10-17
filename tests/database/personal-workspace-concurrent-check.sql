select public.g01_assert((select count(*) = 1 from public.personal_workspaces
  where owner_user_id='00000000-0000-4000-8000-000000000004'),
  'concurrent first use creates exactly one workspace');
