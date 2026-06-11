# Lessons — 1-1 Online Tutoring Platform

A web platform for live one-to-one online tutoring: scheduling, embedded video, a real-time
collaborative notebook, AI coaching for teachers, post-lesson reports for parents, and an admin
schedule/assignment console.

Built per [`lessonsplatformbuildspec.md`](#). This repository implements **the foundation —
build-order steps 1–2** (a usable product: running online lessons with a shared notebook and
materials), with the data model, auth, RLS, and integration boundaries in place for the later AI
layers to slot onto.

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS (clean, modern design system) ·
Supabase (Postgres + Auth + Realtime) · tldraw (notebook) · Luxon (timezones) · Materials Portal API.

---

## Quick start (demo mode — no setup)

With **no Supabase keys configured**, the app runs in **demo mode**: a built-in dataset and a persona
switcher stand in for real auth + Postgres, so every screen is explorable offline.

```bash
pnpm install
pnpm dev
# open http://localhost:3000 → pick a persona (Admin / Teacher / Student / Parent)
```

Demo personas:

| Role    | Name          | Timezone         | Sees                                                |
|---------|---------------|------------------|-----------------------------------------------------|
| Admin   | Admin Office  | Asia/Singapore   | Daily schedule board, scheduling & assignment, people |
| Teacher | Maya Chen     | Asia/Singapore   | Today's lessons, join the live room, availability   |
| Student | Aarav Sharma  | Asia/Singapore   | Upcoming lessons, reports, join live                |
| Parent  | Priya Sharma  | Asia/Singapore   | Their child's lessons and reports                   |

> In demo mode, **mutations aren't persisted** (a banner makes this clear). Connect Supabase to go live.

---

## Going live with Supabase

1. Create a Supabase project and copy the keys into `.env.local`:

   ```bash
   cp .env.example .env.local
   # set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
   ```

2. Apply the schema, policies, and seed. Using the Supabase CLI:

   ```bash
   supabase db reset       # runs supabase/migrations/* then supabase/seed.sql
   ```

   Or paste the files in `supabase/migrations/` (in order) and `supabase/seed.sql` into the SQL editor.

3. Run it:

   ```bash
   pnpm dev
   ```

   The login screen switches from the persona picker to a real email/password form. Seed accounts all
   use the dev password **`password123`** (e.g. `admin@lessons.dev`, `maya@lessons.dev`,
   `aarav@lessons.dev`). The presence of `NEXT_PUBLIC_SUPABASE_URL` is what flips the app out of demo mode.

---

## What's built (foundation — steps 1–2)

**Step 1 — Identity, roles, timezones, scheduling, assignment, the daily board**

- Supabase Auth + a `profiles` table with a first-class **IANA timezone** on every account.
  All times are stored in UTC and **rendered in each viewer's own timezone** everywhere (`src/lib/time.ts`).
- Four roles (admin / teacher / student / parent) with **Row Level Security** enforcing visibility
  (`supabase/migrations/0003_rls.sql`).
- **Admin daily schedule board** (`/admin`) — every session today in the admin's tz, with live-now,
  unassigned, and no-show counts; day navigation.
- **Scheduling console** (`/admin/sessions`) — one-off or recurring weekly lessons (shared `series_id`)
  and **per-session teacher assignment**.
- **People directory** (`/admin/people`) — teachers, students, parents with **consent** and **credit** status.
- **Teacher today** (`/teacher`) + **availability** (`/teacher/availability`).
- **Student/parent dashboard** (`/home`) + **reports** (`/home/reports`, published-only).

**Step 2 — The live lesson** (`/lesson/[sessionId]`)

- Three-panel room: **Video** + **real-time collaborative notebook (tldraw)** + **Materials**.
- **Assigned-teacher-only join is enforced server-side** (the spec's hard requirement): a teacher can
  only enter a session where `teacher_id = caller`; others get an explicit access-denied screen. The
  rule is re-checked when minting the video token, so the join-token endpoint is gated too.
- **Materials Portal integration** over the API boundary (§6): a server-side proxy holds the service
  credential and passes the caller's effective course role so the portal gates teacher-only files.
- **Consent-gated recording** (§9): the record control is disabled unless the student's `recording`
  consent is on file.

**Video SDK — Daily** (`src/lib/video/daily.ts`, `src/components/lesson/daily-room.tsx`)

- Rooms are created per session; meeting tokens are minted server-side, the assigned teacher joining
  as **owner** (record/transcribe rights). Set `DAILY_API_KEY` to go live; without it the room falls
  back to the built-in mock panel. *(LiveKit is the alternative if you want a server-side agent tapping
  live audio; Daily is chosen for the fastest clean embed + built-in transcription that feeds §7.)*

**Real-time notebook sync** (`src/lib/notebook/use-notebook-sync.ts`)

- tldraw's store is wired to a **Supabase Realtime** channel: document edits broadcast both ways and
  merge as remote changes, live **cursors/presence** render for each participant, and the running
  document is persisted to `notebooks.tldraw_snapshot` (debounced). Falls back to local IndexedDB when
  Supabase isn't configured.

**AI teacher coaching — live + post-session (§7)**

- **Metrics** (`src/lib/coaching/metrics.ts`): talk-time ratio, question frequency + open/closed mix,
  wait-time, student turns, praise — computed from a diarized transcript.
- **Live coaching** (`src/lib/coaching/coach.ts`): a rolling per-session state emits subtle,
  teacher-only, **rate-limited** nudges (mutable, dismissible). Fed by Daily transcription live, or by
  a scripted transcript in demo mode so the nudges are visible without audio.
- **Post-session analysis** (`src/lib/coaching/analyze.ts`): the transcript + final metrics go to
  **Claude (`claude-opus-4-8`, structured output)** for strengths-first coaching; saved to
  `teacher_feedback`. Without `ANTHROPIC_API_KEY` it falls back to a metrics-derived heuristic.
- **Dashboards** (§7.4): teacher coaching view (latest feedback, trends, dimension scores) and an
  admin QA view flagging low-engagement lessons.

**Reports — AI + teacher (§8)** (`/teacher/reports`)

- The teacher jots **quick notes**; AI drafts a parent-facing report from the notes + the lesson
  transcript + metrics (`src/lib/reports/draft.ts`, `claude-opus-4-8`, heuristic fallback). The
  teacher edits every field and **publishes** to the parent/student. On publish it can also assign
  homework and raise a follow-up.

**Homework tracking**

- Publishing a report with homework creates a `homework` item with a due date. Students/parents tick
  it off from their dashboard or `/home/homework`; overdue items surface to admin and feed follow-ups.

**Follow-up dashboard** (`/admin/followups`)

- Surfaces action items: **attendance gaps** (no completed lesson in 3 weeks, nothing booked),
  **no-shows**, **overdue homework**, and **teacher-flagged / low-rating reports**. A "Scan now"
  action regenerates the live ones. Each item can be resolved, snoozed, or actioned by **messaging the
  parent over WhatsApp**.

**WhatsApp (§11)** (`src/lib/messaging/whatsapp.ts`)

- Parent outreach via the **Meta WhatsApp Cloud API**, with a templated message per follow-up type.
  Set `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` to deliver; otherwise sends are **simulated** and logged
  to `outbound_messages`.

---

## What's stubbed for later build steps

These are deliberately scaffolded, not faked — the schema and seams exist so the later steps drop in:

- **Streaming STT** — Daily's built-in transcription feeds the coach when configured; a dedicated
  Deepgram/AssemblyAI path is the alternative if you move off Daily.
- **Billing/Stripe (§10)** — credit balances model exists and decrements on completion; checkout/top-up
  is the remaining piece.
- **Scheduled notifications (§11)** — WhatsApp parent outreach is built for follow-ups; timed reminders
  (1h-before, reschedules) still need a scheduler/cron.

---

## Project structure

```
supabase/
  migrations/0001_schema.sql        full schema (all sections)
  migrations/0002_functions_triggers.sql  RLS helpers, auto-notebook, credit consumption
  migrations/0003_rls.sql           row-level security by role
  seed.sql                          demo users + a full day of sessions
src/
  app/
    (app)/                          authenticated shell (sidebar by role)
      admin/  teacher/  home/        role dashboards
    lesson/[sessionId]/             the live three-panel room (full screen)
    login/                          persona picker (demo) / sign-in (live)
    api/materials/                  server proxy to the Materials Portal
  components/ui/                     design system (button, card, dialog, select, …)
  components/lesson/                 video, notebook (tldraw), materials, room
  lib/
    time.ts                         UTC ⇄ timezone helpers (the bug-prone bit, centralised)
    supabase/                       browser + server + middleware clients
    data/                           data-access layer (Supabase, with demo fallback)
    actions/                        server actions (schedule, assign, availability, auth)
    materials/portal.ts             §6 API client (real portal or mock tree)
    demo/data.ts                    demo dataset mirroring seed.sql
```

## Design notes

- **Timezones are first-class.** Everything is UTC in the DB; `src/lib/time.ts` renders per-viewer and
  computes day-windows so "today's sessions" is correct for any timezone.
- **Demo fallback.** Every data-access function tries Supabase and falls back to the demo dataset when
  no project is configured, so the UI is always runnable. This is a thin fallback, not a parallel mock
  architecture — the Supabase path is the real one.
- **The Materials boundary stays clean.** The lessons platform never sees a file the user shouldn't:
  the portal does authorization; this app just passes the effective role and consumes the feed.
```
