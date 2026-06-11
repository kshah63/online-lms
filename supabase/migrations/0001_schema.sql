-- ============================================================================
-- 0001_schema.sql — Core schema for the 1-1 Lessons Platform
-- ============================================================================
-- Everything hangs off a `session` (one lesson). All times are stored in UTC
-- (timestamptz) and rendered per-viewer in their own IANA timezone (§2).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- §2 Identity, roles, timezones
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         text not null check (role in ('admin','teacher','student','parent')),
  display_name text not null,
  email        text,
  avatar_url   text,
  timezone     text not null,                 -- IANA, e.g. 'Asia/Singapore', 'America/New_York'
  created_at   timestamptz not null default now()
);

-- A parent can have several children.
create table if not exists parent_student (
  parent_id  uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  primary key (parent_id, student_id)
);

create table if not exists courses (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  subject             text,
  materials_course_id uuid,                    -- maps to a course in the Materials Portal (§6)
  created_at          timestamptz not null default now()
);

create table if not exists enrollments (
  student_id uuid references profiles(id) on delete cascade,
  course_id  uuid references courses(id) on delete cascade,
  primary key (student_id, course_id)
);

-- Who may teach what.
create table if not exists teacher_course (
  teacher_id uuid references profiles(id) on delete cascade,
  course_id  uuid references courses(id) on delete cascade,
  primary key (teacher_id, course_id)
);

-- ---------------------------------------------------------------------------
-- §5 Collaborative notebook (tldraw) — one running notebook per student/course
-- ---------------------------------------------------------------------------
create table if not exists notebooks (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references courses(id) on delete cascade,
  student_id      uuid not null references profiles(id) on delete cascade,
  tldraw_snapshot jsonb,                        -- persisted document; loaded each lesson, saved continuously
  updated_at      timestamptz not null default now(),
  unique (course_id, student_id)                -- one running notebook per student per course
);

-- ---------------------------------------------------------------------------
-- §3 Scheduling & teacher assignment
-- ---------------------------------------------------------------------------
create table if not exists sessions (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references courses(id),
  student_id      uuid not null references profiles(id),
  teacher_id      uuid references profiles(id),         -- null until admin assigns
  scheduled_start timestamptz not null,                 -- UTC
  scheduled_end   timestamptz not null,
  status          text not null default 'scheduled'
                  check (status in ('scheduled','confirmed','in_progress','completed','cancelled','no_show')),
  video_room_id   text,
  recording_url   text,
  notebook_id     uuid references notebooks(id),
  series_id       uuid,                                 -- groups a recurring weekly slot
  agenda          text,                                 -- teacher's lesson agenda / plan
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  check (scheduled_end > scheduled_start)
);
create index if not exists sessions_scheduled_start_idx on sessions (scheduled_start);
create index if not exists sessions_teacher_idx on sessions (teacher_id, scheduled_start);
create index if not exists sessions_student_idx on sessions (student_id, scheduled_start);
create index if not exists sessions_series_idx on sessions (series_id);

create table if not exists teacher_availability (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid references profiles(id) on delete cascade,
  weekday    int not null check (weekday between 0 and 6),  -- 0 = Sunday .. 6 = Saturday
  start_time time not null,
  end_time   time not null,
  timezone   text not null                       -- the teacher's tz; convert to UTC when matching
);
create index if not exists teacher_availability_idx on teacher_availability (teacher_id, weekday);

-- ---------------------------------------------------------------------------
-- §9 Consent & privacy — recording/AI of minors requires recorded consent
-- ---------------------------------------------------------------------------
create table if not exists consents (
  profile_id uuid references profiles(id) on delete cascade,
  type       text not null check (type in ('recording','ai_analysis','teacher_eval')),
  granted_by uuid references profiles(id),       -- parent grants for a child
  granted_at timestamptz not null default now(),
  primary key (profile_id, type)
);

-- ---------------------------------------------------------------------------
-- §7 Transcript pipeline, metrics, live + post-session feedback
-- (schema laid down now; pipeline wired in a later build step)
-- ---------------------------------------------------------------------------
create table if not exists transcripts (
  session_id uuid primary key references sessions(id) on delete cascade,
  segments   jsonb not null default '[]'::jsonb   -- [{speaker:'teacher'|'student', text, start_ms, end_ms}]
);

create table if not exists session_metrics (
  session_id          uuid primary key references sessions(id) on delete cascade,
  teacher_talk_pct    real,
  student_talk_pct    real,
  question_count      int,
  open_question_pct   real,
  avg_wait_ms         int,                        -- silence after a teacher question
  student_turns       int,
  avg_student_turn_ms int,
  praise_count        int,
  computed_at         timestamptz
);

create table if not exists live_events (        -- log of nudges shown during the lesson
  id         uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  ts         timestamptz not null default now(),
  type       text,
  payload    jsonb
);

create table if not exists teacher_feedback (   -- post-session AI coaching
  session_id       uuid primary key references sessions(id) on delete cascade,
  teacher_id       uuid references profiles(id),
  strengths        jsonb,
  suggestions      jsonb,
  dimension_scores jsonb,
  summary          text,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- §8 Reports (teacher → parent/student)
-- ---------------------------------------------------------------------------
create table if not exists reports (
  session_id      uuid primary key references sessions(id) on delete cascade,
  teacher_id      uuid references profiles(id),
  topics_covered  text,
  how_student_did text,
  strengths       text,
  areas_to_work   text,
  homework        text,
  rating          int check (rating between 1 and 5),
  published_at    timestamptz                     -- null = draft; set = visible to parent/student
);

-- ---------------------------------------------------------------------------
-- §10 Billing (Stripe) — lessons modeled as credits
-- ---------------------------------------------------------------------------
create table if not exists credit_balances (
  student_id uuid primary key references profiles(id) on delete cascade,
  balance    int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists credit_ledger (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references profiles(id) on delete cascade,
  delta       int not null,                       -- +topup, -consumed
  reason      text not null,                       -- 'topup','session_consumed','adjustment'
  session_id  uuid references sessions(id) on delete set null,
  stripe_ref  text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- §11 Notifications
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  type        text not null,                       -- 'reminder','reschedule','no_show','report_published'
  title       text not null,
  body        text,
  session_id  uuid references sessions(id) on delete set null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_profile_idx on notifications (profile_id, created_at desc);
