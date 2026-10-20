-- Trach Family: push notification subscriptions
-- Run this script in Supabase Dashboard -> SQL Editor -> New query.
-- This stores one Web Push subscription per browser/device for the signed-in account.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  device_label text not null default 'Trach Family device',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users can view their own push subscriptions"
  on public.push_subscriptions;
create policy "Users can view their own push subscriptions"
  on public.push_subscriptions
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can add their own push subscriptions"
  on public.push_subscriptions;
create policy "Users can add their own push subscriptions"
  on public.push_subscriptions
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own push subscriptions"
  on public.push_subscriptions;
create policy "Users can update their own push subscriptions"
  on public.push_subscriptions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own push subscriptions"
  on public.push_subscriptions;
create policy "Users can delete their own push subscriptions"
  on public.push_subscriptions
  for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.push_subscriptions to authenticated;
