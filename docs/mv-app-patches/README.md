# The mv-app side of the lessons platform, as patches

These nine patches are the commits on mv-app's local branch
`claude/lesson-platform`, made on top of `main` at `ff45881` (13 Oct 2026).
mv-app could not be pushed from the session that wrote them (the repository
was attached read-only and merging there deploys migrations to staging and
production by itself), so they travel here until a branch on mv-app exists.

To recreate the branch:

```sh
cd mv-app
git checkout -b claude/lesson-platform ff45881   # or origin/main, then resolve
git am ../online-lms/docs/mv-app-patches/*.patch
```

Then, before opening the PR, exactly what CLAUDE.md asks for:

```sh
npm ci && npm run check                                   # lint, schedule, tracker, smoke (must exit 0)
PGPASSWORD=postgres PGHOST=localhost PGUSER=postgres bash supabase/tests/run.sh   # 278 sections
```

What the patches hold, in order:

| Patch | What becomes true |
| --- | --- |
| 0001 | Edge functions room-ticket, room-redeem, daily-webhook; functions.yml deploys the webhook without JWT verification and warns on missing room secrets |
| 0002 | Migrations 20261013152315 and 20261013152316: the per-department switch, tickets, rooms, seats (`room_access`), the booking's arrival and departure written by the room and nothing else |
| 0003 | Migration 20261013155425: drafts, follow-ups, metrics, feedback, recordings, ai_usage; `worker_store_lesson_results`, `approve_followup`, `dismiss_followup` |
| 0004 | The app: Join on a ticket, the Write tab's online lessons, the admin's per-room switch, `EXPO_PUBLIC_ROOM_URL` |
| 0005 | Migration 20261013163422: syllabus, teacher marks, `child_progress`, `lesson_brief_facts`, the no-join and retention sweeps |
| 0006 | Migration 20261013170702: the question bank, sets, assignments, attempts, answers marked in SQL, the integrity log, the two buckets |
| 0007 | Migration 20261013163945 and the lesson-finalize function: a lesson that ends asks for its draft |
| 0008 | The four send-push cases, the transcript hook in daily-webhook, recordings-cleanup |
| 0009 | Migration 20261013174253 (`host_joined_at`, `lesson_host_join`), the docs, the cron rows, CLAUDE.md's lessons |

Every migration was replayed onto a fresh scratch database with the whole
RLS suite (278 sections, all passing), every probe says yes, each migration
applies twice, and `npm run check` (lint, schedule, tracker, 230 smoke
suites) exits 0, in the session that produced them.
