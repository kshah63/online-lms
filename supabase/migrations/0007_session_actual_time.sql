-- ============================================================================
-- 0007_session_actual_time.sql
--   Track the real lesson duration — from when teacher AND student are both in
--   the room — independent of the booked start/end time.
-- ============================================================================

alter table sessions add column if not exists actual_start timestamptz;
alter table sessions add column if not exists actual_end   timestamptz;
