-- Taxi Manager: scheduled push reminders
-- 1) Run this file once in Supabase Dashboard -> SQL Editor.
-- 2) Before running, replace PASTE_THE_SAME_LONG_RANDOM_SECRET_HERE below with a
--    long random secret. Then add that exact value as the Edge Function secret
--    REMINDER_CRON_SECRET in Supabase Dashboard -> Edge Functions -> Secrets.
-- 3) Deploy supabase/functions/process-reminders/index.ts as an Edge Function
--    named process-reminders, with JWT verification disabled. The endpoint is
--    protected by the private REMINDER_CRON_SECRET header configured below.
--
-- Existing push_subscriptions and VAPID secrets are reused.

create table if not exists public.scheduled_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 300),
  remind_at timestamptz not null,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists scheduled_reminders_due_idx
  on public.scheduled_reminders (remind_at)
  where sent_at is null;

create index if not exists scheduled_reminders_user_id_idx
  on public.scheduled_reminders (user_id, remind_at);

alter table public.scheduled_reminders enable row level security;

drop policy if exists "Users can view their own scheduled reminders"
  on public.scheduled_reminders;
create policy "Users can view their own scheduled reminders"
  on public.scheduled_reminders for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own scheduled reminders"
  on public.scheduled_reminders;
create policy "Users can create their own scheduled reminders"
  on public.scheduled_reminders for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can cancel their own unsent reminders"
  on public.scheduled_reminders;
create policy "Users can cancel their own unsent reminders"
  on public.scheduled_reminders for delete to authenticated
  using (auth.uid() = user_id and sent_at is null);

grant select, insert, delete on public.scheduled_reminders to authenticated;

-- Enable Supabase's built-in scheduler and HTTP extension.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Store the project URL and shared cron secret in Supabase Vault, not in public GitHub.
select vault.create_secret(
  'https://evrxgxhralvxckpjoclj.supabase.co',
  'taxi_manager_project_url',
  'Taxi Manager Supabase project URL'
);
select vault.create_secret(
  'PASTE_THE_SAME_LONG_RANDOM_SECRET_HERE',
  'taxi_manager_reminder_cron_secret',
  'Shared secret for the process-reminders Edge Function'
);

-- Avoid creating duplicate jobs if this scheduling section is rerun.
select cron.unschedule(jobid)
from cron.job
where jobname = 'taxi-manager-send-reminders';

select cron.schedule(
  'taxi-manager-send-reminders',
  '* * * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'taxi_manager_project_url'
        order by created_at desc
        limit 1
      ) || '/functions/v1/process-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-reminder-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'taxi_manager_reminder_cron_secret'
          order by created_at desc
          limit 1
        )
      ),
      body := '{}'::jsonb
    );
  $job$
);
