-- ============================================================================
-- 0003_rls.sql — Row Level Security (§2)
-- ----------------------------------------------------------------------------
--   students / parents : see only their own sessions, reports, notebooks
--   teachers           : see sessions they're assigned to + their students
--   admin              : sees everything
-- ============================================================================

alter table profiles            enable row level security;
alter table parent_student      enable row level security;
alter table courses             enable row level security;
alter table enrollments         enable row level security;
alter table teacher_course      enable row level security;
alter table notebooks           enable row level security;
alter table sessions            enable row level security;
alter table teacher_availability enable row level security;
alter table consents            enable row level security;
alter table transcripts         enable row level security;
alter table session_metrics     enable row level security;
alter table live_events         enable row level security;
alter table teacher_feedback    enable row level security;
alter table reports             enable row level security;
alter table credit_balances     enable row level security;
alter table credit_ledger       enable row level security;
alter table notifications       enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select_self_or_related on profiles
  for select using (
    id = auth.uid()
    or public.is_admin()
    or public.is_parent_of(id)
    or public.teaches_student(id)
    -- everyone may read teacher/admin display info (needed to render schedules)
    or role in ('teacher','admin')
  );

create policy profiles_update_self on profiles
  for update using (id = auth.uid() or public.is_admin());

create policy profiles_admin_insert on profiles
  for insert with check (public.is_admin() or id = auth.uid());

-- ---------------------------------------------------------------------------
-- parent_student
-- ---------------------------------------------------------------------------
create policy parent_student_read on parent_student
  for select using (
    public.is_admin() or parent_id = auth.uid() or student_id = auth.uid()
  );
create policy parent_student_admin_write on parent_student
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- courses — readable by any authenticated user; only admin writes
-- ---------------------------------------------------------------------------
create policy courses_read on courses
  for select using (auth.uid() is not null);
create policy courses_admin_write on courses
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- enrollments / teacher_course
-- ---------------------------------------------------------------------------
create policy enrollments_read on enrollments
  for select using (
    public.is_admin() or student_id = auth.uid() or public.is_parent_of(student_id)
    or exists (select 1 from teacher_course tc where tc.course_id = enrollments.course_id and tc.teacher_id = auth.uid())
  );
create policy enrollments_admin_write on enrollments
  for all using (public.is_admin()) with check (public.is_admin());

create policy teacher_course_read on teacher_course
  for select using (public.is_admin() or teacher_id = auth.uid());
create policy teacher_course_admin_write on teacher_course
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- sessions — the central object
-- ---------------------------------------------------------------------------
create policy sessions_select on sessions
  for select using (
    public.is_admin()
    or teacher_id = auth.uid()
    or student_id = auth.uid()
    or public.is_parent_of(student_id)
  );

-- Admin creates/schedules and assigns teachers.
create policy sessions_admin_write on sessions
  for all using (public.is_admin()) with check (public.is_admin());

-- An assigned teacher may update their own session (status, agenda, room).
create policy sessions_teacher_update on sessions
  for update using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

-- ---------------------------------------------------------------------------
-- teacher_availability — teacher manages own; admin reads all
-- ---------------------------------------------------------------------------
create policy availability_read on teacher_availability
  for select using (public.is_admin() or teacher_id = auth.uid());
create policy availability_teacher_write on teacher_availability
  for all using (teacher_id = auth.uid() or public.is_admin())
  with check (teacher_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- notebooks — teacher (of the student) + the student + admin
-- ---------------------------------------------------------------------------
create policy notebooks_access on notebooks
  for all using (
    public.is_admin()
    or student_id = auth.uid()
    or public.is_parent_of(student_id)
    or public.teaches_student(student_id)
  )
  with check (
    public.is_admin()
    or student_id = auth.uid()
    or public.teaches_student(student_id)
  );

-- ---------------------------------------------------------------------------
-- consents — the subject, their parent, and admin
-- ---------------------------------------------------------------------------
create policy consents_access on consents
  for all using (
    public.is_admin() or profile_id = auth.uid() or granted_by = auth.uid()
    or public.is_parent_of(profile_id)
  )
  with check (
    public.is_admin() or profile_id = auth.uid() or granted_by = auth.uid()
    or public.is_parent_of(profile_id)
  );

-- ---------------------------------------------------------------------------
-- transcripts / metrics / live_events / teacher_feedback
--   visible to the session's teacher + admin (teacher_eval is sensitive).
-- ---------------------------------------------------------------------------
create policy transcripts_read on transcripts
  for select using (
    public.is_admin()
    or exists (select 1 from sessions s where s.id = transcripts.session_id and s.teacher_id = auth.uid())
  );

create policy metrics_read on session_metrics
  for select using (
    public.is_admin()
    or exists (select 1 from sessions s where s.id = session_metrics.session_id and s.teacher_id = auth.uid())
  );

create policy live_events_read on live_events
  for select using (
    public.is_admin()
    or exists (select 1 from sessions s where s.id = live_events.session_id and s.teacher_id = auth.uid())
  );

create policy feedback_read on teacher_feedback
  for select using (public.is_admin() or teacher_id = auth.uid());

-- ---------------------------------------------------------------------------
-- reports — parent/student see PUBLISHED only; teacher sees own; admin all
-- ---------------------------------------------------------------------------
create policy reports_read on reports
  for select using (
    public.is_admin()
    or teacher_id = auth.uid()
    or (
      published_at is not null
      and exists (
        select 1 from sessions s
        where s.id = reports.session_id
          and (s.student_id = auth.uid() or public.is_parent_of(s.student_id))
      )
    )
  );

create policy reports_teacher_write on reports
  for all using (public.is_admin() or teacher_id = auth.uid())
  with check (public.is_admin() or teacher_id = auth.uid());

-- ---------------------------------------------------------------------------
-- billing — student/parent read own balance + ledger; admin all
-- ---------------------------------------------------------------------------
create policy balances_read on credit_balances
  for select using (
    public.is_admin() or student_id = auth.uid() or public.is_parent_of(student_id)
  );
create policy balances_admin_write on credit_balances
  for all using (public.is_admin()) with check (public.is_admin());

create policy ledger_read on credit_ledger
  for select using (
    public.is_admin() or student_id = auth.uid() or public.is_parent_of(student_id)
  );
create policy ledger_admin_write on credit_ledger
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- notifications — recipient reads/updates own
-- ---------------------------------------------------------------------------
create policy notifications_owner on notifications
  for all using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());
