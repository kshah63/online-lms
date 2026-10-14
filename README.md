# MathVision — the online lesson room

The browser "room" of the MathVision centre app: the live lesson (Daily video, a shared
tldraw notebook, the course materials beside it, the live coach and the activity panel),
plus the few screens that are better in a browser — the teacher's day with its brief and
report drafts, coaching, the family's reports and progress, and the office's board.

**This app runs on the MathVision centre app's Supabase project; see `docs/INTEGRATION.md`.**
It holds no schema of its own: every table and RPC it touches (`my_profile`,
`my_online_lessons`, `lesson_room_state`, `lesson_join`, `lesson_end`, `submit_report`,
the `lesson_*` tables) lives in mv-app's `supabase/migrations/`.

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind · `@supabase/ssr` · tldraw ·
Daily · Luxon · vitest · pnpm.

---

## Quick start (demo mode — no setup)

With **no Supabase keys configured**, the room runs in **demo mode**: a built-in dataset in
mv-app's shapes (profiles with mv roles and a family, departments, courses, course_topics,
online session_requests, session_reports, lesson_report_drafts, lesson_followups) and a
persona switcher stand in for real auth + Postgres, so every screen is explorable offline.

```bash
pnpm install
pnpm dev
# open http://localhost:3000 → pick a persona
```

Demo personas (ids are stable so scripts can set the `demo_persona` cookie directly):

| Role (mv-app)     | Name          | Id suffix | Sees                                                        |
|-------------------|---------------|-----------|-------------------------------------------------------------|
| admin             | Admin Office  | …01       | Board (every room), coaching QA, follow-ups, question bank for every course |
| staff (in-charge) | Grace Lim     | …d1       | Board (Online Mathematics), coaching QA, follow-ups, question bank and syllabus |
| support           | Ravi Menon    | …d2       | Board, observer seat                                        |
| teacher           | Maya Chen     | …a1       | Today, brief, host the room, report drafts, coaching        |
| teacher           | Daniel Okafor | …a2       | Same, with a lesson later today                             |
| student           | Sofia Rossi   | …b2       | Join the live lesson as the learner, reports, progress      |
| student           | Aarav Sharma  | …b1       | Upcoming lessons, reports, progress                         |
| parent            | Priya Sharma  | …c1       | Aarav's lessons (no seat in the room), reports, progress    |
| parent            | Marco Rossi   | …c2       | Sofia's lessons, reports, progress                          |

> In demo mode, **mutations aren't persisted** (a banner makes this clear).

---

## Going live

This app runs on the MathVision centre app's Supabase project; see `docs/INTEGRATION.md`.

```bash
cp .env.example .env.local
# NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY of the mv-app project,
# ROOM_REDEEM_SECRET (shared with the room-redeem edge function), then the optional
# DAILY_*, ANTHROPIC_API_KEY, MATERIALS_PORTAL_* and Sentry keys.
pnpm dev
```

The presence of `NEXT_PUBLIC_SUPABASE_URL` flips the app out of demo mode. The login screen
then shows the app's two doors — families and students by six-digit email code, the team by
email (or portal username) and password, then their authenticator — and lessons opened from
the app arrive by ticket at `/join` with no sign-in at all. There is no service-role key:
everything the room reads comes back under RLS or from a SECURITY DEFINER RPC, and the only
write to a booking's report is `submit_report`.

---

## Screens

| Route | Who | Reads |
| --- | --- | --- |
| `/lesson/[sessionId]` | host, learner, observer | `lesson_room_state`; writes `lesson_join`, `lesson_end`, `save_lesson_notebook`, `log_lesson_event`; the activity panel: `create_practice_set(quick_check)`, `assign_practice(in_session)`, `upsert_question` (one-off draft), `live_attempts` + postgres_changes on practice_attempts, `log_lesson_event` kind quick_check_result |
| `/teacher` | teacher | `my_online_lessons(14)`: today, coming up, recent, each with Join in the window, the brief, and the report state |
| `/teacher/brief/[sessionId]` | teacher (host), in-charge and admin (observers) | `lesson_brief_facts` + `my_online_lessons` + `lesson_room_state` → `composeBrief`; the host marks topics through `set_topic_status`; `lesson_recordings` for the Recording link |
| `/teacher/reports`, `/teacher/reports/[sessionId]` | teacher | lessons awaiting a report; the editor prefilled from `lesson_report_drafts`, submitted through `submit_report` |
| `/teacher/coaching`, `/coaching/[sessionId]` | teacher, office | `lesson_feedback`, `lesson_metrics`, `lesson_transcripts`, `lesson_events` |
| `/home`, `/home/reports` | student, parent | `my_online_lessons`, published `session_reports` (with the Recording link when `lesson_recordings` is readable) |
| `/home/progress`, `/home/progress/[studentId]` | student, parent (own / each child); in-charge, support, admin by ticket or the students list | `child_progress(p_student_id, p_course_id)` mapped through `src/lib/syllabus/from-rpc.ts`; courses from `session_requests.course_id` under RLS; a course picker when there is more than one |
| `/settings/consents` | student, parent | `lesson_consents` under RLS, read-only (managed in the MathVision app) |
| `/api/lesson/[sessionId]/recording` | anyone `lesson_recordings` lets read | selects the row under RLS, asks Daily for a short-lived access link with `DAILY_API_KEY`, redirects; `/recordings/demo` in demo mode |
| `/admin` | admin, in-charge, support | `my_online_lessons(1)` as an observer |
| `/admin/coaching`, `/admin/followups` | office | `lesson_feedback` per teacher; `lesson_followups`, read-only (decided in the app) |
| `/admin/teachers/[teacherId]` | admin, in-charge (the teacher's room head); support and a wrong-room in-charge see the refusal | `teacher_scorecard(p_teacher_id, p_days)` over 30 / 90 / 180 days: lessons taught, punctuality, coaching averages, reports, follow-ups, ratings, the ten newest lessons; linked from each teacher on `/admin/coaching` |
| `/bank` | admin, in-charge (`manages_course`) | `practice_questions`, `practice_sets`, `student_courses` under RLS; writes `upsert_question`, `approve_question`, `retire_question`, `store_extracted_questions`, `create_practice_set`, `assign_practice`; images to `practice-images` |
| `/syllabus/[courseId]` | admin, in-charge | `syllabus_topics`; writes `seed_syllabus_from_course_topics`, `upsert_syllabus_topic` |
| `/home/practice` | student, parent | `my_practice(30)`; the student opens an attempt (`start_attempt`), a parent sees marks only |
| `/home/practice/[attemptId]` | student | `attempt_questions` → `answer_question` per answer → `submit_attempt`, then the rows with answers and solutions |
| `/test/[attemptId]` | student | the timed test, full screen: `log_integrity_event` for every engine event, snapshots to `test-snapshots/<uid>/<attempt>/<ts>.jpg`, `submit_attempt` with the summary; given an assignment id it is the entry page and starts the attempt on Begin |
| `/tests/[attemptId]` | teacher, in-charge, admin | `flagged_attempt_review` + `attempt_questions`, signed snapshots, `void_attempt` |

Everything that needs a person to act — booking, staffing, approving a report or a
follow-up, messaging a family — is in the MathVision app. The room holds no second queue.

## Commands

```bash
pnpm dev          # next dev (demo mode without keys)
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest
pnpm build        # next build
```

## Project structure

```
src/
  app/
    (app)/                 authenticated shell (sidebar by mv role)
      admin/ teacher/ home/ coaching/   role screens
    lesson/[sessionId]/    the live room (full screen)
    join/ · api/join/      the ticket hand-off from the app
    login/ · mfa/ · account/  the two sign-in doors, the TOTP step, the account gate
    api/materials/         server proxy to the materials portal
    api/lesson/.../video   Daily tokens, gated on the seat
  components/lesson/       video, notebook (tldraw), materials, activity, room
  components/teacher/      the centre-format session report editor
  lib/
    data/                  the data layer: RPCs and RLS reads, with the demo fallback
    actions/               server actions (lesson_join / lesson_end, submit_report, notebook)
    demo/data.ts           the demo dataset in mv-app's shapes
    lessons/window.ts      the room's join window (mirrors room_access, for links only)
    brief/ · reports/ · coaching/ · practice/ · syllabus/   pure modules, unit-tested
docs/INTEGRATION.md        the decision record this app follows
```
