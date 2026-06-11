-- ============================================================================
-- 0008_enrollment_requests.sql
--   Students/parents request enrollment in a course; admin approves → creates
--   the enrollment. Keeps enrollment admin-controlled while letting families ask.
-- ============================================================================

create table if not exists enrollment_requests (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references profiles(id) on delete cascade,
  course_id    uuid not null references courses(id) on delete cascade,
  requested_by uuid references profiles(id),
  status       text not null default 'pending' check (status in ('pending','approved','denied')),
  decided_by   uuid references profiles(id),
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists enrollment_requests_status_idx on enrollment_requests (status, created_at desc);

alter table enrollment_requests enable row level security;

-- The subject, their parent, and admin can see a request.
create policy enrollment_requests_read on enrollment_requests
  for select using (
    public.is_admin() or student_id = auth.uid() or public.is_parent_of(student_id)
  );

-- A student (for themselves) or a parent (for their child) can raise one.
create policy enrollment_requests_create on enrollment_requests
  for insert with check (
    student_id = auth.uid() or public.is_parent_of(student_id)
  );

-- Only admin decides (approve/deny).
create policy enrollment_requests_admin on enrollment_requests
  for update using (public.is_admin()) with check (public.is_admin());
