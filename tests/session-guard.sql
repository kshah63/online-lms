-- ============================================================================
-- tests/session-guard.sql — manual trigger check for 0017 §5b (sessions)
-- ----------------------------------------------------------------------------
-- An assigned teacher may update their own session through PostgREST (0003
-- sessions_teacher_update), but Phase 1 makes student_id / course_id decide
-- whose Pencil Space they get a host seat in. guard_session_update() limits a
-- teacher to the lesson-room columns. Run after `supabase db reset`:
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f tests/session-guard.sql
--
-- Prints `ok …` per case, aborts on the first `FAIL: …`; rolled back at the end.
-- Fixture: seed session …0010 = Maya (a1) × Sofia (b2), SAT Math, 'scheduled'.
-- The "victim" pair is Aarav (b1) × IGCSE Mathematics, taught by someone else.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- Each forbidden column on its own, so one passing guard can't hide another.
do $$
declare
  stmt text;
  stmts text[] := array[
    $q$update public.sessions set student_id = '00000000-0000-0000-0000-0000000000b1' where id = '20000000-0000-0000-0000-000000000010'$q$,
    $q$update public.sessions set course_id = '10000000-0000-0000-0000-000000000001' where id = '20000000-0000-0000-0000-000000000010'$q$,
    $q$update public.sessions set teacher_id = '00000000-0000-0000-0000-0000000000a2' where id = '20000000-0000-0000-0000-000000000010'$q$,
    $q$update public.sessions set scheduled_start = scheduled_start + interval '1 day', scheduled_end = scheduled_end + interval '1 day' where id = '20000000-0000-0000-0000-000000000010'$q$,
    $q$update public.sessions set fallback_join_url = 'https://evil.example.com/join' where id = '20000000-0000-0000-0000-000000000010'$q$,
    $q$update public.sessions set space_id = (select id from public.pencil_spaces limit 1) where id = '20000000-0000-0000-0000-000000000010'$q$,
    $q$update public.sessions set pencil_session_id = 'ffffffffffffffffffffffff' where id = '20000000-0000-0000-0000-000000000010'$q$,
    $q$update public.sessions set recording_url = 'https://evil.example.com/rewatch' where id = '20000000-0000-0000-0000-000000000010'$q$,
    $q$update public.sessions set analysis_status = 'skipped_opt_out' where id = '20000000-0000-0000-0000-000000000010'$q$,
    $q$update public.sessions set status = 'cancelled' where id = '20000000-0000-0000-0000-000000000010'$q$
  ];
begin
  foreach stmt in array stmts loop
    begin
      execute stmt;
      raise exception 'FAIL: teacher was allowed: %', stmt;
    exception when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
      raise notice 'ok   teacher refused: % (%)', substring(stmt from 'set ([a-z_]+)'), sqlerrm;
    end;
  end loop;
end $$;

-- What the lesson room legitimately writes still works.
do $$ declare n int; begin
  update public.sessions set agenda = 'Quadratics: completing the square' where id = '20000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: teacher could not edit the agenda (% rows)', n; end if;

  update public.sessions set actual_start = now(), status = 'in_progress'      -- startSessionClock
   where id = '20000000-0000-0000-0000-000000000010' and actual_start is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: teacher could not start the clock (% rows)', n; end if;

  update public.sessions set status = 'completed', actual_end = now(), analysis_status = 'no_recording'  -- endLesson (Zoom fallback)
   where id = '20000000-0000-0000-0000-000000000010' and status in ('scheduled','confirmed','in_progress');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: teacher could not end the lesson (% rows)', n; end if;
  raise notice 'ok   teacher can edit the agenda, start the clock and end the lesson (no_recording)';
end $$;

-- A completed lesson can't be walked back and completed again (credit trigger replay).
do $$ begin
  update public.sessions set status = 'in_progress' where id = '20000000-0000-0000-0000-000000000010';
  raise exception 'FAIL: teacher re-opened a completed lesson';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok   teacher cannot re-open a completed lesson (%)', sqlerrm;
end $$;

-- Another teacher's lesson is invisible to the update (RLS), not just guarded.
do $$ declare n int; begin
  update public.sessions set agenda = 'x' where id = '20000000-0000-0000-0000-000000000003';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: teacher updated another teacher''s session (% rows)', n; end if;
  raise notice 'ok   teacher cannot update another teacher''s session (0 rows)';
end $$;

reset role;

-- ---------------------------------------------------------------- admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$ declare n int; begin
  update public.sessions
     set teacher_id = '00000000-0000-0000-0000-0000000000a2',
         fallback_join_url = 'https://us02web.zoom.us/j/5550002222',
         analysis_status = 'failed'
   where id = '20000000-0000-0000-0000-000000000011';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: an admin could not reassign / set the override (% rows)', n; end if;
  raise notice 'ok   admin can reassign, set the per-lesson fallback link and analysis_status';
end $$;

reset role;

-- ---------------------------------------------------------------- service role (no JWT)
select set_config('request.jwt.claims', '', true);
set local role service_role;

do $$ declare n int; begin
  update public.sessions
     set space_id = (select id from public.pencil_spaces
                      where student_id = '00000000-0000-0000-0000-0000000000b2'
                        and course_id = '10000000-0000-0000-0000-000000000002'),
         pencil_session_id = 'eeeeeeeeeeeeeeeeeeeeeeee',
         analysis_status = 'pending'
   where id = '20000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: the service role could not write Pencil columns (% rows)', n; end if;
  raise notice 'ok   service role (join route / endLesson / pipeline) can write space_id, pencil_session_id, analysis_status';
end $$;

reset role;
rollback;
\echo 'session-guard: all checks passed'
