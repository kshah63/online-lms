-- ============================================================================
-- 0009_homework_grading_files.sql
--   Quantifiable homework marking (correct / incorrect / not-done + comment)
--   and file (PDF/image) attachments on a submission.
-- ============================================================================

alter table homework add column if not exists mark_correct   int;
alter table homework add column if not exists mark_incorrect  int;
alter table homework add column if not exists mark_not_done   int;
alter table homework add column if not exists feedback        text;
alter table homework add column if not exists attachments     jsonb not null default '[]'::jsonb;

-- Private bucket for homework uploads. All access is brokered server-side via
-- the service role (see /api/homework/*), so no public access / object RLS.
insert into storage.buckets (id, name, public)
values ('homework', 'homework', false)
on conflict (id) do nothing;
