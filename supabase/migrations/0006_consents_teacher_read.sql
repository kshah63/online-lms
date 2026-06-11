-- ============================================================================
-- 0006_consents_teacher_read.sql
--   Teachers must be able to READ their students' consents — the lesson room's
--   recording gate (§9) checks the student's 'recording' consent, and the
--   assigned teacher is exactly who needs that answer. Without this policy the
--   query returns no rows for teachers and recording is always disabled.
-- ============================================================================

drop policy if exists consents_teacher_read on consents;
create policy consents_teacher_read on consents
  for select using (public.teaches_student(profile_id));
