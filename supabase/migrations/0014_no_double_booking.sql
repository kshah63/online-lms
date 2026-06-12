-- ============================================================================
-- 0014_no_double_booking.sql — a student can't have two overlapping lessons
-- ----------------------------------------------------------------------------
-- Belt + braces: server actions check for conflicts first (friendly message),
-- and this exclusion constraint guarantees it at the database level even if two
-- bookings race. Only ACTIVE statuses count — cancelled/completed don't block.
--
-- The constraint can't be created while existing rows violate it, so step 1
-- resolves any pre-existing overlaps: within each overlapping cluster the
-- EARLIEST-CREATED booking is kept and the rest are cancelled (with a reason,
-- so they're identifiable in the sessions list afterwards).
-- ============================================================================

create extension if not exists btree_gist;

-- 1) Clean up existing overlaps: cancel any active session that overlaps an
--    earlier-created active session for the same student.
with offenders as (
  select distinct s1.id
  from sessions s1
  join sessions s2
    on  s2.student_id = s1.student_id
    and s2.id <> s1.id
    and s1.status in ('scheduled','confirmed','in_progress')
    and s2.status in ('scheduled','confirmed','in_progress')
    and tstzrange(s1.scheduled_start, s1.scheduled_end)
        && tstzrange(s2.scheduled_start, s2.scheduled_end)
    and (s2.created_at < s1.created_at
         or (s2.created_at = s1.created_at and s2.id < s1.id))
)
update sessions
   set status = 'cancelled',
       cancel_reason = 'Auto-cancelled: overlapped another booking (double-booking cleanup, migration 0014)'
 where id in (select id from offenders);

-- 2) Now the constraint can be created.
alter table sessions drop constraint if exists sessions_no_student_overlap;
alter table sessions add constraint sessions_no_student_overlap
  exclude using gist (
    student_id with =,
    tstzrange(scheduled_start, scheduled_end) with &&
  )
  where (status in ('scheduled','confirmed','in_progress'));

notify pgrst, 'reload schema';
