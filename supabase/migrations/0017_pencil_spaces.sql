-- ============================================================================
-- 0017_pencil_spaces.sql — Pencil Spaces integration, Phase 1 foundation
-- ----------------------------------------------------------------------------
-- The live lesson moves into one persistent Pencil Space per (student, course).
-- Pencil identity, the recording opt-out flag, Spaces, the per-Pencil-session
-- state machine, the webhook ledger and the job queue all live in SERVICE-ONLY
-- tables: written by the service role after an explicit authorization check in
-- app code (RLS does not protect the admin client), readable by admins only.
-- Later phases (0018 post-session pipeline, 0019 homework) are additive.
--
-- Helpers referenced below all exist already:
--   public.is_admin()              0002_functions_triggers.sql
--   public.current_profile_role()  0002_functions_triggers.sql
--   public.touch_updated_at()      0002_functions_triggers.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Close the pre-existing profiles self-update hole. The 0003 policy had no
--    WITH CHECK and no column guard, so any signed-in user could rewrite their
--    own row (including role/email). Now load-bearing for every new policy.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.current_profile_role();   -- null for service role
begin
  if r is not null and r <> 'admin'
     and (new.role, new.email) is distinct from (old.role, old.email) then
    raise exception 'only admins may change role or email';
  end if;
  return new;
end $$;
drop trigger if exists on_profile_guard on public.profiles;
create trigger on_profile_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- 1b. The Pencil outage fallback (owner decision 5) is ONE master Zoom link in
--     the server env (LESSON_FALLBACK_URL) plus sessions.fallback_join_url (§5)
--     as the admin's per-lesson override. Nothing is stored per teacher, so
--     profiles gains no column here.

-- 1c. Close the signup half of the same hole: 0002's handle_new_user() copied
--     `role` from raw_user_meta_data, which whoever calls GoTrue /signup with
--     the public anon key controls (`options.data.role = 'admin'`). Every new
--     auth user now starts as a 'student'; the real role is set by the service
--     role right after admin.auth.admin.createUser (src/lib/actions/accounts.ts),
--     which guard_profile_update allows because current_profile_role() is null
--     there. Self-signup must ALSO be disabled in Auth settings (README checklist).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_name, email, timezone)
  values (
    new.id,
    'student',                                   -- never from user-controlled metadata
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'timezone', 'UTC')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 1d. rl_check (0011) takes the bucket name AND the limits from its caller and
--     was granted to anon/authenticated, so anyone holding the public anon key
--     could exhaust another user's bucket (e.g. `pencil:join:<teacher id>` with
--     p_limit 1) and lock them out of their lessons. The app only calls it with
--     the service role (src/lib/rate-limit.ts), so take it away from everyone
--     else — including PUBLIC, which functions get EXECUTE from by default.
revoke execute on function public.rl_check(text, int, int) from public, anon, authenticated;
grant execute on function public.rl_check(text, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Pencil identity: service-role writes, admin-only reads (staff Pencil ids
--    are not public). externalId on the Pencil side = profiles.id.
-- ---------------------------------------------------------------------------
create table if not exists public.pencil_users (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  pencil_user_id text not null unique,
  pencil_email   text,
  pencil_name    text,                       -- what we sent: first name (students) / display_name (staff)
  created_at     timestamptz not null default now()
);
alter table public.pencil_users enable row level security;
drop policy if exists pencil_users_admin_read on public.pencil_users;
create policy pencil_users_admin_read on public.pencil_users
  for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Recording policy = OPT-OUT: presence of a row means "do not record".
--    Written only by setRecordingOptOut (admin) via the service role.
-- ---------------------------------------------------------------------------
create table if not exists public.recording_opt_outs (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  set_by     uuid references public.profiles(id),
  set_at     timestamptz not null default now(),
  note       text
);
alter table public.recording_opt_outs enable row level security;
drop policy if exists recording_opt_outs_admin_read on public.recording_opt_outs;
create policy recording_opt_outs_admin_read on public.recording_opt_outs
  for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. One persistent Space per (student, course). `pencil_space_id` always holds
--    Pencil's 24-hex id; our uuid FK elsewhere is `space_id`. status='mock'
--    rows (no Pencil id) are what demo/seed data and the no-key path use.
-- ---------------------------------------------------------------------------
create table if not exists public.pencil_spaces (
  id                      uuid primary key default gen_random_uuid(),
  student_id              uuid not null references public.profiles(id) on delete cascade,
  course_id               uuid not null references public.courses(id) on delete cascade,
  external_id             text not null unique,          -- '<course_id>:<student_id>'
  pencil_space_id         text unique,                   -- Pencil id; null only when status='mock'
  link                    text,                          -- spaces/create .link
  title                   text,
  host_profile_ids        uuid[] not null default '{}',
  participant_profile_ids uuid[] not null default '{}',
  hosts_synced_at         timestamptz,
  recording_disabled      boolean not null default false, -- written only after a confirmed read-back
  recording_verified_at   timestamptz,
  status                  text not null default 'active' check (status in ('active','archived','mock')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (student_id, course_id)
);
alter table public.pencil_spaces enable row level security;
drop policy if exists pencil_spaces_admin_read on public.pencil_spaces;
create policy pencil_spaces_admin_read on public.pencil_spaces
  for select using (public.is_admin());
-- app code reads Spaces with the admin client after its own authorization check
drop trigger if exists on_pencil_spaces_touch on public.pencil_spaces;
create trigger on_pencil_spaces_touch before update on public.pencil_spaces
  for each row execute function public.touch_updated_at();
-- Per-pair provisioning lease: the first lesson of a course is exactly when
-- teacher and student POST /space at the same moment. ensureSpace() claims the
-- row (placeholder insert, or compare-and-swap on this column) before any
-- Pencil call; the loser waits for the winner's row instead of creating
-- duplicate users/Spaces. A crashed winner's lease simply expires.
alter table public.pencil_spaces add column if not exists provision_lock_until timestamptz;

-- ---------------------------------------------------------------------------
-- 5. Sessions: Space actually used, Pencil session id (NOT unique: a forgotten
--    End can span lessons), analysis state (non-sensitive), outage fallback.
-- ---------------------------------------------------------------------------
alter table public.sessions add column if not exists space_id          uuid references public.pencil_spaces(id) on delete set null;
alter table public.sessions add column if not exists pencil_session_id text;
alter table public.sessions add column if not exists analysis_status   text not null default 'none'
  check (analysis_status in ('none','pending','done','skipped_opt_out','no_recording','failed'));
alter table public.sessions add column if not exists fallback_join_url text;
create index if not exists sessions_pencil_session_idx on public.sessions (pencil_session_id) where pencil_session_id is not null;
-- NOTE: on_session_attach_notebook stays until 0019 (homework canvas keeps working through Phases 1-2)

-- 5b. Column guard for the teacher's own-session UPDATE (0003
--     sessions_teacher_update pins only teacher_id). Phase 1 makes student_id /
--     course_id load-bearing for Pencil access: a teacher re-pointing their
--     session at another student would pass canJoinLesson/canHostSpace and get
--     a host seat in that child's persistent Space. A teacher (any non-admin
--     JWT) may only touch what the lesson room writes: the clock
--     (actual_start/actual_end), the agenda, status along the live path
--     (scheduled|confirmed|in_progress -> in_progress|completed|no_show — never
--     back, so the credit trigger cannot be replayed), and analysis_status
--     'none' -> 'no_recording' (End during the Zoom fallback). Everything else,
--     including columns added later, is admin / service-role only.
create or replace function public.guard_session_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r       text := public.current_profile_role();   -- null for service role / migrations / seed
  allowed text[] := array['status','actual_start','actual_end','agenda','analysis_status'];
begin
  if r is null or r = 'admin' then
    return new;
  end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'only admins may change this lesson''s student, course, teacher, time or links'
      using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not (old.status in ('scheduled','confirmed','in_progress')
              and new.status in ('in_progress','completed','no_show')) then
    raise exception 'lesson status cannot move from % to %', old.status, new.status
      using errcode = '42501';
  end if;
  if new.analysis_status is distinct from old.analysis_status
     and not (old.analysis_status = 'none' and new.analysis_status = 'no_recording') then
    raise exception 'analysis_status is owned by the post-session pipeline'
      using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists on_session_guard on public.sessions;
create trigger on_session_guard before update on public.sessions
  for each row execute function public.guard_session_update();

-- ---------------------------------------------------------------------------
-- 6. Per-Pencil-session state machine (driven by webhooks/jobs from Phase 2;
--    Phase 1 only writes hint rows from the End button).
-- ---------------------------------------------------------------------------
create table if not exists public.pencil_sessions (
  pencil_session_id    text primary key,
  pencil_space_id      text not null,
  space_id             uuid references public.pencil_spaces(id) on delete set null,
  hint_session_id      uuid references public.sessions(id) on delete set null,  -- from End button / joinSpace, unverified
  session_id           uuid references public.sessions(id) on delete set null,  -- verified by analytics; null = unmatched
  taught_by_profile_id uuid references public.profiles(id),
  teacher_present      boolean,
  student_present      boolean,
  started_at           timestamptz,
  ended_at             timestamptz,
  recording_id         text,
  state                text not null default 'live' check (state in
    ('live','ended','analytics_done','awaiting_transcript','transcript_done','done',
     'skipped_opt_out','no_recording','no_show','unmatched','failed')),
  analytics            jsonb,
  analytics_at         timestamptz,
  recording_at         timestamptz,
  transcript_at        timestamptz,
  claude_at            timestamptz,
  coach_report_at      timestamptz,
  safeguarding         jsonb,
  attempts             int not null default 0,
  last_error           text,
  next_poll_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists pencil_sessions_session_idx on public.pencil_sessions (session_id);
create index if not exists pencil_sessions_poll_idx on public.pencil_sessions (next_poll_at) where next_poll_at is not null;
alter table public.pencil_sessions enable row level security;
drop policy if exists pencil_sessions_admin_read on public.pencil_sessions;
create policy pencil_sessions_admin_read on public.pencil_sessions
  for select using (public.is_admin());
drop trigger if exists on_pencil_sessions_touch on public.pencil_sessions;
create trigger on_pencil_sessions_touch before update on public.pencil_sessions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Webhook ledger (idempotency + replay) and job queue; service-role only.
-- ---------------------------------------------------------------------------
create table if not exists public.pencil_webhook_events (
  id                uuid primary key default gen_random_uuid(),
  delivery_key      text not null unique,   -- `${_type}:${eventType}:${sessionId|recordingId|eventId}:${timestamp}`
  event_group       text,
  event_type        text not null,
  pencil_space_id   text,                   -- Pencil's id (our uuid FK is always `space_id`)
  pencil_session_id text,
  recording_id      text,
  payload           jsonb not null,         -- never contains the Authorization header
  status            text not null default 'received' check (status in ('received','queued','processed','ignored','failed')),
  error             text,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz
);
-- An earlier draft of this migration named the column `space_id`; keep re-runs convergent.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'pencil_webhook_events' and column_name = 'space_id') then
    alter table public.pencil_webhook_events rename column space_id to pencil_space_id;
  end if;
end $$;
alter table public.pencil_webhook_events enable row level security;
drop policy if exists pencil_webhook_events_admin_read on public.pencil_webhook_events;
create policy pencil_webhook_events_admin_read on public.pencil_webhook_events
  for select using (public.is_admin());

create table if not exists public.pencil_jobs (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('ingest_session','ingest_recording','ingest_transcript',
                      'run_claude','ingest_coach_report','apply_space_settings','delete_recording','reconcile','retention')),
  pencil_session_id text,
  recording_id      text,
  pencil_space_id   text,
  session_id        uuid references public.sessions(id) on delete cascade,
  dedupe_key        text unique,          -- e.g. 'ingest_session:<pencilSessionId>'
  state             text not null default 'queued' check (state in ('queued','running','done','failed','dead')),
  attempts          int not null default 0,
  run_after         timestamptz not null default now(),
  locked_at         timestamptz,
  last_error        text,
  created_at        timestamptz not null default now()
);
create index if not exists pencil_jobs_due_idx on public.pencil_jobs (run_after) where state = 'queued';
alter table public.pencil_jobs enable row level security;   -- no policies: service role only

notify pgrst, 'reload schema';
