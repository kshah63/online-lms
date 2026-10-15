-- ============================================================================
-- tests/profile-guard.sql — manual RLS/trigger check for 0017 §1 (profiles)
-- ----------------------------------------------------------------------------
-- vitest's FakeDb runs no RLS or triggers, so these rules are checked against a
-- real database. Run after `supabase db reset` (migrations + seed.sql):
--
--   psql "$(supabase status -o env | sed -n 's/^DB_URL=//p' | tr -d '"')" \
--        -v ON_ERROR_STOP=1 -f tests/profile-guard.sql
--
-- Every case prints `ok …`; the first failure aborts with `FAIL: …` and a
-- non-zero exit. Everything runs in one transaction that is rolled back, so the
-- seed data is untouched. Personas = the seed's fixed ids; a persona is a JWT
-- (`request.jwt.claims.sub`) plus `role authenticated`, as PostgREST sets them.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------- student b1
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;

do $$ begin
  update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b1';
  raise exception 'FAIL: a student changed their own role';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok   student cannot make themselves admin (%)', sqlerrm;
end $$;

do $$ begin
  update public.profiles set email = 'someone-else@lessons.dev' where id = '00000000-0000-0000-0000-0000000000b1';
  raise exception 'FAIL: a student changed their own email';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok   student cannot change their email (%)', sqlerrm;
end $$;

do $$ declare n int; begin
  update public.profiles set timezone = 'Europe/Paris' where id = '00000000-0000-0000-0000-0000000000b1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: a student could not update their own timezone (% rows)', n; end if;
  raise notice 'ok   student can still edit their own profile fields (timezone)';
end $$;

do $$ declare n int; begin
  update public.profiles set display_name = 'Hacked' where id = '00000000-0000-0000-0000-0000000000b2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a student updated another user''s profile (% rows)', n; end if;
  raise notice 'ok   student cannot update another user''s row (0 rows)';
end $$;

-- rl_check is service-role only (0017 §1d): nobody can exhaust someone else's bucket.
do $$ begin
  perform public.rl_check('pencil:join:00000000-0000-0000-0000-0000000000a1', 1, 3600);
  raise exception 'FAIL: authenticated can call rl_check';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok   authenticated cannot call rl_check (%)', sqlerrm;
end $$;

reset role;

-- ---------------------------------------------------------------- teacher a1
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

do $$ begin
  update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
  raise exception 'FAIL: a teacher changed their own role';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok   teacher cannot make themselves admin (%)', sqlerrm;
end $$;

reset role;

-- ---------------------------------------------------------------- admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$ declare n int; begin
  update public.profiles set role = 'parent', email = 'aarav+moved@lessons.dev' where id = '00000000-0000-0000-0000-0000000000b1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: an admin could not change role/email (% rows)', n; end if;
  update public.profiles set role = 'student', email = 'aarav@lessons.dev' where id = '00000000-0000-0000-0000-0000000000b1';
  raise notice 'ok   admin can change another user''s role and email';
end $$;

reset role;

-- ---------------------------------------------------------------- service role (no JWT)
select set_config('request.jwt.claims', '', true);
set local role service_role;

do $$ declare n int; begin
  update public.profiles set role = 'teacher' where id = '00000000-0000-0000-0000-0000000000b2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: the service role could not change a role (% rows)', n; end if;
  update public.profiles set role = 'student' where id = '00000000-0000-0000-0000-0000000000b2';
  raise notice 'ok   service role (accounts.ts provisioning) can set roles';
end $$;

do $$ declare ok boolean; begin
  select public.rl_check('test:profile-guard', 5, 60) into ok;
  if ok is not true then raise exception 'FAIL: service role rl_check did not allow the first call'; end if;
  raise notice 'ok   service role can call rl_check';
end $$;

reset role;

-- ---------------------------------------------------------------- self-signup (0017 §1c)
-- GoTrue /signup lets the caller choose raw_user_meta_data; the role in it must be ignored.
do $$ declare r text; begin
  insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-00000000dead', 'authenticated', 'authenticated', 'mallory@example.com',
          '{"role":"admin","display_name":"Mallory"}', now(), now());
  select role into r from public.profiles where id = '00000000-0000-0000-0000-00000000dead';
  if r is distinct from 'student' then raise exception 'FAIL: signup metadata produced role %', r; end if;
  raise notice 'ok   signup metadata cannot choose a role (profile created as student)';
end $$;

rollback;
\echo 'profile-guard: all checks passed'
