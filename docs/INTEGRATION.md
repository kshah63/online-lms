# Integrating the lessons platform with mv-app

_Decision record, 13 Oct 2026. Produced by a three-option design panel (two independent judges, factual claims verified against the mv-app code and a scratch database with every migration applied), then edited. Companion to REFINEMENT_PLAN.md, which it supersedes on architecture._

This is the design for bringing the online-lms lessons platform (online-lms) into the MathVision app (mv-app). It was chosen from three options by two independent judges, who both scored Option C highest (42 and 41 points, against 38 and 38 for Option A and 32 and 34 for Option B). The grafts both judges asked for are folded in, and every factual correction they found has been checked against the scratch database (a local scratch database with all 523 migrations applied) and the code, and applied here.

Everything named below is a real name from the code or the database unless it is marked NEW.

## Build status, 13 Oct 2026

Built and verified in the session that wrote this record: everything in the mv-app change list below except the native app screens that are not Join, the Write tab's online lessons and the admin's per-room switch (follow-up approval, consents, the child's Progress link, the retention Choice and the tap-router branches for the two new push kinds are still the app's to build); the room's surfaces listed under "Practice, syllabus and progress" (bank, syllabus editor, practice, timed tests with integrity, flagged-test review, progress, brief, follow-up decisions, recording playback, consents); lesson-finalize with the three Claude passes; the four push pairs; the no-join and retention sweeps; and the per-department switch with the Zoom fallback. The mv-app side is on mv-app's branch claude/lesson-platform (merged with main on 14 Oct 2026), eleven commits, awaiting its pull request. Two readings of the design were changed on the way and are recorded in the migrations: a student who arrives first opens the room but does not make the teacher present (host_joined_at, 20261013174253), and the room derives syllabus statuses itself from the signals child_progress gathers rather than the database storing them.

## Decision

**Fold the lesson features into mv-app. Keep only the browser-only surfaces as a small Next.js app, in the mv-app repo, on mv-app's Supabase project.**

| Surface | Lives in | What it holds |
| --- | --- | --- |
| Phone app and desk web (desk.mathvisionapp.com) | mv-app, Expo | Everything it holds today, plus: Join button for online lessons, online lessons on the teacher's Write tab, report form prefilled from the AI draft, in-charge follow-up approvals, consents and a Progress link on the child screen, materials mapping and room flags for admins |
| room/ (NEW, room.mathvisionapp.com) | mv-app/room, Next.js 14 trimmed from online-lms | Live lesson room (Daily video, tldraw notebook, materials panel, live coach, activity panel), timed tests with fullscreen integrity, and for now at-home practice, question-bank authoring, the syllabus editor and the progress page |
| Database | mv-app's Supabase project, one | All lesson, practice, syllabus and follow-up facts, as lesson_, practice_ and syllabus_ tables with RLS and RPCs |
| Edge functions | mv-app/supabase/functions | room-ticket, room-redeem, lesson-finalize, practice-extract, materials-proxy, daily-webhook (all NEW), plus new cases in send-push |
| Materials portal | material, own Supabase | Unchanged; read server-to-server through its /api/v1 Bearer API |
| online-lms repo and its Supabase project | Retired | Read-only export, then shut down |

Why not A (online-lms as a second full web client of mv-app's database): one schema with two complete UIs and two deploy pipelines for the same facts, a global meeting_url trigger that re-points every online session at once, a custom Postgres role with a self-signed JWT that no migration has ever created (the scratch database has no authenticator role, so the grant cannot even be replayed), and a second inbox for in-charges on a web page.

Why not B (separate projects with a mirror and an identity bridge): two RLS rulebooks, a cached copy of route_booking answers that drifts until the next five-minute pass, a Vercel deployment holding mv-app's service-role key and minting mv-app sessions for browsers, and a lessons repo with no CI holding minors' transcripts. B remains the fallback if the owner refuses any lesson tables in mv-app; its one migration (an import_% door) is also the shape this design uses for webhook write-back.

The first two build stages (tickets, room_access, lesson_rooms, lesson_join, lesson_end, the per-department flag, the Join button with Zoom fallback, the Write-tab listing) are the same core A would build, so the owner can re-confirm the choice after stage 2 with nothing wasted.

## Identity and SSO

**One Supabase project, one auth.users, one profiles row per person.** The room (room/, @supabase/ssr cookie sessions) and the Expo app share them. Roles come from profiles.role plus department_members, never from JWT claims (there are none).

### Two sign-in doors in the room, mirroring the app

For a bookmarked room.mathvisionapp.com (one login, the credentials the person already has):

- Team: email + password through signInWithPassword, with a portal username resolved first by the anon RPC email_for_username, exactly as app/(auth)/team.tsx does.
- Families and students: six-digit email code through signInWithOtp({ shouldCreateUser: false }) then verifyOtp({ type: 'email' }), as app/(auth)/family.tsx does.
- Students created by the office carry placeholder addresses (c<id>@pending.mathvisionapp.com, src/lib/approvals.ts line 138). Nothing is ever sent to those addresses, so for them the ticket path below is the only door, and the room's sign-in page says so instead of offering a code that never arrives.

### Zero-login hand-off from the app and the desk (the ticket)

1. app/sessions/[id].tsx: the "Join online session" button (line 519 today, Linking.openURL(request.meeting_url ?? onlineMeetingUrl)) gains one branch. When request.meeting_url is on env.roomUrl, it calls supabase.functions.invoke('room-ticket', { session_id, purpose: 'join' }). The user's JWT travels in the Authorization header, as every edge function call does; nothing secret goes in a URL.
2. supabase/functions/room-ticket/index.ts (NEW) verifies the caller the way call-start does (asCaller.auth.getUser(token) on an anon client), asks admin.rpc('room_access', { p_session_id, uid }) which returns host, learner, observer or null, refuses with 403 on null, inserts a lesson_tickets row (token_hash = sha256 of 32 random bytes, user_id, session_id, purpose join or test, attempt_id, expires_at = now() + 2 minutes) and returns { url: ROOM_URL + '/join#t=' + token + '&next=/lesson/' + session_id }. The token is in the URL fragment, so it never reaches a server log or a Referer.
3. The app opens the URL with WebBrowser.openBrowserAsync(url, { presentationStyle: PAGE_SHEET }), the same call app/(tabs)/portal.tsx uses for the WordPress portal, so SFSafariViewController and Custom Tabs keep the room's cookie between opens (graft from A; openAuthSessionAsync would show an iOS "wants to sign in" alert on every join). On the desk web build it opens a new tab.
4. room/src/app/join/page.tsx (tiny client page) reads the fragment and POSTs it to room/src/app/api/join/route.ts.
5. /api/join calls the edge function room-redeem (NEW) with the anon key as the bearer plus a shared ROOM_REDEEM_SECRET header, body { token }. room-redeem hashes the token, calls admin.rpc('redeem_lesson_ticket', { p_token_hash }) (single use: update ... set redeemed_at = now() where redeemed_at is null and expires_at > now() returning user_id, session_id, purpose, attempt_id), reads the user's email with the service role (the sanctioned reader behind the profiles column wall), calls auth.admin.generateLink({ type: 'magiclink', email }), writes record_audit('lesson_ticket_redeemed', 'session_request', session_id, ...) and returns { hashed_token, user_id, next }.
6. /api/join calls verifyOtp({ token_hash, type: 'magiclink' }) on the cookie-bound SSR client (anon key), asserts session.user.id equals the returned user_id, then redirects to next. The service-role key therefore stays inside Supabase edge functions, as it does for call-start today; Vercel holds only the anon key and third-party keys.

Failure mode: if room-ticket or room-redeem errors, the session screen falls back to today's Zoom flow (request.meeting_url ?? centre_schedule.online_meeting_url), so a broken hand-off never cancels a lesson.

### MFA

mv-app elevates team sign-ins to aal2 (src/context/AuthContext.tsx). A ticket-minted session is aal1, so room/src/lib/data/auth.ts keeps online-lms's getAuthenticatorAssuranceLevel check and sends staff, support and admin through /mfa once per browser. Families and students have no MFA, so for them the hand-off is truly zero steps. retention_settings.require_admin_mfa is a real setting and is honoured.

### The column wall

In the scratch database the authenticated role has only INSERT and UPDATE on profiles.email and profiles.phone (information_schema.column_privileges), so online-lms's getCurrentProfile (.from('profiles').select('*')) and its signIn (.select('role').eq('email', ...)) fail with 42501 the moment they point at this project. In the room: a person's own row comes from rpc('my_profile'); other people's names and seats come from the NEW RPC lesson_room_state(p_session_id) (full_name, preferred_name, role, seat); the room never selects profiles.email or phone. Emails are read only inside room-redeem with the service role.

### Hosting rules

- The room host must not sit under mathvisionapp.com/sessions, /chat or /announcements: app.config.ts registers applinks:mathvisionapp.com and intentFilters for those prefixes, so the app would capture the URL. room.mathvisionapp.com is a separate host.
- Supabase Auth: add https://room.mathvisionapp.com/** to Redirect URLs.
- Auth rate limits are shared with the app (one project), so the room's OTP sign-ins count against the same email-code limits.

## Roles

Seats are decided in SQL by two NEW helpers, STABLE SECURITY DEFINER like room_reaches:

- room_access(p_session_id uuid, uid uuid) returns text: 'host' when session_requests.assigned_teacher_id = uid (whatever the role: a staff member who teaches is a host) and mode = 'online' and status in ('confirmed', 'completed') and now() is between effective_start minus 15 minutes and coalesce(ends_at, effective_start + duration_minutes) plus 30 minutes; 'learner' when student_id = uid in the same window; 'observer' when is_admin(uid) or is_incharge_of(department_id, uid) or (is_support(uid) and reads_the_roster(uid)); else null.
- manages_course(p_course_id uuid, uid uuid) returns boolean: is_admin(uid) or an active staff profile with department_members.is_incharge whose department is courses.department_id or appears in routing_rules for that course.

| Role (mv-app) | In the app | In the room (room/) | Not allowed |
| --- | --- | --- | --- |
| parent | Child screen (app/family/child/[id].tsx) gains Consents (lesson_consents toggles, granted_by = parent, shares_family checked) and a "Progress & practice" link that opens the room's progress page by ticket; published reports as today; pushes for new practice and reports | Progress page for their child (/home/progress/<student_id>) | No seat in a 1-1 lesson (joining as the child would be faking identity); no transcripts, drafts, notes |
| student | Sessions as today; tests and practice open in the browser by ticket | learner seat; own notebook; at-home practice; timed tests; own progress | Drafts, transcripts, notes, other students, answer keys |
| teacher | Write tab (app/(tabs)/write.tsx, titled "My sessions" by src/lib/roleTabs.ts) lists online lessons from NEW my_online_lessons(p_days) with Join and Brief; app/reports/new.tsx prefilled from lesson_report_drafts; own coaching feedback | host seat (Daily owner token: record, transcribe); brief panel; activity panel (quick checks, oral check); may approve a follow-up, which hands it to the in-charge | Roster, family list, student_notes (CLAUDE.md: office-only), other teachers' sessions, posting to a family (can_message_family refuses teachers: it is is_admin or works_the_front_desk or room_reaches(family, null, true, uid)) |
| in-charge (role staff with department_members.is_incharge on an academic room) | Follow-up approval queue (NEW app/lessons/followups.tsx), decide_report as today, tasks in the existing Tasks tab, notes via add_student_note | observer seat; question bank review and syllabus editing for courses where manages_course; transcripts, metrics, recordings for sessions in their rooms; decide_report from the brief panel (graft) | Courses outside manages_course; students outside room_reaches |
| support (administrative team, works_the_front_desk) | Reads child_progress summaries to answer calls; receives no_join tasks if the room pools them | observer seat only when reads_the_roster | Transcripts, recordings, drafts, question bank |
| admin | All of the above; lesson_course_materials mapping (NEW app/admin/materials.tsx); room flags per department; AI usage; retention | Everything | |
| ambassador | Nothing new | Nothing | |

Scope for in-charges is never copied: courses, schools and grades reach a room through routing_rules and courses.department_id (route_booking), and students through room_reaches(p_family_id, p_student_id, p_require_head, uid). Every lesson_ policy uses those helpers, not is_staff().

Three widenings in this table need the owner's explicit yes and will show in widening.sh: a teacher reads a curated brief that includes the last three PUBLISHED reports for their student and course (today session_reports_select gives a teacher only reports on their own sessions); in-charges read transcripts and recordings of lessons in their rooms; support reads progress summaries. Note that CLAUDE.md line 155 ("Teachers see messages and nothing else") is already stale: the Write tab exists and is backed by my_taught_sessions. The widening asked for is the brief, not the tab.

## Sessions seam

**The booking is the lesson.** There is no lessons table. An online session booked in app/sessions/new.tsx, by the family, or keyed in the portal and mirrored by import_portal_sessions, is a session_requests row with mode = 'online'. Nothing else can create one, so the portal stays the record for roster. A lesson "created only on the web" is refused by design: room/src/app/lesson/[sessionId]/page.tsx returns 404 unless session_requests holds the id and room_access is non-null; an ad-hoc lesson is booked by the office in the app (booked_by_centre, mode online) and reaches the portal through sync_outbox like every booking.

### Turning a room on

NEW table lesson_platform_rooms(department_id pk -> departments, enabled_at, enabled_by). No column is added to departments or courses (both are upserted by the sync daemon's directory pass; a table of our own cannot be nulled by it). NEW RPC enable_lesson_platform(p_department_id, p_on) (admin only) inserts or deletes the row and, when turning on, backfills meeting_url = ROOM_URL || '/lesson/' || id on that department's future online sessions whose meeting_url is null. NEW trigger session_requests_the_room_link, BEFORE INSERT only (never on UPDATE, so a cleared value is never silently refilled, the fault both judges found in A), stamps the same URL on new online sessions in enabled departments; its name sorts after session_requests_apply_routing so department_id is already set. meeting_url is not in enqueue_session_sync's payload, so the portal is untouched. Departments without the flag keep Zoom plus breakout exactly as today.

In app/sessions/[id].tsx, when meeting_url is on the room host: the Join button uses the ticket, the "Join the class link, then head to breakout room N" caption is hidden, and the "Different link for this session only" field and its "Remove override" button (lines 549 to 586, a direct .update({ meeting_url })) are hidden so an in-charge cannot clear the room away (graft from B). A staff-typed Zoom link on a session that was pasted before the flag is never overwritten by the backfill.

### Room, seats and tokens

NEW table lesson_rooms(session_id pk -> session_requests on delete cascade, provider 'daily', room_name unique 'lesson-<session_id>', room_url, created_at, opened_at, closed_at, recording_enabled bool, transcript_status none|pending|ready|failed), created lazily by room-ticket on the first host or learner ticket through ensureRoom (room/src/lib/video/daily.ts, unchanged, private room, 6 hour expiry). Daily meeting tokens are minted by room/src/app/api/lesson/[sessionId]/video/route.ts after rpc room_access says host (owner token) or learner/observer (guest). meeting_url is never replaced with the Daily URL (useless without a token).

### Attendance write-back (the one place the app decides attendance)

Nothing in mv-app sets arrived_at for online sessions today: sweep_no_shows skips mode = 'online' ("an online seat is never not arrived"), and the only writers of arrived_at are import_portal_checkins, import_portal_checkin_deletions, carry_extended_arrivals and adopt_walk_in. Without arrived_at, my_taught_sessions returns nothing for online lessons, sessions_to_report and sweep_report_nudges never nudge, and ask_support's "taught them" arm refuses the teacher. So the room must write it. Two doors:

- lesson_join(p_session_id) NEW, user-invoked, SECURITY DEFINER, caller must be the learner per room_access. It sets local app.push_quiet = '1', then arrived_at = coalesce(arrived_at, now()), no_show = false, lesson_rooms.opened_at. It passes the 17 BEFORE UPDATE triggers on session_requests (23 non-internal triggers in all; the number 20 in the panel was wrong) because guard_session_edit only engages when a reschedule column changes (requested_start, duration_minutes, course_id, mode, is_ia, is_ee) and arrived_at is not one; enqueue_session_sync compares status, confirmed_start, requested_start, assigned_teacher_id, teacher_cleared_at, duration_minutes, mode, course_id, subject, department_id, student_id, student_name, topic, notes, is_ia, is_ee and breakout_room, none of which move, so nothing is pushed to the portal. send-push has no builder that fires on arrived_at alone (buildNoShowNotification returns [] once arrived_at is set), so an unquiet write would cost one wasted invocation, not a family push; push_quiet is still set for the cost.
- import_lesson_room_facts(p_rows jsonb) NEW, for Daily webhooks arriving with no user (graft from B). SECURITY DEFINER, revoke execute from public, anon and authenticated, grant to service_role; sets app.portal_import = '1' and app.portal_news = '' first; per row: event 'joined' (party student) writes arrived_at = coalesce(arrived_at, at); 'left' or 'ended' writes departed_at = greatest(coalesce(departed_at, at), at); it writes nothing else, ever. Because its name starts with import_, the existing RLS section 20260901060029-an_import_door_that_writes_where_a_push_lives_says_so.sql (which selects functions where proname like 'import\_%' and checks for app.portal_import) covers it automatically; a probe asserts by regex over prosrc that it never names status, confirmed_start, requested_start or assigned_teacher_id, and that authenticated has no EXECUTE. guard_session_edit and guard_session_address return early when auth.uid() is null, so this door is unguarded by construction and must stay this narrow. room/ has exactly one module that can reach it (room/src/lib/mv/door.ts) and a source-shape test that nothing else in room/ imports a privileged client for writes.
- lesson_end(p_session_id, p_segments jsonb) NEW, host or in-charge: departed_at = now(), lesson_rooms.closed_at, lesson_transcripts from the segments the room held, then invoke_edge_function('lesson-finalize', { session_id }). status is NOT changed in v1: status is in enqueue_session_sync's change list and would push a 'session' row to wp_schedule, and the live portal applier's acceptance of an app-side 'completed' is unverified (portal/mv-app-cron.php treats it as stamp-only, but docs/PORTAL-CRON.md says the live portal does not run that reference code). Whatever closes online sessions today keeps doing it; this is an open question.

Consequences that become true on purpose: online lessons appear on the teacher's Write tab, get report nudges, and the teacher's ask_support door works. The portal remains the record where it has one: a later wp_enter keyed by the office for the same booking makes import_portal_checkins overwrite arrived_at and may set status 'completed' (verified in its body), and that is the record winning as CLAUDE.md wants. The booking pull (mapPortalBooking in sync/src/transform.ts) carries no meeting_url, arrived_at or departed_at, so the 20-second pull cannot overwrite the room's writes. Following the house pattern for app-written facts the portal cannot yet take, lesson_join queues sync_outbox entity 'session_attendance', added to HELD_ENTITIES in sync/src/push.ts next to 'session_report' (hand deploy on the droplet). The held backlog will show in the day-old discrepancy ledger; that is noise, not a fault, and the owner may prefer not to queue it (open question).

### No-join signal (graft from A)

sweep_no_shows ignores online sessions, so there is no online no-show signal today. NEW sweep_lesson_no_joins() raises, for a confirmed online session 10 minutes past effective_start in an enabled room with no learner join, a message_tasks row (department_id = session.department_id, note = 'Student has not joined the online lesson', student_id, family_id, due_at = now()), and the same for a missing host with 'Teacher has not joined'. The existing message_tasks push trigger buzzes the room's in-charges and sweep_due_tasks chases it; no new queue. pg_cron jobs are scheduled by hand in the SQL editor (every migration that mentions cron.schedule does so in a comment or notice; shim.sql stubs auth, storage, net.http_post and vault, not cron), so this is a RUNBOOK step, not a migration.

### Reschedule, cancel, reassign

All in the app or portal as today. room_access reads the live row, so a cancelled session has no seats, a moved one moves its window, a reassigned teacher changes who is host. Reminders stay mv-app's (sweep_session_reminders).

### Realtime

The notebook and presence sync moves from Supabase Realtime broadcast (online-lms src/lib/notebook/use-notebook-sync.ts, channel notebook:<id>) to Daily's app-message channel, so a lesson adds no Supabase sockets. The teacher's live view of a timed test uses one postgres_changes subscription on practice_attempts (added to the supabase_realtime publication, RLS-filtered). docs/SCALE.md section 3 names no quota; it estimates 300 to 500 concurrent on a Monday evening and says to check the plan's ceiling. Treat the ceiling as unknown, not as 300.

## Data model

All in mv-app's public schema. Every table has RLS on, writes go through RPCs, every FK into an existing table is named. Status columns are text with CHECK constraints, not enums, to avoid enum churn. No column is added to session_requests, session_reports, profiles, messages, courses or departments. One column is added to retention_settings (app-owned, not synced).

### Room and lesson

| Table (NEW) | Columns | Read / write |
| --- | --- | --- |
| lesson_platform_rooms | department_id pk -> departments, enabled_at, enabled_by -> profiles | read: authenticated; write: enable_lesson_platform (admin) |
| lesson_tickets | id, token_hash unique, user_id -> profiles, session_id -> session_requests, purpose join|test, attempt_id -> practice_attempts null, expires_at, redeemed_at, created_at | RLS on, no policies, revoke all from anon and authenticated (the portal_session_notes pattern); swept hourly by sweep_lesson_tickets() |
| lesson_rooms | session_id pk -> session_requests cascade, provider, room_name unique, room_url, created_at, opened_at, closed_at, recording_enabled, transcript_status | read: room_access not null; write: room-ticket (service role), lesson_join, lesson_end |
| lesson_notebooks | id, student_id -> profiles, course_id -> courses, tldraw_snapshot jsonb, updated_at, unique(student_id, course_id) | student self; assigned teacher of a session for that student and course within the window; manages_course; admin |
| lesson_consents | student_id -> profiles, kind recording|transcript|ai_analysis|integrity_camera, granted_by -> profiles, granted_at, revoked_at, pk(student_id, kind) | parent inserts and revokes where shares_family(student_id); family reads own; staff read |
| lesson_transcripts | session_id pk -> session_requests, segments jsonb, word_count, created_at | assigned teacher (own sessions), is_incharge_of(department_id), admin; families none (deliberate) |
| lesson_metrics | session_id pk, teacher_talk_pct, student_talk_pct, question_count, open_question_pct, avg_wait_ms, student_turns, praise_count, computed_at | same as transcripts |
| lesson_feedback | session_id pk, summary, strengths text[], suggestions text[], dimension_scores jsonb, moments jsonb, created_at | assigned teacher (own), reports_to_id chain for in-charges, admin |
| lesson_events | id bigserial, session_id, at, kind, payload jsonb, actor_id | append-only; same readers as transcripts |
| lesson_recordings | session_id pk, provider_recording_id, storage_path (bucket lesson-recordings), duration_s, expires_at, deleted_at | family when lesson_consents.recording granted, assigned teacher, in-charge, admin |
| lesson_report_drafts | session_id pk, draft jsonb (submit_report's parameters), rationale, source ai|heuristic, created_at, used_at; CHECK draft->>'prev_hw' in the nine strings or null; CHECK draft->>'otr' in the bands 5..95 or null | assigned teacher, in-charge of the department, admin |
| lesson_followups | id, session_id, student_id -> profiles, family_id -> families, department_id -> departments, kind win|concern|misconception|logistics|exam_upcoming|ask_to_relay|tech_issue, action share_with_parent|staff_task|note_for_next_lesson|staff_call, priority, title, detail, quote, at_ms, suggested_parent_message, status proposed|approved|dismissed|done, decided_by, decided_at, message_task_id -> message_tasks, note_id -> student_notes, message_id -> messages, created_at | assigned teacher reads and dismisses own; is_incharge_of(department_id) and admin read and approve |
| lesson_course_materials | course_id pk -> courses, materials_course_id uuid, mapped_by, mapped_at | read: staff and teachers; write: admin (graft from A, instead of a column on the synced courses table) |
| ai_usage | id, user_id, kind coach_live|analyze|report_draft|followup_extract|question_extract, model, tokens_in, tokens_out, session_id, at | admin only; replaces online-lms rate_limits |

### Syllabus and progress

| Table (NEW) | Columns | Read / write |
| --- | --- | --- |
| syllabus_topics | id, course_id -> courses, grade_level text, label, parent_id, sort_order, course_topic_id -> course_topics null, is_active | read: anyone enrolled or staff; write: manages_course, admin; seeded once by seed_syllabus_from_course_topics(course). Distinct from course_topics, which is only the booking form's option list |
| syllabus_progress | student_id -> profiles, syllabus_topic_id, status not_started|introduced|practised|secure|needs_work, evidence jsonb, source report|practice|teacher, updated_at, updated_by, pk(student_id, syllabus_topic_id) | shares_family(student), the student, room_reaches(family, student, false), assigned teacher of a session for that student and course, admin |
| session_report_topics | report_id -> session_reports, syllabus_topic_id, pk(both) | written by link_report_topics; readers as session_reports |

### Practice and tests

| Table (NEW) | Columns | Read / write |
| --- | --- | --- |
| practice_questions | id, course_id -> courses, syllabus_topic_id null, type mcq|multi_select|numeric|short|worked, stem (markdown + LaTeX), options jsonb, answer jsonb, tolerance, unit, difficulty 1..5, marks, worked_solution, image_path (bucket practice-images), source jsonb {kind pdf|generated|manual, file_id, page, parent_question_id}, status draft|approved|retired, created_by, reviewed_by, reviewed_at | approved: anyone with student_courses on the course, shares_family of such a student, staff; draft: manages_course, admin; answer and worked_solution are masked for students through a view |
| practice_extractions | id, course_id, worksheet_file_id, answer_key_file_id, title, hints, status queued|running|done|failed, result jsonb, usage jsonb, requested_by, finished_at | manages_course, admin |
| practice_sets | id, course_id, kind practice|quick_check|test, title, syllabus_topic_id, time_limit_minutes, integrity_settings jsonb, status draft|live|retired, created_by | manages_course, admin; teachers read live sets for their courses |
| practice_set_items | set_id, question_id, sort_order | as practice_sets |
| practice_assignments | id, set_id, student_id -> profiles, session_id -> session_requests null, assigned_by, due_at, mode in_session|at_home, created_at | student, family, assigner, in-charge, admin; insert via assign_practice |
| practice_attempts | id, assignment_id, set_id, student_id, session_id null, started_at, submitted_at, time_limit_minutes, score, out_of, integrity_flagged, integrity_summary jsonb, status in_progress|submitted|marked|void | student (own), family (own child, marks only), assigner, in-charge, admin |
| practice_answers | attempt_id, question_id, response jsonb, is_correct, marks_awarded, marked_by, feedback, answered_at, pk(attempt_id, question_id) | as attempts |
| practice_integrity_events | id bigserial, attempt_id, at, kind fullscreen_exit|visibility_hidden|window_blur|resize|paste|devtools|snapshot, detail, snapshot_path (bucket test-snapshots) | student insert only via log_integrity_event (never update or delete); teacher, in-charge, admin read |
| homework_submissions | id, session_id (the session that set it), student_id, kind notebook|file, storage_path (bucket homework), submitted_at, verified_by, verified_at, mark, feedback | student and family own; assigned teacher; in-charge; admin |

### Columns added to existing tables

- retention_settings.recording_months integer (picked from a list in the admin screen, probe asserts the default).

### Buckets (private, each policy with a bucket_id predicate)

lesson-recordings, test-snapshots, practice-images, homework. All four are listed for storage-cleanup and sweep_retention in the same PR that creates them, and delete-account (today it removes only attachments per conversation and relies on the auth.users cascade) is extended to remove objects under the deleted student's paths and to ask Daily to delete recordings.

### RPCs (NEW, all SECURITY DEFINER, all with negative RLS assertions)

room_access, manages_course, redeem_lesson_ticket, sweep_lesson_tickets, enable_lesson_platform, lesson_room_state, my_online_lessons, lesson_join, lesson_end, import_lesson_room_facts, lesson_brief, approve_followup, dismiss_followup, sweep_lesson_no_joins, sweep_lesson_retention, worker_store_analysis (used by lesson-finalize, service role, sets app.push_quiet for backfills), link_report_topics, set_topic_status, seed_syllabus_from_course_topics, child_progress, approve_question, retire_question, generate_variants, assign_practice, start_attempt, answer_question, mark_answer, submit_attempt, log_integrity_event, my_academic_seat. Triggers: session_requests_the_room_link (BEFORE INSERT), syllabus_mark_from_report (AFTER UPDATE OF status on session_reports, wrapped in an exception block like notify_push so it can never fail submit_report, decide_report or import_portal_reports), syllabus_mark_from_attempt (AFTER UPDATE on practice_attempts).

### Retired from online-lms (all 25 tables)

profiles, parent_student, courses, enrollments, teacher_course (-> mv-app profiles, families, courses, student_courses, teacher_students); sessions, teacher_availability (-> session_requests, available_teachers); notebooks (-> lesson_notebooks); consents (-> lesson_consents); transcripts, session_metrics, live_events, teacher_feedback (-> lesson_transcripts, lesson_metrics, lesson_events, lesson_feedback); reports (-> session_reports); homework (-> session_reports.homework, practice_assignments at_home, homework_submissions); followups (-> lesson_followups plus message_tasks and student_notes); outbound_messages, notifications, push_tokens (-> mv-app messages, notify_push, push_tokens; WhatsApp Cloud API deleted); audit_log (-> record_audit); rate_limits (-> ai_usage); account_requests, enrollment_requests (-> mv-app approvals, child_requests, enrolment_change_requests); credit_balances, credit_ledger (dropped). Also retired: the Expo companion app in online-lms/mobile, /api/mobile/*, /api/cron/reminders, /forgot-password, /reset-password, /request-access, the teacher availability screens and every booking action, and supabase/migrations 0001 to 0016.

## Reports

Per-session reports only, written into session_reports through the one existing door, submit_report(p_session_id, p_topic, p_topic_completed, p_understanding, p_otr, p_gp, p_prev_hw, p_homework, p_remarks, p_written_tests, p_has_upcoming_tests, p_topics_not_done), by the real teacher or in-charge from the app's existing form. The room never writes session_reports.

### The draft

lesson_end invokes supabase/functions/lesson-finalize/index.ts (NEW, Deno, service role), which computes lesson_metrics, runs the ported post-session analysis (online-lms src/lib/coaching/analyze.ts -> lesson_feedback), extracts follow-ups (ported src/lib/followups/extract-parse.ts, whose kinds and actions are already the ones in lesson_followups), and drafts the report with the ported src/lib/reports/draft-session-report.ts. This is a port, not a rewrite: online-lms's draft schema already emits topic, topic_completed, topics_not_done, understanding, otr, gp, prev_hw, homework, remarks, written_tests and has_upcoming_tests, and src/lib/reports/mvapp-template.ts ("Mirrors mv-app/src/lib/reportFields.ts; keep the two in step") already carries the nine prev_hw strings, GP quarters and OTR bands with tests. The normalisers move to supabase/functions/_shared/reportDraft.ts with no Deno imports so __smoke__ can test them like _shared/familyAudience.ts.

Inputs: transcript, metrics, teacher quick-notes typed in the room (lesson_events kind teacher_note), in-session practice_attempts for the session, the booking's topic and the course's course_topics labels and syllabus_topics, the previous published report's homework and homework_submissions state, and signs := author is staff, support or admin, or a teacher with report_auto_approve (the same v_signs_it test submit_report makes).

Field rules, enforced in the draft and again by the database:

| Field | Rule | Enforced by |
| --- | --- | --- |
| topic | required; one of the course's course_topics labels when one fits, else the booked topic; a pick list in the form | submit_report raises 'A report needs the topic that was taught.' |
| understanding | required, 1 to 10; proposed from metrics and notes, always confirmed by the teacher | session_reports_understanding_check |
| gp | only when signs; quarters 1 to 7; hidden otherwise (submit_report ignores a GP it is not owed) | session_reports_gp_check; submit_report requires it when signing |
| otr | only when the room recorded an oral quick check (band lower bound 5..95); never inferred from talk | session_reports_otr_check is only 0..100, so the draft table carries its own band CHECK and the form offers only bands |
| prev_hw | one of the nine portal strings or null; proposed from homework_submissions; chips from src/lib/reportFields.ts, never retyped | session_reports_prev_hw_check refuses any other string (the panel's claim that nothing validates it was wrong) |
| written_tests | [{name, score, out_of, percent}] from in-session quick checks and tests | submit_report shape |
| has_upcoming_tests | true when an exam_upcoming follow-up exists; teacher confirms | report_published_side_effects copies it to the session |
| topics_not_done | only when topic_completed is false | submit_report nulls it otherwise |
| remarks, homework | the parent-facing paragraph and the homework text, in the existing warm tone | free text |

The 1 to 5 rating and needs_followup of the old draft are dropped: GP is the grade, parents rate through rate_session, and follow-ups are rows.

### Writing and approval

The teacher opens app/reports/new.tsx?session=<id> (the existing form) from the Write tab row or from the room's "Write the report in the app" button (a universal link to https://mathvisionapp.com/sessions/<id>, which the app already captures). The form prefills from lesson_report_drafts under RLS, shows the rationale collapsed, and calls submit_report as today. Every existing rule applies unchanged: 'reports are written by the room' (42501) for anyone but staff, support, admin or the assigned teacher; publish now when signing, else pending for decide_report(p_report_id, p_publish, p_note, p_gp) by is_incharge_of(department_id) or admin; 'this session's report has already gone to the family'; 'another colleague is already writing this report'. report_published_side_effects queues sync_outbox 'session_report' (held in HELD_ENTITIES until the portal applier gains it, exactly as app-written reports are today) and the existing session_reports push triggers tell the family and the in-charge. In-charges can also decide from the room's brief panel (graft), which calls the same decide_report. Then link_report_topics(p_report_id, p_topic_ids) writes session_report_topics and syllabus_mark_from_report marks syllabus_progress.

The app's form is the habit for online lessons; the room never offers a second editor, so the second-author refusal cannot bite.

## Follow-ups and notifications

lesson-finalize inserts lesson_followups with status proposed under app.push_quiet (the extractor's output: win, concern, misconception, logistics, exam_upcoming, ask_to_relay, tech_issue, each with an action and a quote with its timestamp). Nothing reaches a family or a task list until a person with the right mv-app role approves it, through the door that role already has. NEW RPC approve_followup(p_id, p_text, p_assignee):

| Action | Who may approve | What is created | Push |
| --- | --- | --- | --- |
| share_with_parent | can_message_family(family) holders: admin, front desk, or in-charge whose room_reaches with require_head | start_family_direct(p_family_id, p_subject, null, array[student_id], null) then insert into messages(conversation_id, sender_id = auth.uid(), body). The sender is the approving in-charge as a person, because messages.sender_id is NOT NULL, must equal auth.uid() under RLS, and there is no system sender; the body is the teacher's suggested wording edited by the approver, prefixed "From <teacher first name>'s lesson today:". handle_new_message routes and claims the thread to that in-charge if unowned (existing office-side behaviour, worth telling the owner) | the messages INSERT trigger pushes the family with deep link https://mathvisionapp.com/chat/<id> |
| staff_task, staff_call, exam_upcoming, logistics, tech_issue | in-charge or admin | message_tasks(department_id = session.department_id or assigned_to, assigned_by = auth.uid(), student_id, family_id, note = title + detail + "AI-extracted from the lesson transcript; verify before acting", due_at = now() + due_in_days), the way schedule_call_back inserts conversation-less tasks | message_tasks INSERT trigger; sweep_due_tasks chases |
| note_for_next_lesson | staff or admin (add_student_note refuses everyone else) | add_student_note(p_body, p_student_id, null, null, null, p_applies_to_next => 2); notes_for_student surfaces it to the office, not the teacher | existing |
| concern | created at once by lesson-finalize, no human wait | message_tasks in the department pool: wellbeing goes to a staff call, never an automatic message | existing |

A teacher may approve too; that only moves the row to approved and pushes the in-charge to send it. Every created id is written back onto the row (message_task_id, note_id, message_id). Dismiss and snooze stay on lesson_followups. No WhatsApp, email or SMS from anywhere; every family-facing word is an in-app message from a named person or a push from an mv-app trigger.

New push-triggered tables (notify_push wired in the migration): lesson_report_drafts INSERT (the assigned teacher: "Your report draft is ready"), practice_assignments INSERT (student and household by the familyAudience rules), practice_attempts UPDATE to submitted (assigner or in-charge), lesson_followups UPDATE proposed to approved (the in-charge; recipient rule copied from sweep_report_nudges' decider half: department_members.is_incharge, role staff, support or admin, deactivated_at null). Each is added in all three places __smoke__/push-triggers.test.ts compares (the migration, the "What notifies, and how" table in docs/DEPLOYMENT.md, the send-push header), and each send-push case is isolated at the end of the chain in the 4,095-line supabase/functions/send-push/index.ts with its own source-shape test in the style of a-named-teammate-is-buzzed.test.ts. Writers that are backfills, not news, set app.push_quiet: lesson-finalize's rows for sessions older than a day, seed_syllabus_from_course_topics, practice-extract's draft questions.

## Practice, syllabus and progress: where each piece lives

The judges' first graft from A: ship the practice and progress surfaces in the browser first, reached by the same ticket, so they do not wait for a LaTeX DOM component, a native build and a store cycle. Native screens come afterwards if the owner wants them.

| Feature | Lives in | Reached by | Later |
| --- | --- | --- | --- |
| Question bank authoring and review (LaTeX, wide layout) | room/ at /bank (ported online-lms src/lib/practice) | desk or app link by ticket; direct login | stays web |
| PDF plus answer-key extraction | supabase/functions/practice-extract (fetches both files through POST /api/v1/files/{id}/view-url as X-Acting-Role teacher, sends them to Claude with the ported extract-parse rules, writes draft practice_questions and crops stem images to practice-images, records ai_usage) | queued from /bank | |
| Syllabus editor | room/ at /syllabus/<course> | ticket | stays web |
| In-session quick checks and the oral check | the room's activity panel (ported activity-panel; assign_practice with mode in_session; answers through answer_question; results feed the draft's written_tests and otr) | in the lesson | |
| At-home practice (auto-marked mcq, multi_select, numeric, short; worked questions wait for mark_answer by the teacher or in-charge) | room/ at /home/practice | "Practice" row on the app's Sessions tab (student) and Children tab (parent) by ticket; push on assignment | native app/practice/* with a MathView DOM component (needs build.yml) |
| Timed tests with integrity | room/ at /test/<attempt_id> only (ported src/lib/integrity/engine.ts: fullscreen and camera required, visibility, blur, fullscreen exit, paste and devtools events through log_integrity_event, camera snapshots only when lesson_consents.integrity_camera is granted, timer pauses, flagged at severity 6 or 4 events; teacher watches live over practice_attempts realtime) | 'test' ticket from the app, which says "Tests open in the browser so the timer and full-screen rules can be enforced" | stays web by design |
| Flagged-test review | room/ at /tests/<attempt_id> | ticket | |
| Pre-lesson brief | lesson_brief(p_session_id): session_requests.topic, notes and staff_note (already in the teacher's RLS row), syllabus_progress for this course, open practice and homework state, last three PUBLISHED reports' topic, understanding, homework and prev_hw for this student and course (the widening), never student_notes | the room's side panel and the Write tab row (text only, native) | |
| Parent and student progress | child_progress(p_student_id, p_course_id): topics covered by status per course, practice volume last 30 days, weak areas (needs_work or under 60% over at least 3 questions), recent tests with scores and a "reviewed by the centre" line instead of the event log, published reports | room/ at /home/progress/<student_id> from the child screen by ticket | native Progress section in app/family/child/[id].tsx calling the same RPC |
| Consents | app/family/child/[id].tsx Consents section (lesson_consents) | native, OTA | |
| Follow-up approval | app/lessons/followups.tsx (in-charge), existing Tasks tab | native, OTA | |

syllabus_progress is derived three ways: syllabus_mark_from_report on published reports (introduced, practised when topic_completed), syllabus_mark_from_attempt on submitted attempts (secure at 80% or better over at least 3 questions, needs_work under 60%), and a teacher override set_topic_status from the room's activity panel.

Keeping the "no second inbox" rule: room/ holds no queues, threads or task lists. Anything that needs a person to act (approve, decide, chase) is in the app.

## Materials

The materials portal (material, own Supabase) stays separate and is reached only server-to-server through its read API: GET /api/v1/courses, GET /api/v1/courses/{id}/tree, POST /api/v1/files/{id}/view-url (60-second signed URL, no download), with Authorization: Bearer MATERIALS_PORTAL_SERVICE_KEY and X-Acting-Role (lib/api/auth.ts, ACTING_ROLES = student | teacher | in_charge | admin; X-Acting-Email is informational only). Two callers hold the key, never the app bundle:

1. The room's route handlers room/src/app/api/materials/{tree,view-url}/route.ts (ported from online-lms src/lib/materials/portal.ts), acting role from the mv-app profile through the shared mapper: admin -> admin; staff with is_incharge on any academic room (my_academic_seat()) -> in_charge; teacher, or a staff host -> teacher; student -> student; parent -> student; support and ambassador -> no materials panel.
2. supabase/functions/materials-proxy/index.ts (NEW) for the Expo app (the admin mapping screen and, later, a materials row on the teacher's lesson card), verifying the caller JWT and mapping the role with the same _shared/materialsRole.ts.

Course mapping lives in lesson_course_materials (graft from A), set by an admin in app/admin/materials.tsx from GET /api/v1/courses through the proxy (search-then-pick, never typed). Teacher-only material (eff_teacher_only) is pruned by the portal for the student role. Practice extraction references portal files by file_id in practice_questions.source and never copies a PDF; only cropped stem images live in practice-images. Nothing in the materials repo changes.

## Repo ownership, migrations and CI

### Ownership

Everything lives in mv-app. SQL only in supabase/migrations/, each file stamped by supabase/new-migration.sh <slug> (UTC-second version, never renumbered; re-stamp only if a dependency landed above while the branch was open), each with supabase/probes/<version>.sql asserting the thing it was for, each with an RLS section from supabase/tests/new-rls-section.sh under supabase/tests/rls/ that owns its own begin and commit, uses act_as(), test_ok() and raises_matching() from _prologue.sql, and carries negative assertions (a parent in another family cannot open the room; a teacher not assigned cannot read a transcript; a student cannot start an attempt not assigned to them; log_integrity_event cannot delete; a ticket does not redeem twice; authenticated cannot execute import_lesson_room_facts; support cannot approve a question).

DDL obeys the run-twice rule enforced by __smoke__/a-new-migration-can-be-run-twice.test.ts: create table, add column and create index if not exists; drop policy and trigger if exists before create; functions create or replace; any changed existing function re-emitted from pg_get_functiondef() against the scratch database. None of submit_report, decide_report, add_student_note, start_family_direct, assign_message_task or schedule_call_back is edited; new behaviour is new RPCs and triggers. migrations-covered.test.ts requires the probe file.

### Testing

Locally: PGPASSWORD=postgres PGHOST=localhost PGUSER=postgres bash supabase/tests/run.sh (drops and recreates mathvision_test from shim.sql plus every migration, runs the rls/ directory), npm run check, npm run check:db. checks.yml's Database job does the same on every PR, builds the probe ledger with supabase/build-checker.sh and fails on "::error::A probe ... says NO", prints the permission matrix and runs supabase/tests/widening.sh so each new grant is a loud line for the reviewer (expect many; that is the point). The smoke suite (npm run test:smoke) renders every new screen under app/lessons, app/admin/materials and the changed app/sessions, app/reports and app/family screens as every role against an empty world and must exit 0 (no stray timers). New edge functions are typechecked by the functions job; pure modules in supabase/functions/_shared (reportDraft.ts, materialsRole.ts, followupRules.ts) get jest tests in __smoke__. NEW __smoke__/the-join-button-carries-a-ticket.test.ts asserts the session screen never opens a room-host URL without a ticket and hides the override field and breakout caption for room-host URLs.

room/ is a subdirectory with its own package.json (not an npm workspace, so the root npm ci is untouched), trimmed from online-lms to src/app/{join,lesson/[sessionId],test/[attemptId],bank,syllabus,home/practice,home/progress,tests,mfa,login}, src/app/api/{join,lesson,coach,materials}, src/components/lesson, src/lib/{video,notebook,coaching,integrity,practice,syllabus,brief,materials,supabase,data,mv}. Its vitest files (integrity, metrics, coach, practice-marking, practice-variants, syllabus-progress, brief-compose, mvapp-template, draft-session-report) run in a NEW checks.yml job "Room: typecheck and tests" (cd room && npm ci && npx tsc --noEmit && npx vitest run). room/ regenerates its TypeScript types from the schema.sql release asset (supabase/build-schema.sh output; schema.sql is generated, not committed) and feature-detects RPCs so it tolerates running one schema version behind, because release.yml ships migrations on merge while the room ships separately.

### Deploys

- Migrations and edge functions: release.yml on merge to main, staging then production. functions.yml's secret check gains DAILY_API_KEY, DAILY_WEBHOOK_SECRET, ANTHROPIC_API_KEY, MATERIALS_PORTAL_URL, MATERIALS_PORTAL_SERVICE_KEY, ROOM_URL, ROOM_REDEEM_SECRET. daily-webhook joins the NO_JWT list ("portal-notify signup-household" today) because Daily signs with its own HMAC, which the function verifies.
- App JavaScript: update.yml (OTA) with channel and message. No native build is needed for the first phases: practice is in the browser, so no DOM component, and room links are on a separate host, so no new universal-link prefixes in app.config.ts.
- Desk: Vercel builds it on every merge from vercel.json (docs/DESK.md); desk.yml is the dispatch-only artefact path and is not needed for this work.
- Room: a NEW dispatch workflow room.yml modelled on desk.yml, with a Vercel project rooted at room/. Vercel env: NEXT_PUBLIC_SUPABASE_URL and ANON_KEY of the mv-app project, ROOM_REDEEM_SECRET, DAILY_API_KEY, ANTHROPIC_API_KEY, MATERIALS_PORTAL_URL, MATERIALS_PORTAL_SERVICE_KEY. No service-role key.
- Sync daemon: by hand on the droplet, one change (HELD_ENTITIES += 'session_attendance' in sync/src/push.ts) with a case in sync/test.
- pg_cron: scheduled by hand in the SQL editor and recorded in docs/RUNBOOK.md: mv-lesson-tickets (hourly sweep_lesson_tickets), mv-lesson-no-joins (every 5 minutes sweep_lesson_no_joins), mv-lesson-retention (daily sweep_lesson_retention).
- Supabase dashboard: Auth redirect URL room.mathvisionapp.com/**, Daily webhook URL pointing at daily-webhook, the secrets above. The service-role key gains no new holder; its holders stay Vault 'service_role_key' (read by invoke_edge_function), the edge functions and the sync daemon's config.

## Build sequence and effort

One engineer who knows the mv-app house rules. Days are working days.

| Stage | Work | Days |
| --- | --- | --- |
| 1 | Hand-off spike: lesson_tickets, lesson_platform_rooms, room_access, redeem_lesson_ticket, sweep_lesson_tickets, enable_lesson_platform and the BEFORE INSERT room-link trigger, with probes and RLS sections; room-ticket and room-redeem edge functions; room/src/app/join and /api/join; prove the same user lands in the room under RLS from a phone (openBrowserAsync) and from the desk; MFA re-challenge for team roles; audit line per redemption | 3 |
| 2 | Room on mv-app's schema: fork online-lms into room/, delete bookings, availability, people, WhatsApp, mobile API, credits; point /lesson/[sessionId] at session_requests through lesson_room_state; lesson_rooms, lesson_join, lesson_end, import_lesson_room_facts with the prosrc probe; Daily token route on room_access; lesson_notebooks with sync over Daily app-messages; materials panel with the role mapper and lesson_course_materials; app/sessions/[id].tsx Join branch with Zoom fallback and hidden override; my_online_lessons on the Write tab; OTA. **First value: a real online lesson runs in the room, attendance lands on the booking, the teacher's Write tab lists it** | 5 |
| 3 | Transcript, draft, follow-ups: lesson_transcripts, lesson_metrics, lesson_feedback, lesson_events, ai_usage; lesson-finalize with _shared/reportDraft.ts; lesson_report_drafts with its CHECKs and the prefill in app/reports/new.tsx with chips from reportFields.ts; link_report_topics; lesson_followups, approve_followup, dismiss_followup, the concern auto-task, app/lessons/followups.tsx; sweep_lesson_no_joins; send-push cases in all three places; RLS sections with negatives | 6 |
| 4 | Consent and recording: lesson_consents and the Consents section in app/family/child/[id].tsx; recording enabled only with consent; daily-webhook storing to lesson-recordings through worker RPCs and import_lesson_room_facts; lesson_recordings RLS; retention_settings.recording_months and sweep_lesson_retention with a probe on the default; delete-account and storage-cleanup extended | 3 |
| 5 | Syllabus and progress: syllabus_topics with the seed, syllabus_progress triggers, session_report_topics, child_progress, lesson_brief, the room's brief panel with decide_report for in-charges, the Write tab brief, /syllabus editor and /home/progress in room/, the Progress and Practice links in the app | 5 |
| 6 | Question bank: practice_questions, practice_extractions, practice_sets, practice_set_items, manages_course, approve_question, retire_question, generate_variants, materials-proxy, practice-extract with practice-images, /bank in room/, app/admin/materials.tsx | 6 |
| 7 | Practice: practice_assignments, practice_attempts, practice_answers, homework_submissions, assign_practice, start_attempt, answer_question, mark_answer, submit_attempt; /home/practice in room/; the activity panel with quick checks and the oral check feeding otr and written_tests; push on assignment | 5 |
| 8 | Timed tests with integrity: /test/[attemptId], practice_integrity_events, log_integrity_event, test-snapshots bucket, 'test' tickets from the app, teacher live view over practice_attempts realtime, /tests review page | 4 |
| 9 | Hardening and shipping: smoke tests for every new screen as every role, widening review with the owner, stress against supabase/tests/stress-sessions.sql volumes, ai_usage caps, docs (SCREENS.md, DEPLOYMENT.md, SHIPPING.md room section, RUNBOOK.md cron lines, LESSONS.md), room.yml, OTA, staging soak with the sync daemon running, enable the first department, retire online-lms after a read-only export | 4 |

Total about 41 engineer-days, 8 to 9 weeks. First value after stages 1 and 2 plus the OTA and a staging soak: about 2.5 weeks. Stages 6 to 8 should each be re-confirmed with the owner before they start ("build less than asked").

## What mv-app must change (exact list)

1. Migrations, each stamped by supabase/new-migration.sh with a probe and an RLS section: lesson_platform_rooms, lesson_tickets, lesson_rooms, lesson_notebooks, lesson_consents, lesson_transcripts, lesson_metrics, lesson_feedback, lesson_events, lesson_recordings, lesson_report_drafts, lesson_followups, lesson_course_materials, ai_usage, syllabus_topics, syllabus_progress, session_report_topics, practice_questions, practice_extractions, practice_sets, practice_set_items, practice_assignments, practice_attempts, practice_answers, practice_integrity_events, homework_submissions; the RPCs and triggers listed under Data model; retention_settings.recording_months; buckets lesson-recordings, test-snapshots, practice-images, homework with storage.objects policies next to attachments, avatars and office_documents; alter publication supabase_realtime add table practice_attempts; notify_push wiring for lesson_report_drafts INSERT, practice_assignments INSERT, practice_attempts UPDATE and lesson_followups UPDATE.
2. Edge functions: room-ticket, room-redeem, lesson-finalize, practice-extract, materials-proxy, daily-webhook (NEW); send-push/index.ts new isolated cases and header rows; _shared/reportDraft.ts, materialsRole.ts, followupRules.ts; functions.yml NO_JWT += daily-webhook and the secret check list.
3. App: src/lib/env.ts and app.config.ts extra.roomUrl (EXPO_PUBLIC_ROOM_URL); src/lib/lessons.ts (openLessonRoom, openRoomPage with Zoom fallback); app/sessions/[id].tsx Join branch, hidden override and breakout caption for room-host URLs; app/reports/index.tsx online lessons with Join and Brief; app/reports/new.tsx prefill from lesson_report_drafts and link_report_topics; app/family/child/[id].tsx Consents and the Progress & practice link; app/(tabs)/sessions.tsx and children.tsx Practice rows; NEW app/lessons/followups.tsx and app/admin/materials.tsx; a room toggle in app/admin/departments.tsx; src/types/db.ts; docs/SCREENS.md.
4. Tests and docs: __smoke__/the-join-button-carries-a-ticket.test.ts; smoke renders for every new screen; push-triggers rows in docs/DEPLOYMENT.md; docs/SHIPPING.md room section; docs/RUNBOOK.md cron lines; NEW docs/LESSONS.md (hosting, env, the per-department flag, what the room may write, secret holders and rotation).
5. room/ subdirectory with its own package.json and a checks.yml job; room.yml dispatch workflow; Vercel project rooted at room/.
6. sync/src/push.ts HELD_ENTITIES += 'session_attendance' with a sync/test case; hand deploy on the droplet.
7. Supabase dashboard by hand: Auth redirect URL, Daily webhook URL, cron.schedule for mv-lesson-tickets, mv-lesson-no-joins and mv-lesson-retention, the new function secrets.
8. OTA through update.yml for the app changes. No native build in the first phases.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Every lesson migration rides the production release train (release.yml), and "never edit an applied migration" means mistakes are corrected forward | Probes and RLS sections per migration; stages re-confirmed one at a time; the per-department flag means a bad room feature affects only enabled rooms |
| syllabus_mark_from_report runs inside submit_report, decide_report and import_portal_reports; if it raises, reports stop publishing and the portal import fails | Exception block like notify_push, warning plus a failures row; a probe that a raising body cannot block a publish |
| Online attendance becomes app-first and the portal has no door for it; a later portal tap overwrites it; the held 'session_attendance' backlog shows in the discrepancy ledger | Written down in docs/LESSONS.md; the portal wins by design; the owner decides whether to queue at all (open question) |
| import_lesson_room_facts is unguarded by construction (guards exit when auth.uid() is null) | Writes exactly three columns; prosrc probe; the import-door RLS rule; one write module in room/ with a source-shape test |
| send-push regressions from new cases in a 4,095-line function | Cases isolated at the end of the chain, each with a __smoke__ source-shape test; push-triggers test keeps the three places in step |
| A forgotten app.push_quiet on a backfill is the 118,781-notification failure CLAUDE.md records | Every backfill writer named here sets it; the RLS section covers import_% doors; lesson-finalize's worker RPC sets it for old sessions |
| Ticket minting relies on auth.admin.generateLink plus verifyOtp(token_hash), a supported but indirect pattern | Tickets single-use with a 2-minute TTL; the room's own sign-in is the fallback; the Zoom link is the fallback for the lesson; audit line per redemption; test that ticket.user_id equals the minted session's sub |
| Team accounts are aal2 in the app and a minted session is aal1 | /mfa once per browser for staff, support and admin; families and students are untouched |
| In-app browser media: Daily needs camera and microphone inside SFSafariViewController and Custom Tabs | Test on the centre's real devices in stage 1; fallback is the system browser, which the ticket still signs in |
| Realtime ceiling unknown (SCALE.md: 300 to 500 concurrent estimated, plan ceiling to be checked) | Notebook and presence over Daily app-messages, not Supabase; one subscription per open timed test only |
| AI on transcripts of minors: transcription accuracy for maths vocabulary, drafts that invent understanding or otr, follow-ups that misread tone | Every draft passes through a human (submit_report, decide_report, approve_followup) except the concern task, which is still only a task; otr only from an oral check with a CHECK on the draft table; ai_usage caps per department |
| Recording minors: the legal half (PDPA, consent wording, retention period) is the owner's | Settled before stage 4; lesson_consents and retention_settings.recording_months with a probe on the default; delete-account extended in the same PR as the first bucket |
| Storage policies for four new buckets sit next to attachments, avatars and office_documents | Every policy carries a bucket_id predicate; RLS section asserts a policy without one does not exist |
| alter publication supabase_realtime add table practice_attempts exposes change events to any client whose RLS lets it select | Negative RLS tests on practice_attempts before the publication change lands |
| New policies written with is_staff() hand support and every staff member the question bank or transcripts | manages_course, room_reaches and is_incharge_of only; widening.sh output is read in review |
| Short-answer marking is naive and worked questions wait for a human; unmarked attempts pile up on teachers | Mark queue on the Write tab row; in-charge can mark too |
| The desk web build is phone-width; bank authoring with LaTeX would be cramped there | Authoring lives in room/ (web, wide) |
| Two deploy pipelines over one schema (release.yml and room.yml) | room/ feature-detects RPCs and runs one version behind safely; types from the schema.sql asset |
| Timezones: SQL sweeps assume Asia/Singapore; an online student abroad needs the room to honour session_requests.time_zone | The room renders times in the session's time_zone; nudges stay centre-time in v1 (noted in LESSONS.md) |
| The scope is large for a codebase whose rule is "the smallest thing that answers the request" | Stages 6 to 8 are re-confirmed with the owner before they start; first value is stages 1 and 2 |

## Open questions for the owner

1. Online attendance: do you accept that the lesson room becomes the record of arrival for online sessions (it writes session_requests.arrived_at because the portal has no online tap-in and the teacher's report list, nudges and ask_support all key on it), that a later portal wp_enter wins, and that a HELD 'session_attendance' outbox entity waits until the PHP applier gains it? Or should nothing be queued until the portal side exists? And should lesson_end set status 'completed' the way sweep_no_shows and import_portal_checkins do, or leave status to the portal (this design leaves it)?
2. Three widenings need your explicit yes: a teacher reads a curated brief that includes other teachers' PUBLISHED reports for their student and course; in-charges read transcripts and recordings of lessons in their rooms; support reads progress summaries. May student_notes stay office-only?
3. Is the app's existing report form the habit for online lessons' reports (this design), with the room offering only a link to it? submit_report refuses a second author, so there must be one habit.
4. Minors' data: who grants consent (parent only, or a student with their own login), what retention period for recordings and transcripts (a picked option with a probe on the default), what the privacy page says, and must delete-account purge transcripts, recordings and webcam snapshots? Settled before stage 3 and 4.
5. Practice in the browser first (room/, reached by ticket, days to ship) and native later, or wait for the native build and store cycle? This also decides whether parents see the progress page on the web before it is native, which is a small exception to DESK.md's phones-only rule for families.
6. Rollout per department with the centre Zoom link as the fallback on any error: which rooms go first? When a room is on, should staff still be able to paste a Zoom link for one session (this design keeps a pre-pasted link and hides the override field for room-host links)?
7. In-app browser media must be tested on the centre's actual student phones and tablets before stage 1 ends; who provides them?
8. Who builds this: the mv-app house (SQL, RLS, Expo, probes, RLS sections) or the Next.js team that wrote online-lms? The answer changes the realistic effort more than the architecture does.
9. AI and transcription spend: Daily transcription plus two Claude passes per online lesson across the online share of 400 to 1,500 sessions a day; what monthly cap, and is a per-department cap in ai_usage enough?
10. pg_cron jobs are scheduled by hand in the SQL editor; who runs and records that step for staging and production, or should the no-join sweep ride an existing scheduled sweep instead of being a new job?
11. Which screen is the habit for the no-join signal: a message_task to the room's in-charges (this design) or the front desk pool?
12. Retiring online-lms: permission to export and shut its Supabase project, delete the WhatsApp Cloud API path, the Expo companion app and /api/mobile, and tell the few people who used it that the app is the door.
13. Secrets: this design keeps the service-role key inside Supabase edge functions and gives Vercel only the anon key plus the Daily, Anthropic and materials keys. Confirm, and name who rotates the materials key and DAILY_API_KEY.