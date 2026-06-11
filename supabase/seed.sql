-- ============================================================================
-- seed.sql — demo data for local development (supabase db reset)
-- ----------------------------------------------------------------------------
-- Creates auth users with a shared dev password, then profiles and a full day
-- of sessions anchored to "today" so the daily schedule board always has data.
--
--   Dev password for every account below:  password123
-- ============================================================================

-- Fixed UUIDs so relationships are easy to read.
-- admin    : 00000000-0000-0000-0000-000000000001
-- teacher A: 00000000-0000-0000-0000-0000000000a1  (Maya Chen, Asia/Singapore)
-- teacher B: 00000000-0000-0000-0000-0000000000a2  (Daniel Okafor, Europe/London)
-- student 1: 00000000-0000-0000-0000-0000000000b1  (Aarav Sharma, Asia/Singapore)
-- student 2: 00000000-0000-0000-0000-0000000000b2  (Sofia Rossi, America/New_York)
-- student 3: 00000000-0000-0000-0000-0000000000b3  (Lena Park, Asia/Seoul)
-- parent 1 : 00000000-0000-0000-0000-0000000000c1  (Priya Sharma -> Aarav)
-- parent 2 : 00000000-0000-0000-0000-0000000000c2  (Marco Rossi  -> Sofia)

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@lessons.dev',   crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','maya@lessons.dev',    crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','daniel@lessons.dev',  crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','aarav@lessons.dev',   crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sofia@lessons.dev',   crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lena@lessons.dev',    crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','priya@lessons.dev',   crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','marco@lessons.dev',   crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}')
on conflict (id) do nothing;

insert into public.profiles (id, role, display_name, email, timezone) values
  ('00000000-0000-0000-0000-000000000001','admin',  'Admin Office',  'admin@lessons.dev',  'Asia/Singapore'),
  ('00000000-0000-0000-0000-0000000000a1','teacher','Maya Chen',     'maya@lessons.dev',   'Asia/Singapore'),
  ('00000000-0000-0000-0000-0000000000a2','teacher','Daniel Okafor', 'daniel@lessons.dev', 'Europe/London'),
  ('00000000-0000-0000-0000-0000000000b1','student','Aarav Sharma',  'aarav@lessons.dev',  'Asia/Singapore'),
  ('00000000-0000-0000-0000-0000000000b2','student','Sofia Rossi',   'sofia@lessons.dev',  'America/New_York'),
  ('00000000-0000-0000-0000-0000000000b3','student','Lena Park',     'lena@lessons.dev',   'Asia/Seoul'),
  ('00000000-0000-0000-0000-0000000000c1','parent', 'Priya Sharma',  'priya@lessons.dev',  'Asia/Singapore'),
  ('00000000-0000-0000-0000-0000000000c2','parent', 'Marco Rossi',   'marco@lessons.dev',  'America/New_York')
on conflict (id) do nothing;

insert into public.parent_student (parent_id, student_id) values
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000b2')
on conflict do nothing;

insert into public.courses (id, name, subject, materials_course_id) values
  ('10000000-0000-0000-0000-000000000001','IGCSE Mathematics',        'Mathematics', 'aaaa0000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002','SAT Math Prep',            'Mathematics', 'aaaa0000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000003','A-Level Physics',          'Physics',     'aaaa0000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

insert into public.enrollments (student_id, course_id) values
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000000b3','10000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000003')
on conflict do nothing;

insert into public.teacher_course (teacher_id, course_id) values
  ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into public.teacher_availability (teacher_id, weekday, start_time, end_time, timezone) values
  ('00000000-0000-0000-0000-0000000000a1', 1, '09:00', '17:00', 'Asia/Singapore'),
  ('00000000-0000-0000-0000-0000000000a1', 2, '09:00', '17:00', 'Asia/Singapore'),
  ('00000000-0000-0000-0000-0000000000a1', 3, '09:00', '17:00', 'Asia/Singapore'),
  ('00000000-0000-0000-0000-0000000000a1', 4, '09:00', '17:00', 'Asia/Singapore'),
  ('00000000-0000-0000-0000-0000000000a1', 5, '09:00', '13:00', 'Asia/Singapore'),
  ('00000000-0000-0000-0000-0000000000a2', 1, '08:00', '16:00', 'Europe/London'),
  ('00000000-0000-0000-0000-0000000000a2', 3, '08:00', '16:00', 'Europe/London'),
  ('00000000-0000-0000-0000-0000000000a2', 5, '08:00', '16:00', 'Europe/London');

-- ---------------------------------------------------------------------------
-- Today's sessions — anchored to current_date so the board is always populated.
-- A spread of statuses: in_progress, confirmed, scheduled, unassigned, no_show.
-- ---------------------------------------------------------------------------
insert into public.sessions (id, course_id, student_id, teacher_id, scheduled_start, scheduled_end, status, video_room_id, agenda) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1',
    (current_date + time '09:00') at time zone 'Asia/Singapore', (current_date + time '10:00') at time zone 'Asia/Singapore', 'completed', 'room-aarav-001', 'Quadratic equations — completing the square'),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a1',
    (now() - interval '10 minutes'), (now() + interval '50 minutes'), 'in_progress', 'room-sofia-002', 'SAT Math — function transformations'),
  ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000a2',
    (now() + interval '2 hours'), (now() + interval '3 hours'), 'confirmed', 'room-lena-003', 'Newtonian mechanics — momentum'),
  ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000b1',null,
    (now() + interval '4 hours'), (now() + interval '5 hours'), 'scheduled', null, 'Physics — circular motion intro'),
  ('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a2',
    (now() - interval '3 hours'), (now() - interval '2 hours'), 'no_show', 'room-aarav-005', 'Trigonometry — sine rule')
on conflict (id) do nothing;

-- A recurring weekly slot for next week (series_id groups them).
insert into public.sessions (id, course_id, student_id, teacher_id, scheduled_start, scheduled_end, status, series_id, agenda) values
  ('20000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a1',
    (now() + interval '7 days'),  (now() + interval '7 days' + interval '1 hour'),  'scheduled', '30000000-0000-0000-0000-000000000001', 'SAT Math — weekly slot'),
  ('20000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a1',
    (now() + interval '14 days'), (now() + interval '14 days' + interval '1 hour'), 'scheduled', '30000000-0000-0000-0000-000000000001', 'SAT Math — weekly slot')
on conflict (id) do nothing;

-- Consents (parents grant for children; teachers consent to evaluation).
insert into public.consents (profile_id, type, granted_by) values
  ('00000000-0000-0000-0000-0000000000b1','recording',  '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000b1','ai_analysis','00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000b2','recording',  '00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-0000000000a1','teacher_eval','00000000-0000-0000-0000-0000000000a1')
on conflict do nothing;

-- Billing balances.
insert into public.credit_balances (student_id, balance) values
  ('00000000-0000-0000-0000-0000000000b1', 8),
  ('00000000-0000-0000-0000-0000000000b2', 2),
  ('00000000-0000-0000-0000-0000000000b3', 12)
on conflict (student_id) do nothing;

-- §7 Coaching data for the completed morning lesson (so the dashboards aren't
-- empty on a fresh real database; the demo dataset synthesizes a richer history).
insert into public.transcripts (session_id, segments) values
  ('20000000-0000-0000-0000-000000000001',
   '[{"speaker":"teacher","text":"Today we are completing the square. Let me show you the method.","start_ms":0,"end_ms":42000},
     {"speaker":"student","text":"Okay, so we halve the middle coefficient?","start_ms":42000,"end_ms":48000},
     {"speaker":"teacher","text":"Exactly, well spotted. Why do we square it afterwards?","start_ms":48000,"end_ms":56000},
     {"speaker":"student","text":"To make a perfect square trinomial we can factor.","start_ms":56000,"end_ms":64000},
     {"speaker":"teacher","text":"Great thinking. Try the next one yourself.","start_ms":64000,"end_ms":70000},
     {"speaker":"student","text":"So x minus five squared minus seventeen.","start_ms":71000,"end_ms":82000}]'::jsonb)
on conflict (session_id) do nothing;

insert into public.session_metrics
  (session_id, teacher_talk_pct, student_talk_pct, question_count, open_question_pct, avg_wait_ms, student_turns, avg_student_turn_ms, praise_count, computed_at) values
  ('20000000-0000-0000-0000-000000000001', 0.55, 0.45, 2, 0.5, 1000, 3, 8333, 2, now())
on conflict (session_id) do nothing;

insert into public.teacher_feedback (session_id, teacher_id, summary, strengths, suggestions, dimension_scores) values
  ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1',
   'A balanced lesson — the student talked 45% of the time across 3 turns and reasoned through the method.',
   '["Strong student voice — they did a healthy share of the talking and thinking.","Good use of open questions to draw out the student''s reasoning."]'::jsonb,
   '["Extend your wait-time after a question to ~3 seconds before stepping in.","Name specific things the student did well to build their confidence."]'::jsonb,
   '{"engagement":5,"questioning":4,"clarity":3,"rapport":4}'::jsonb)
on conflict (session_id) do nothing;

-- Parent phone numbers (for WhatsApp follow-ups).
update public.profiles set phone = '+6591234567'  where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set phone = '+13475550123' where id = '00000000-0000-0000-0000-0000000000c2';

-- Homework — done on the student's running notebook (notebook_id resolved by
-- subselect since notebook ids are generated by the attach_notebook trigger).
insert into public.homework (id, session_id, student_id, course_id, description, due_at, status, completed_at, submitted_at, notebook_id) values
  ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001',
   'Exercise 4B questions 1–8 (completing the square).', now() - interval '1 day', 'completed', now() - interval '6 hours', now() - interval '8 hours',
   (select id from public.notebooks where course_id='10000000-0000-0000-0000-000000000001' and student_id='00000000-0000-0000-0000-0000000000b1')),
  ('40000000-0000-0000-0000-000000000002',null,'00000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002',
   'Function transformations practice set — show your working on the notebook.', now() - interval '1 day', 'submitted', null, now() - interval '4 hours',
   (select id from public.notebooks where course_id='10000000-0000-0000-0000-000000000002' and student_id='00000000-0000-0000-0000-0000000000b2'))
on conflict (id) do nothing;

-- A couple of open follow-ups for the admin dashboard.
insert into public.followups (student_id, session_id, type, priority, reason) values
  ('00000000-0000-0000-0000-0000000000b1','20000000-0000-0000-0000-000000000005','no_show','high','Missed the Trigonometry lesson — hasn''t rebooked.'),
  ('00000000-0000-0000-0000-0000000000b2',null,'homework_overdue','normal','Function transformations homework is 2 days overdue.')
on conflict do nothing;

-- One published report on the completed morning lesson.
insert into public.reports (session_id, teacher_id, topics_covered, how_student_did, strengths, areas_to_work, homework, rating, published_at) values
  ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1',
   'Completing the square; vertex form of a parabola.',
   'Aarav worked through 6 problems and got to the vertex form independently by the end.',
   'Strong algebraic manipulation; asked good clarifying questions.',
   'Sign errors when the coefficient of x² is not 1 — worth more practice.',
   'Exercise 4B questions 1–8.',
   4, now())
on conflict (session_id) do nothing;
