-- ============================================================================
-- 0010_account_requests.sql
--   Public "request an account" submissions that an admin approves (which
--   provisions a real login) or rejects.
-- ============================================================================

create table if not exists account_requests (
  id           uuid primary key default gen_random_uuid(),
  role         text not null check (role in ('teacher','student','parent')),
  display_name text not null,
  email        text not null,
  phone        text,
  timezone     text not null default 'UTC',
  message      text,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by   uuid references profiles(id),
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists account_requests_status_idx on account_requests (status, created_at desc);

alter table account_requests enable row level security;

-- Anyone (incl. unauthenticated) may submit a request…
create policy account_requests_submit on account_requests
  for insert with check (true);

-- …but only admins can read or act on them.
create policy account_requests_admin on account_requests
  for all using (public.is_admin()) with check (public.is_admin());
