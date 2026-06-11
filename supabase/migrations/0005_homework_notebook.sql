-- ============================================================================
-- 0005_homework_notebook.sql
--   Link homework to a page in the student's running notebook, and add a
--   submit → teacher-verify flow so completion is evidenced by real work.
-- ============================================================================

alter table homework add column if not exists notebook_id      uuid references notebooks(id) on delete set null;
alter table homework add column if not exists notebook_page_id text;     -- tldraw page id within the notebook
alter table homework add column if not exists submitted_at     timestamptz;
alter table homework add column if not exists verified_by      uuid references profiles(id);
alter table homework add column if not exists verified_at      timestamptz;
alter table homework add column if not exists review_note      text;

-- Extend the status set: assigned → submitted → completed | incomplete.
alter table homework drop constraint if exists homework_status_check;
alter table homework add constraint homework_status_check
  check (status in ('assigned','submitted','completed','incomplete'));
