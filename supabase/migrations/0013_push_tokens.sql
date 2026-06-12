-- ============================================================================
-- 0013_push_tokens.sql — Expo push notification tokens for the mobile app
-- ----------------------------------------------------------------------------
-- The native companion app (mobile/) registers each device's Expo push token
-- here; the notify dispatcher sends to them alongside WhatsApp. A user manages
-- only their own tokens (RLS), and the web server reads them via service role.
-- ============================================================================

create table if not exists push_tokens (
  token      text primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  platform   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_profile_idx on push_tokens (profile_id);

alter table push_tokens enable row level security;

drop policy if exists push_tokens_owner on push_tokens;
create policy push_tokens_owner on push_tokens
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

notify pgrst, 'reload schema';
