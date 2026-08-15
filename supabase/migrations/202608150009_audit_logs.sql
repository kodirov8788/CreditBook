-- Issue #38: keep an append-only platform audit trail for privileged changes.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  shop_id uuid references public.shops(id) on delete set null,
  entity_type text not null check (entity_type in ('user', 'shop', 'membership')),
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_user_id, created_at desc);
create index if not exists audit_logs_shop_idx on public.audit_logs(shop_id, created_at desc);

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Audit yozuvini o‘zgartirish yoki o‘chirish mumkin emas.' using errcode = '42501';
end;
$$;

drop trigger if exists audit_logs_append_only on public.audit_logs;
create trigger audit_logs_append_only
before update or delete on public.audit_logs
for each row execute function public.prevent_audit_mutation();

alter table public.audit_logs enable row level security;

drop policy if exists "Platform admins can read audit logs" on public.audit_logs;
create policy "Platform admins can read audit logs"
on public.audit_logs for select to authenticated
using (public.is_platform_admin());

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;
