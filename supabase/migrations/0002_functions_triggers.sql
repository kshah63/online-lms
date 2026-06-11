-- ============================================================================
-- 0002_functions_triggers.sql — helper functions + triggers
-- ============================================================================

-- Read the caller's role without tripping RLS recursion on `profiles`.
create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'admin', false)
$$;

-- Is the caller the parent of this student?
create or replace function public.is_parent_of(child uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.parent_student
    where parent_id = auth.uid() and student_id = child
  )
$$;

-- Does the caller (a teacher) have any assigned session with this student?
create or replace function public.teaches_student(child uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sessions
    where teacher_id = auth.uid() and student_id = child
  )
$$;

-- ---------------------------------------------------------------------------
-- New auth user -> profile row. Metadata carries role/name/timezone supplied
-- at signup (admin-driven invites in practice). Defaults keep signup safe.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_name, email, timezone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'student'),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'timezone', 'UTC')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Ensure a running notebook exists for (course, student) and link it to the
-- session. One notebook per student per course (§5) — sessions share it.
-- ---------------------------------------------------------------------------
create or replace function public.attach_notebook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  nb_id uuid;
begin
  if new.notebook_id is not null then
    return new;
  end if;

  select id into nb_id
  from public.notebooks
  where course_id = new.course_id and student_id = new.student_id;

  if nb_id is null then
    insert into public.notebooks (course_id, student_id, tldraw_snapshot)
    values (new.course_id, new.student_id, null)
    returning id into nb_id;
  end if;

  new.notebook_id := nb_id;
  return new;
end;
$$;

drop trigger if exists on_session_attach_notebook on sessions;
create trigger on_session_attach_notebook
  before insert on sessions
  for each row execute function public.attach_notebook();

-- ---------------------------------------------------------------------------
-- Decrement a student's credit balance when a session completes (§10).
-- ---------------------------------------------------------------------------
create or replace function public.consume_credit_on_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    insert into public.credit_balances (student_id, balance, updated_at)
    values (new.student_id, -1, now())
    on conflict (student_id)
      do update set balance = public.credit_balances.balance - 1, updated_at = now();

    insert into public.credit_ledger (student_id, delta, reason, session_id)
    values (new.student_id, -1, 'session_consumed', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists on_session_complete_credit on sessions;
create trigger on_session_complete_credit
  after update on sessions
  for each row execute function public.consume_credit_on_complete();

-- ---------------------------------------------------------------------------
-- Keep notebooks.updated_at fresh on snapshot writes.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists on_notebook_touch on notebooks;
create trigger on_notebook_touch
  before update on notebooks
  for each row execute function public.touch_updated_at();
