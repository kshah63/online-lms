-- ============================================================================
-- 0014_no_double_booking.sql — a student can't have two overlapping lessons
-- ----------------------------------------------------------------------------
-- Belt + braces: server actions check for conflicts first (friendly message),
-- and this exclusion constraint guarantees it at the database level even if two
-- bookings race. Only ACTIVE statuses count — cancelled/completed don't block.
-- ============================================================================

create extension if not exists btree_gist;

alter table sessions drop constraint if exists sessions_no_student_overlap;
alter table sessions add constraint sessions_no_student_overlap
  exclude using gist (
    student_id with =,
    tstzrange(scheduled_start, scheduled_end) with &&
  )
  where (status in ('scheduled','confirmed','in_progress'));

notify pgrst, 'reload schema';
