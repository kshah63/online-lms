-- ============================================================================
-- 0016_feedback_moments.sql — timestamped "key moments" on AI coaching
-- ----------------------------------------------------------------------------
-- The post-session analysis now extracts specific transcript moments — both
-- strengths and improvement opportunities — each with a timestamp, a short
-- quote, and a concrete comment. Shape:
--   [{ "at": "12:34", "kind": "strength"|"improvement",
--      "quote": "...", "comment": "..." }, …]
-- ============================================================================

alter table teacher_feedback add column if not exists moments jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
