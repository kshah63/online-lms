-- ============================================================================
-- 0004_reports_followups_homework.sql
--   - reports: teacher notes + AI-draft provenance + follow-up flag (§8)
--   - homework: per-lesson assignment with completion tracking
--   - followups: action items (attendance gaps, no-shows, report flags, overdue HW)
--   - outbound_messages: log of parent comms (WhatsApp/email)
--   - profiles.phone for messaging
-- ============================================================================

alter table profiles add column if not exists phone text;

-- §8 Reports: capture the teacher's quick notes and whether AI drafted it,
-- plus a follow-up flag the teacher can raise for the admin.
alter table reports add column if not exists teacher_notes  text;
alter table reports add column if not exists ai_drafted     boolean not null default false;
alter table reports add column if not exists needs_followup boolean not null default false;
alter table reports add column if not exists followup_reason text;

-- ---------------------------------------------------------------------------
-- Homework — one assignment per lesson, tracked to completion.
-- ---------------------------------------------------------------------------
create table if not exists homework (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid references sessions(id) on delete cascade,
  student_id  uuid not null references profiles(id) on delete cascade,
  course_id   uuid references courses(id),
  description text not null,
  assigned_at timestamptz not null default now(),
  due_at      timestamptz,
  status      text not null default 'assigned' check (status in ('assigned','completed','incomplete')),
  completed_at timestamptz,
  marked_by   uuid references profiles(id),
  updated_at  timestamptz not null default now()
);
create index if not exists homework_student_idx on homework (student_id, status);
create index if not exists homework_due_idx on homework (due_at);

-- ---------------------------------------------------------------------------
-- Follow-ups — action items surfaced to admin for outreach.
-- ---------------------------------------------------------------------------
create table if not exists followups (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references profiles(id) on delete cascade,
  session_id  uuid references sessions(id) on delete set null,
  type        text not null
              check (type in ('attendance_gap','no_show','report_flag','low_rating','homework_overdue')),
  priority    text not null default 'normal' check (priority in ('low','normal','high')),
  reason      text,
  status      text not null default 'open' check (status in ('open','snoozed','done')),
  due_at      timestamptz,
  snoozed_until timestamptz,
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at  timestamptz not null default now()
);
create index if not exists followups_open_idx on followups (status, priority);
create index if not exists followups_student_type_idx on followups (student_id, type, status);

-- ---------------------------------------------------------------------------
-- Outbound messages — log of parent comms (WhatsApp / email).
-- ---------------------------------------------------------------------------
create table if not exists outbound_messages (
  id          uuid primary key default gen_random_uuid(),
  channel     text not null default 'whatsapp' check (channel in ('whatsapp','email')),
  to_profile  uuid references profiles(id),
  to_phone    text,
  body        text not null,
  status      text not null default 'queued' check (status in ('queued','sent','failed','simulated')),
  provider_ref text,
  followup_id uuid references followups(id) on delete set null,
  sent_by     uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists outbound_messages_followup_idx on outbound_messages (followup_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table homework          enable row level security;
alter table followups         enable row level security;
alter table outbound_messages enable row level security;

-- homework: subject/parent/teacher-of/admin read; student or parent may mark
-- complete; teacher/admin may assign and edit.
create policy homework_read on homework
  for select using (
    public.is_admin()
    or student_id = auth.uid()
    or public.is_parent_of(student_id)
    or public.teaches_student(student_id)
  );
create policy homework_mark on homework
  for update using (
    public.is_admin()
    or student_id = auth.uid()
    or public.is_parent_of(student_id)
    or public.teaches_student(student_id)
  )
  with check (
    public.is_admin()
    or student_id = auth.uid()
    or public.is_parent_of(student_id)
    or public.teaches_student(student_id)
  );
create policy homework_assign on homework
  for insert with check (public.is_admin() or public.teaches_student(student_id));

-- followups: admin manages everything; teachers see + raise for their students.
create policy followups_admin on followups
  for all using (public.is_admin()) with check (public.is_admin());
create policy followups_teacher_read on followups
  for select using (public.teaches_student(student_id));
create policy followups_teacher_raise on followups
  for insert with check (public.teaches_student(student_id));

-- outbound messages: admin all; teachers read what they sent.
create policy outbound_admin on outbound_messages
  for all using (public.is_admin()) with check (public.is_admin());
create policy outbound_teacher_read on outbound_messages
  for select using (sent_by = auth.uid());

-- Keep homework.updated_at fresh.
drop trigger if exists on_homework_touch on homework;
create trigger on_homework_touch
  before update on homework
  for each row execute function public.touch_updated_at();
