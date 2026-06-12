-- ============================================================================
-- 0015_audit_log.sql — who did what, when
-- ----------------------------------------------------------------------------
-- Append-only record of significant actions (bookings, account provisioning,
-- report publishing, grading, enrollment decisions, …). Written exclusively
-- through the service role (see src/lib/audit.ts) so entries can't be forged
-- or tampered with by any signed-in role; admins can read it in /admin/audit.
-- ============================================================================

create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references profiles(id) on delete set null,
  actor_role  text,
  action      text not null,        -- e.g. 'booking.create', 'account.approve'
  entity      text,                 -- e.g. 'session', 'profile', 'homework'
  entity_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_created_idx on audit_log (created_at desc);
create index if not exists audit_log_actor_idx on audit_log (actor_id, created_at desc);

alter table audit_log enable row level security;

-- Admins may read. NO insert/update/delete policies for any role: the only
-- writer is the service role (bypasses RLS), and nothing ever edits a row.
create policy audit_log_admin_read on audit_log
  for select using (public.is_admin());

notify pgrst, 'reload schema';
