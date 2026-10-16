# MathVision Lessons — 1-1 Online Tutoring Platform

A web platform for live one-to-one online tutoring: scheduling, a **Pencil Spaces** classroom
(video + collaborative whiteboard) embedded next to our Materials panel, recorded lessons that feed
AI coaching for teachers and post-lesson reports for parents, homework, follow-ups, WhatsApp outreach,
and an admin schedule/assignment console.

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase (Postgres + Auth + Realtime) ·
**Pencil Spaces** (classroom, recordings, transcripts) · Luxon (timezones) · Materials Portal API ·
tldraw (homework canvas only, until Phase 3).

---

## Quick start (demo mode — no setup)

With **no Supabase keys configured**, the app runs in **demo mode**: a built-in dataset and a persona
switcher stand in for real auth + Postgres, so every screen is explorable offline. The lesson room
renders a **mock Space panel** (no Pencil key needed) with a "Simulate student joins" button.

```bash
pnpm install
pnpm dev
# open http://localhost:3000 → pick a persona (Admin / Teacher / Student / Parent)
```

Demo personas:

| Role    | Name          | Timezone         | Sees                                                        |
|---------|---------------|------------------|-------------------------------------------------------------|
| Admin   | Admin Office  | Asia/Singapore   | Daily schedule board, scheduling & assignment, people, audit |
| Teacher | Maya Chen     | Asia/Singapore   | Today's lessons, the classroom, coaching, reports           |
| Student | Aarav Sharma  | Asia/Singapore   | Upcoming lessons, join the classroom, homework, reports     |
| Parent  | Priya Sharma  | Asia/Singapore   | Their child's lessons (status only), homework and reports   |

> In demo mode, **mutations aren't persisted** (a banner makes this clear). Connect Supabase to go live.
> Demo student Lena Park is the seeded **recording opt-out** example.

---

## Going live with Supabase

1. Create a Supabase project and copy the keys into `.env.local`:

   ```bash
   cp .env.example .env.local
   # set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
   # and SUPABASE_SERVICE_ROLE_KEY (required for Pencil Spaces — see below)
   ```

2. Apply the schema, policies, and seed. Using the Supabase CLI:

   ```bash
   supabase db reset       # runs supabase/migrations/* then supabase/seed.sql
   ```

   Or paste the files in `supabase/migrations/` (in order) and `supabase/seed.sql` into the SQL editor.
   Migration `0017_pencil_spaces.sql` adds the Pencil tables; the seed creates one `status='mock'`
   Space per enrolment, which is upgraded in place the first time a real Pencil key is configured.

   **Turn off self-signup** (Supabase dashboard → Authentication → Sign In / Providers → "Allow new
   users to sign up" OFF; `enable_signup = false` in a CLI `config.toml`). Accounts are provisioned
   by admins (`/admin/people`, account requests). Since `0017` a self-signed-up user is only ever a
   `student` — the signup trigger ignores any `role` in the caller-controlled metadata — but they
   should not exist at all.

3. Run it:

   ```bash
   pnpm dev
   ```

   The login screen switches from the persona picker to a real email/password form. Seed accounts all
   use the dev password **`password123`** (e.g. `admin@lessons.dev`, `maya@lessons.dev`,
   `aarav@lessons.dev`). The presence of `NEXT_PUBLIC_SUPABASE_URL` is what flips the app out of demo mode.

4. Add the Pencil Spaces key (`PENCIL_SPACES_API_KEY`) once the Pencil-side prerequisites below are
   done. Without it the classroom stays on the mock panel; nothing else changes.

---

## The classroom — Pencil Spaces

The live lesson room (`/lesson/[sessionId]`) is a **Pencil Space** embedded next to our Materials panel.
Our Supabase DB stays the schedule of record (sessions, assignment, credits, reports, homework,
follow-ups); Pencil only learns about **users** and **Spaces**. All Pencil code is server-only
(`src/lib/pencil/*`) and every call made with the institution API key sits behind an explicit
authorization check (`canJoinLesson` / `canEnterSpace` / `canHostSpace` / `requireRole('admin')`),
because Row Level Security does not protect the service-role client.

**Users.** Every profile that must enter a Space (student, teacher, admin) gets a Pencil API user
lazily, on first need (`POST /users/createAPIUser`, `externalId = profiles.id`). Students are sent
their **first name only**; staff their display name. The mapping lives in the service-only table
`pencil_users`. **Parents get no Pencil user and no seat in the room** — they see a status card
(teacher, elapsed time, recording status) on the lesson page and "Lesson in progress" / "Recorded"
on their dashboard instead of a Join button.

**Spaces.** One persistent Space per **(student, course)**, created lazily by `ensureSpace()` with
`externalId = '<course_id>:<student_id>'`, title `'<course> · <first name>'`, private, hosts = the
assigned teacher (plus an admin actor), participant = the student. Recovery after a failed insert
looks the Space up by `externalId` before creating, so no duplicate is ever made. The first join of a
pair takes a short **provisioning lease** on the `pencil_spaces` row (`provision_lock_until`), so a
teacher and student opening the first lesson at the same moment never create two users or two
Spaces — the second request waits for the first. Hosts follow the assignment: the assigned teacher
and an admin who opens the lesson are seated on join (`PATCH /spaces/{id}/updateUsers`), and
reassigning a lesson (`assignTeacher`) seats the new teacher and **removes the previous one** once
they have no other non-cancelled lesson and no open homework for that pair (audited
`pencil.space.hosts_changed {added, removed}`). Cached state lives in `pencil_spaces` (hosts,
recording flag, verification timestamps), so a normal join makes exactly one Pencil call (plus one
read-back of the Space settings for an opted-out student).

**Join flow.** The page renders from the DB only (no Pencil calls in the server component, and no join
URL ever appears in HTML or the RSC payload). The client calls `POST /api/lesson/[id]/space`, which
re-applies the access rule, rate-limits (`pencil:join:<profile>` 30/h; the `rl_check` limiter is
service-role only, so nobody can exhaust someone else's bucket), provisions only when rows are
missing or stale, mints `GET /users/{id}/authorize?redirectUrl=<Space link + params>` (5 s timeout, no
retry) and returns `{url}`. The client sets `iframe.src` on desktop or opens a new tab (Redirect mode) on
mobile/unsupported browsers. **Authorize URLs are credentials**: valid 3600 s, minted per click, never
persisted, logged or audited (the audit row `pencil.join` carries `{spaceId, purpose, mode}` only). The
lesson clock (`actual_start`) starts only when the **student** is present (`participant_join` with the
student's Pencil id), never on the teacher alone. The teacher starts the call; a student who arrives
first waits on the board, because lesson links leave out `skipCallHostCheck` (with it a participant
can start a call alone, which always-on recording would record and bill). "End lesson" marks the
session `completed` (one credit) or **"Mark as no-show"** (never billed) and makes no Pencil call:
Pencil's `endOngoingSession` ends only the analytics session, not the call or the recording. Instead
every open room polls `GET /api/lesson/[id]/status` every 15 s and unmounts its Space once the
lesson is over, so everyone leaves the call (a Space tab the room opened is closed with it); Pencil
closes its session six minutes after the last participant leaves or becomes inactive. A Space tab whose
lesson page is gone stays in the call until that tab is closed.

**Second device for writing (iPad + laptop).** On a coarse-pointer device the lesson page offers
**"Join the call here"** and **"Use this device for writing"** (opens the Space with
`standalone=true&mode=whiteboardonly`, in a new tab: no call controls and no join prompt on that
device). Each tap re-mints its own URL. Three rules are left: never open the Space twice on one device,
close the writing tab when the lesson ends (our End cannot close it), and turn the device's volume down
if it plays the call (Pencil has not said whether a whiteboard-only device does). Pencil counts call participants by who joins the call, bills and records attendance per user,
and a whiteboard-only device never starts or stops a recording, so nothing in our data model changes.

### Recording policy (opt-out) and teacher AI evaluation

- **Lessons are recorded (audio + whiteboard; "Record participant video" OFF) unless the family asks us
  not to — from Phase 2.** Institution-level **always-on** recording is switched on at the start of
  Phase 2 by our own institution admin (the plan must include it), outside lesson hours and at least
  3 h before the next lesson, together with `PENCIL_RECORDING_ENABLED=on`. Until that flag is on **nothing is recorded and
  no screen says so**: session cards, the lesson header, the student notice and the parent status
  card show "Recorded (audio + board)" only when the flag is on (the lesson header also reacts to a
  live `recording_status_change`, e.g. if the institution mode is changed in Pencil); an opted-out student always shows
  "Not recorded". The opt-out machinery is already live in Phase 1 so the setting is in place before
  any recording starts.
- **Opt-out** is an admin action (`/admin/people` → "Opt out" / "Resume recording", `setRecordingOptOut`).
  It writes the service-only `recording_opt_outs` row, pushes `disableAlwaysOnRecording` to **every
  Space** of that student (`PATCH /spaces/{id}/settings/`) and **confirms by read-back**
  (`GET /spaces/{id}`); only a confirmed read-back sets `pencil_spaces.recording_disabled`. An opted-out
  student whose Space is not yet confirmed gets a **hard stop** on joining ("Recording policy not
  applied — contact admin") and the policy is re-applied on the next join. Every join re-checks: a
  cached flag that disagrees with the policy (either direction) is re-applied, and an opted-out
  student's join reads the Space settings back once, so a setting flipped in Pencil's own UI is caught
  before anyone enters. The setting takes effect from the **next call** and does not stop a recording
  that is already running (Pencil support, 2026-10-16). So once recording is switched on, opting out
  while one of the student's lessons may be in a call shows the admin a warning and raises an admin
  follow-up: the teacher ends that call and starts a new one, and the pipeline deletes its recording
  when Pencil delivers it. Every change is audited (`student.recording_opt_out`).
- **Teacher AI evaluation is mandatory.** Every teacher's recorded lessons are analyzed (Pencil's
  transcript + our Claude coaching, arriving with Phase 2); nothing is gated on a consent row. The
  policy is stated on the request-access form and in the teacher onboarding copy: *"Lessons are recorded
  and AI-evaluated for coaching; this is a condition of teaching on MathVision."* The historical
  `consents` table is kept for records only and gates nothing.

### Outage fallback — Zoom (runbook)

Pencil outage, rate-limiting or a configuration error must never cancel a lesson. The fallback is **one
master Zoom meeting link for the whole school**:

| Setting | Where | Meaning |
|---|---|---|
| `LESSON_FALLBACK_URL` | server env | The school's master Zoom link (`https://` + a `zoom.us` host). Nothing is stored per teacher. |
| `sessions.fallback_join_url` | DB, admin per-lesson override | Any https link for one lesson — also the escape hatch when two lessons fall back at the same time and would otherwise share one Zoom meeting. |
| `LESSON_FALLBACK_MODE` | server env, `on` / `off` | `on` forces **every** lesson onto its fallback link (planned outage). |

Resolution order: `sessions.fallback_join_url` → `LESSON_FALLBACK_URL` → "No backup link — contact admin".

1. **Automatic.** When the join route fails with a transient Pencil error (429 / 5xx / timeout) or the
   join is rate-limited, the room shows **"Classroom unavailable — Retry / Join on Zoom"**; Materials
   stays usable; **End lesson** still works (status and `actual_end` only — no Pencil call) and marks
   the lesson `analysis_status='no_recording'`, so the report editor shows "Not recorded — write from
   your notes". No transcript or coaching exists for a Zoom lesson.
2. **Planned / prolonged outage.** Set `LESSON_FALLBACK_MODE=on` in the hosting env and redeploy or
   restart; every room now renders the Zoom card directly. Set it back to `off` afterwards.
3. **Two lessons at once on Zoom.** Set `sessions.fallback_join_url` for one of them to a second meeting
   link (admin SQL/console) so the two lessons don't share a room.
4. **Never unset `PENCIL_SPACES_API_KEY` as the outage path** — the post-session pipeline (Phase 2) must
   keep processing lessons that did run in Pencil.
5. Non-transient errors (401 `NOT_AUTHORIZED`, 400) are configuration bugs: check the key (regenerating
   or revoking it in Pencil kills the old key and signs the generic account out everywhere — update
   `PENCIL_SPACES_API_KEY` everywhere and redeploy), the base URL, that "Grant admins access to all
   Spaces" is still ON, and that the Space still exists; they are reported to Sentry without the URL or key.

### Pencil-side prerequisites (owner, before go-live)

From the integration plan (decision k):

- Plan tier: API access (Usage-based / Enterprise); AI Coach needs Advanced+, AI Summaries Expert+.
- Settings → Permissions → Recording = **Always-on** — **switched on at the start of Phase 2, not
  before**, by an institution admin (the plan must include always-on cloud recording);
  "Record participant video" **OFF**; local recording prevented; recordings admin/host-only.
- Settings → AI Assist: Coaching Insights ON, Session Summaries ON, Post-Session Emails **OFF** (or
  present hosts only — the generic API account is an invited host of every Space and is not an "API
  user", so "off for API users" would still mail it every summary); In Session → distraction
  notifications: owner decision (in Redirect mode they will fire whenever a student switches to our tab
  for Materials; whether a file opening in a new tab from the desktop room triggers them is a staging check).
- "Grant admins access to all Spaces" **ON** (Pencil's default): it lets the API account manage Spaces
  it is not a member of; the Spaces we create have it as a host anyway.
- Standalone branding for the embedded Space.
- Webhook URL + secret per environment (staging → preview URL, prod → `https://<app>/api/webhooks/pencil`)
  — consumed from Phase 2.
- A generic admin account that owns the API key (view-once; revoking or regenerating it signs that
  account out everywhere and stops the old key). Spaces are created without `owner`, so this account owns
  every Space and shows as a host in each one: give it a family-facing name (e.g. "MathVision"). Any
  teacher, including one who leaves, stays a removable host. Subscribe to Pencil's status page.
- Signed DPA / processor agreement covering recordings and transcripts of minors, confirmation of data
  region, and Pencil's own retention of derived artefacts after a recording is deleted.
- `SUPABASE_SERVICE_ROLE_KEY` set in **every** environment that runs Pencil: provisioning, join URLs,
  webhooks and jobs all run through the service role and are no-ops without it.
- The parent page must be served over **HTTPS** for the iframe (local dev: a trusted cert, e.g. `mkcert`
  + `next dev --experimental-https`). Pencil sets no `frame-ancestors`/`X-Frame-Options` and asks for a
  fresh token on every page load, because storage partitioning can stop a login carrying into the
  iframe (support 2026-10-16); the room mints one on every mount. Whether Safari (ITP) and Chrome with
  third-party cookies blocked then work inside the iframe is still to be tested; if the Space sends no
  `ready` within 15 s the room offers "Open in a new tab".

### Environment variables (Pencil)

| Variable | Required | Purpose |
|---|---|---|
| `PENCIL_SPACES_API_KEY` | for a real classroom | Institution API key. Unset → mock Space panel, no Pencil calls. |
| `PENCIL_API_BASE_URL` | no | Default `https://apis.pencilapp.com/public/api/`; staging `https://staging-apis.pencilapp.com/public/api/`. |
| `PENCIL_WEBHOOK_SECRET` | Phase 2 | Bearer secret Pencil sends with webhook deliveries; the webhook route fails closed (503) while empty. Pencil makes up to 10 delivery attempts for a non-2xx (gaps growing from 30 s to 10 min; no total given), then gives up, so set the secret before registering the URL. |
| `NEXT_PUBLIC_PENCIL_APP_ORIGIN` | no | Origin of the Space UI for the postMessage allowlist (production + staging are always accepted). |
| `LESSON_FALLBACK_URL` | recommended | Master Zoom link (see runbook). |
| `LESSON_FALLBACK_MODE` | no | `on` forces every lesson onto the fallback link. |
| `PENCIL_RECORDING_ENABLED` | Phase 2 | `on` once institution always-on recording is switched on in Pencil; until then no screen says "Recorded". |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** for Pencil | Service role used for all Pencil-related reads/writes after authorization. |

See `.env.example` for the full list (Materials Portal, Anthropic, WhatsApp, cron, Sentry).

---

## What's built

**Identity, roles, timezones, scheduling, assignment, the daily board**

- Supabase Auth + a `profiles` table with a first-class **IANA timezone** on every account.
  All times are stored in UTC and **rendered in each viewer's own timezone** everywhere (`src/lib/time.ts`).
- Four roles (admin / teacher / student / parent) with **Row Level Security** enforcing visibility
  (`supabase/migrations/0003_rls.sql`); `0017` closes the profiles self-update hole (role/email are
  admin-only), makes signup always create a `student`, limits a teacher's own-session update to the
  lesson-room columns (clock, agenda, status along the live path, `analysis_status` none →
  no_recording — never the student, course, teacher, times or links), makes the rate limiter
  service-role only, and adds the service-only Pencil tables. Check these with
  `tests/profile-guard.sql` and `tests/session-guard.sql` (see *Tests* below).
- **Admin daily schedule board** (`/admin`), **scheduling console** (`/admin/sessions`) with one-off or
  recurring lessons and per-session teacher assignment, **people directory** (`/admin/people`) with the
  recording-policy toggle and "Pencil linked" status, **audit log** (`/admin/audit`).
- **Teacher today** (`/teacher`) + **availability** (`/teacher/availability`).
- **Student/parent dashboard** (`/home`) + **reports** (`/home/reports`, published-only).

**The live lesson** (`/lesson/[sessionId]`) — see *The classroom* above.

- **Assigned-teacher-only join is enforced server-side**: a teacher can only enter a session where
  `teacher_id = caller`; others get an explicit access-denied screen. The same rule (`canJoinLesson`)
  is re-applied when minting the Pencil join URL, so the join endpoint is gated too.
- **Materials Portal integration** over the API boundary: a server-side proxy holds the service
  credential and passes the caller's effective course role so the portal gates teacher-only files.

**Reports — AI + teacher** (`/teacher/reports`)

- The teacher jots **quick notes**; AI drafts a parent-facing report from the notes + the lesson
  transcript + metrics (`src/lib/reports/draft.ts`, Claude, heuristic fallback). The teacher edits every
  field and **publishes** to the parent/student. On publish it can also assign homework and raise a
  follow-up. For lessons marked as having no recording (`analysis_status` `no_recording` after a Zoom
  fallback End; `skipped_opt_out` once the Phase 2 pipeline marks opted-out lessons) the editor shows
  "Not recorded — write from your notes" and drafts from the notes alone.

**Coaching dashboards** (`/teacher/coaching`, `/admin/coaching`, `/coaching/[sessionId]`)

- Strengths-first post-session feedback, dimension scores, trends, key moments and the transcript
  (`src/lib/coaching/metrics.ts`, `analyze.ts`). An **"analysis pending / not recorded"** strip is
  driven by `sessions.analysis_status`. Live in-lesson nudges were retired with the Pencil move.

**Homework — done & verified on the notebook** (`/hw/[id]`)

- Publishing a report with homework creates a `homework` item with a due date. The student works on a
  tldraw page, submits; the teacher verifies or sends it back (`/teacher/homework`). Overdue items feed
  the admin follow-up dashboard. *(Moves into the student's Pencil Space in Phase 3.)*

**Follow-up dashboard** (`/admin/followups`) and **WhatsApp** (`src/lib/messaging/whatsapp.ts`)

- Attendance gaps, no-shows, overdue homework, flagged reports and recording-policy warnings; resolve,
  snooze, or message the parent over the Meta WhatsApp Cloud API (simulated without credentials).

---

## Upcoming phases

The integration plan lives in [`docs/pencil-spaces/integration-plan.md`](docs/pencil-spaces/integration-plan.md)
(verified API facts in [`api-notes.md`](docs/pencil-spaces/api-notes.md)). Phase 1 — a real lesson in a
Pencil Space, parent status view, recording opt-out toggle, Zoom fallback, second-device mode — is what
this tree implements. Still to come:

- **Phase 2 — recording + post-session pipeline.** Institution always-on recording switched on;
  retention and opt-out deletion jobs (retention deletes a recording only after our transcript copy
  exists, because Pencil's transcript endpoint stops returning it after a delete; an opted-out
  student's recordings are deleted without copying anything — past ones 24 h after the opt-out, so a
  mistaken toggle can be undone);
  Pencil webhooks (`/api/webhooks/pencil`) as hints, a job queue drained by cron, transcript + Pencil
  AI Coach report + our Claude coaching stored per lesson, AI-pre-filled report drafts, AI follow-ups,
  teacher notifications. Tables `pencil_sessions`, `pencil_webhook_events`, `pencil_jobs` already exist
  from `0017` so this phase is additive.
- **Phase 3 — homework in the Space + mobile.** The tldraw homework canvas is replaced by a board in the
  student's Space (`standalone=true&mode=whiteboardonly`; Pencil has no board deep link, so the Space
  opens on the last-viewed board and the item names the board to switch to; a participant cannot start
  a call by default, so the time a student spends alone is not recorded, nor billed at default plan
  thresholds), mobile join via a bearer
  "space link" route, and the
  `tldraw` dependency is removed.
- **Phase 4 — recommended.** Pencil Events mirroring (session timer, attendance), recording playback for
  staff.

Also still stubbed: **Billing/Stripe** (credit balances exist and decrement on completion; checkout is
the remaining piece) and timed WhatsApp reminders beyond the existing cron.

---

## Tests

```bash
pnpm typecheck && pnpm test          # tsc + vitest (tests/*.test.ts, no database or network)
```

The vitest suites fake Pencil at the `fetch` boundary and the database with an in-memory PostgREST
look-alike (`tests/helpers/`), so they cannot see RLS or triggers. Those rules are checked against a
real database by two psql scripts, run after `supabase db reset`:

```bash
DB_URL="$(supabase status -o env | sed -n 's/^DB_URL=//p' | tr -d '"')"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f tests/profile-guard.sql   # role/email guard, signup role, rl_check grants
psql "$DB_URL" -v ON_ERROR_STOP=1 -f tests/session-guard.sql   # what a teacher may change on their own session
```

Each prints `ok …` per case and aborts on the first `FAIL: …`; both run inside a transaction that is
rolled back, so the seed data is untouched.

---

## Project structure

```
supabase/
  migrations/0001_schema.sql        full schema (all sections)
  migrations/0002_functions_triggers.sql  RLS helpers, credit consumption
  migrations/0003_rls.sql           row-level security by role
  migrations/0017_pencil_spaces.sql Pencil users/Spaces/opt-outs, session columns, ledger + job tables
  seed.sql                          demo users, a full day of sessions, mock Spaces, one opt-out
docs/pencil-spaces/                 integration plan, verified API notes, vendor OpenAPI spec
src/
  app/
    (app)/                          authenticated shell (sidebar by role)
      admin/  teacher/  home/        role dashboards
      coaching/[sessionId]/         coaching deep dive
    lesson/[sessionId]/             the classroom (Pencil Space + Materials), full screen
    api/lesson/[sessionId]/space/   POST: mints the per-click Pencil join URL (after canJoinLesson)
    api/materials/                  server proxy to the Materials Portal
    login/  request-access/         persona picker (demo) / sign-in (live); account requests
  components/ui/                     design system (button, card, dialog, select, …)
  components/lesson/                 space stage, mock Space panel, materials, room
  components/admin/                  admin controls (recording toggle, assignment, dialogs)
  lib/
    pencil/                         server-only Pencil client, authz, provisioning, URLs, mock
    time.ts                         UTC ⇄ timezone helpers (the bug-prone bit, centralised)
    supabase/                       browser + server + admin (service role) + middleware clients
    data/                           data-access layer (Supabase, with demo fallback)
    actions/                        server actions (schedule, assign, availability, people, auth)
    audit.ts  rate-limit.ts         append-only audit log, Postgres-backed rate limits
    materials/portal.ts             Materials Portal client (real portal or mock tree)
    demo/data.ts                    demo dataset mirroring seed.sql (incl. mock Spaces)
```

## Design notes

- **Timezones are first-class.** Everything is UTC in the DB; `src/lib/time.ts` renders per-viewer and
  computes day-windows so "today's sessions" is correct for any timezone.
- **Demo fallback.** Every data-access function tries Supabase and falls back to the demo dataset when
  no project is configured, and every Pencil function short-circuits to a deterministic mock when there
  is no key or in demo mode. This is a thin fallback, not a parallel mock architecture.
- **Credentials never render.** Pencil join URLs are minted inside POST/bearer routes and returned as
  JSON; they never appear in server-rendered HTML, logs, audit rows or Sentry.
- **The Materials boundary stays clean.** The lessons platform never sees a file the user shouldn't:
  the portal does authorization; this app just passes the effective role and consumes the feed.
