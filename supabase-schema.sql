-- Execute este arquivo uma única vez no SQL Editor do seu projeto Supabase.

create table if not exists public.finance_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint finance_app_state_payload_object
    check (jsonb_typeof(payload) = 'object')
);

alter table public.finance_app_state enable row level security;

revoke all on table public.finance_app_state from anon, authenticated;
grant select, insert, update, delete on table public.finance_app_state to authenticated;

drop policy if exists "finance_state_select_own" on public.finance_app_state;
drop policy if exists "finance_state_insert_own" on public.finance_app_state;
drop policy if exists "finance_state_update_own" on public.finance_app_state;
drop policy if exists "finance_state_delete_own" on public.finance_app_state;

create policy "finance_state_select_own"
on public.finance_app_state
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "finance_state_insert_own"
on public.finance_app_state
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "finance_state_update_own"
on public.finance_app_state
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "finance_state_delete_own"
on public.finance_app_state
for delete
to authenticated
using ((select auth.uid()) = user_id);
