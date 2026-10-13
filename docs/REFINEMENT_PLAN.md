# MathVision Lessons — Refinement plan

> **Update, 13 Oct 2026 (later the same day).** The centre's own app (mv-app) turned out to already hold
> accounts, households, in-charge scope, bookings (including online sessions), per-session reports,
> two-way messaging that replaced WhatsApp, push, and a portal sync. The architecture decision is in
> **[INTEGRATION.md](./INTEGRATION.md)**: fold the lesson platform into mv-app and keep only a browser
> "room" (this repo, trimmed) on mv-app's Supabase project. Items below that mention WhatsApp two-way,
> a separate roles model, or a mobile app are superseded by that document.

_Gap analysis of the current platform against the ten requested feature areas, with
recommendations, effort estimates and the decisions that need to be made before building.
Written 13 Oct 2026 from the code on `main` of `online-lms` and `material`._

Baseline on `main`: `pnpm typecheck` clean, `pnpm test` 33/33 passing.

Effort key: **S** = up to 3 days · **M** = 1–2 weeks · **L** = 3–5 weeks (one engineer).

---

## 0. Where things stand

The platform is much further along than a "foundation". Of the ten areas, six are built in
some form and four are genuine gaps.

| # | Area | Status | Notes |
|---|------|--------|-------|
| 1 | Accounts & roles | **Mostly built** | admin / teacher / student / parent, RLS, 2FA, password reset, account requests with approval, audit log. Missing: in-charge, support. |
| 2 | Mobile + WhatsApp + web portal | **Built, not shipped** | Expo companion app (not in stores), WhatsApp outbound only, web lesson room. Missing: inbound WhatsApp, in-app notification centre, store release. |
| 3 | Video + shared whiteboard | **Built** | Daily video, tldraw notebook synced over Supabase Realtime, teacher-only join enforced server-side. Refinements listed below. |
| 4 | Materials access | **Half built — currently broken** | The lessons app calls two portal API routes that do not exist in the `material` repo. |
| 5 | Practice & testing | **Not built** | Homework exists (canvas / photo / PDF, teacher-verified, counts of correct/incorrect). No question bank, quizzes, tests or auto-marking. |
| 6 | Screen lock / anti-cheat | **Not built** | See the honest feasibility note in §6. |
| 7 | Recordings + real-time teacher feedback | **Feedback built; recording deliberately removed** | Live nudges + post-session AI coaching with timestamped moments exist. Video recording was removed in June to avoid storing video of minors. |
| 8 | Strong follow-up | **Partly built** | Follow-up dashboard (attendance gap, no-show, overdue homework, teacher flag, low rating), snooze/resolve, WhatsApp outreach. Nothing is extracted from the session itself; scan is manual. |
| 9 | Reports to parents | **Built per session** | AI draft → teacher edits → publish → WhatsApp notify. Missing: periodic progress report, PDF, progress charts, review gate. |
| 10 | Other | — | See §10. |

---

## 1. Accounts: parents, students, teachers, in-charges, admin, support

**Built.** `profiles.role` is one of admin / teacher / student / parent with Row Level
Security per role, parent↔child links (many-to-many), consents table (recording / AI analysis /
teacher evaluation), 2FA, password reset, public account requests with admin approval, audit log,
per-profile timezone and WhatsApp opt-in.

**Gap.** Two roles are missing and the role check is a hard constraint on `profiles.role`, so
adding them is a migration plus RLS helpers plus navigation, not a config change.

**Recommendation.**

- **In-charge** = academic lead for one or more courses. Sees every session, report, transcript,
  coaching result and follow-up for students in their courses; can assign teachers; can observe a
  live lesson silently; approves periodic reports before they go to parents (optional gate); owns
  the question bank for their course. This matches the Materials Portal, where `in_charge` is
  already a per-course role that owns the material.
- **Support** = operations. Scheduling, people, bookings, follow-ups, WhatsApp outreach, inbound
  messages. **No** access to transcripts, recordings, notebooks or coaching data. Effectively a
  scoped-down admin, which keeps children's lesson content away from the widest-access role.
- Put the whole matrix in one file (`src/lib/permissions.ts`) mirrored by SQL helpers
  (`is_staff()`, `is_in_charge_of(course)`), and drive the sidebar from it. Today role checks are
  scattered across pages and actions.
- Course-scoped roles belong on a `course_staff` table (person, course, role), not on the single
  platform role, so a senior teacher can be in-charge of one course and a teacher in another.

**Effort:** M. **Decision needed:** confirm what "in-charge" means to you (course lead as above,
or an account manager for a set of families). The design differs.

## 2. Mobile app / WhatsApp for updates; web for lessons

**Built.** Expo (React Native) companion app covering dashboards, lessons list, homework (view,
mark, grade), reports, booking, push notifications, biometric lock; lessons open in the browser.
WhatsApp via the Meta Cloud API with approved-template support: booking confirmed / rescheduled /
cancelled, 24h and 1h reminders (cron every 15 min, idempotent), report published, and ad-hoc
follow-up outreach. Web lesson room works on laptop and tablet.

**Gaps.**

- WhatsApp is one-way. There is no inbound webhook, so a parent replying "can we move to
  Thursday?" goes nowhere.
- The bell icon in the web shell is decorative; the `notifications` table exists but no screen
  reads it.
- The mobile app is a scaffold on an Expo SDK that is two years old, with no EAS build, store
  listing or privacy policy.
- Nobody has verified the lesson room on iPad Safari with Apple Pencil (pressure, palm rejection
  in tldraw) or Daily's behaviour on iPadOS backgrounding.

**Recommendation.** Keep lessons web-only on iPad/laptop. Make WhatsApp the primary parent
channel (parents already have it; no install) and add two-way handling before investing in the
store release. Build the notification centre once, shared by web and mobile. Treat the native
app as the student/parent "updates" surface and release it after the notification centre and the
practice module exist, so there is something worth installing for.

**Effort:** inbound WhatsApp + support inbox M · notification centre S · iPad QA pass S ·
store release M plus ongoing.

## 3. Video call + shared whiteboard

**Built.** Per-session Daily rooms, server-minted tokens (assigned teacher as owner), join window,
lesson clock from the moment both join, tldraw notebook with live cursors and persistence per
student per course, materials panel, mobile tab layout.

**Refinements, in priority order.**

1. **Worksheet on the whiteboard.** Today a PDF opens in a new tab. Rendering a chosen page onto
   the tldraw canvas as an image (pdf.js on the client, or a server render cached per page) lets
   teacher and student annotate the same worksheet. For maths tuition this is the single biggest
   in-lesson quality win. Depends on §4. **M**
2. **Authoritative sync.** The notebook broadcasts tldraw changes over Supabase Realtime with no
   server-side merge. Two devices on poor networks can diverge and the last writer wins. tldraw's
   own sync server (`@tldraw/sync`, runs on a small Node or Cloudflare worker) gives true
   multiplayer with history. **M**
3. **Follow the teacher** (tldraw built-in follow mode) so a student on a small screen tracks the
   teacher's viewport; a **laser pointer**; a **typed-maths shape** (KaTeX) for equations. **S–M**
4. **Pre-join device check** (camera, mic, network) and a reconnect banner; late-join alert to
   support when the student has not joined 5 minutes after start, with a one-tap WhatsApp nudge
   to the parent. **S**
5. **Screen share** for the rare cases a student needs to show their own screen. **S**

## 4. Material access

**Built on the portal side.** The `material` repo is a complete Drive-style portal: courses,
folder tree, PDF-only, teacher-only visibility with inheritance enforced in RLS, resumable
uploads, Google Drive import, trash with 30-day purge, per-course in-charge rosters, self-signup
with approval.

**Built on the lessons side.** A server proxy and a materials panel that call the portal over a
service key, passing the caller's effective role.

**Gap, verified in code.** The lessons app calls `GET /api/v1/courses/{id}/tree` and
`POST /api/v1/files/{id}/view-url` on the portal. The portal has no `/api/v1` routes at all, so
with the portal configured the panel fails and without it the panel shows sample data. The two
apps are also separate Supabase projects with separate identities; the only link is
`courses.materials_course_id`, and there is no UI to set it.

**Recommendation: integrate, do not rebuild.** The portal already has the hard parts (RLS,
inheritance, uploads, trash). Rebuilding would take weeks and end up with less. Do:

1. Add the two routes to the portal, authenticated with a service bearer key, honouring the acting
   role and ideally the acting user's email so per-course membership can be enforced later. Also
   `GET /api/v1/courses` so the lessons admin can pick from a list. **S**
2. Admin UI in the lessons app to map each lessons course to a portal course. **S**
3. Materials panel: real nested folders (today one level), search, "recently used", and a
   teacher-pinned "today's materials" list on the session agenda. **S–M**
4. Worksheet on the whiteboard (§3.1).

Longer term the two apps should share one Supabase project and one sign-in. Not now.

## 5. Practice and testing, in-session and after

**Built.** Homework: assigned from a report, done on a dedicated page of the student's notebook or
uploaded as photo/PDF, teacher verifies, marks correct/incorrect/not-done, feedback, overdue
feeds follow-ups. This is the right verification pattern to reuse for worked answers.

**Gap.** No question bank, no question types, no auto-marking, no practice sets, no tests, no
mastery tracking. This is the largest build on the list.

**Recommended design.**

- **Question bank.** `questions` with: stem (Markdown + LaTeX), optional image, type (MCQ /
  numeric / short answer / worked-on-canvas), answer key, marking scheme, worked solution, topic
  tags against a syllabus tree, difficulty, source (PDF reference / generated / manual), review
  status. Owned per course by the in-charge.
- **Three ways in.**
  1. *Extract from your existing PDFs* (recommended first): pick a worksheet in the portal → Claude
     splits it into questions, crops diagrams, pulls answers if a key is present → drafts land in a
     review queue → in-charge approves. Your PDFs are curated quality; this preserves it.
  2. *Generate variants*: from an approved question, generate "same skill, new numbers" items with
     worked solutions; verify numeric answers by actually computing them (a small Python/sympy
     check), and still require review before students see them. Use this for "more practice on
     this exact skill" after a wrong answer.
  3. *Manual authoring* with live LaTeX preview.
- **Practice sets.** Student-facing, instant feedback on MCQ/numeric, worked questions submitted
  on the canvas or by photo; AI pre-marks against the marking scheme, teacher confirms (the
  homework verification flow). Recommended next practice is driven by a simple mastery model:
  per topic tag, recent accuracy and recency.
- **In-session.** An "Activity" panel in the lesson room: teacher pushes a quick check or a set;
  student answers on the canvas or in the panel; teacher sees the result live and can open the
  student's working. Results attach to the session and flow into the report.
- **Tests.** Timed, fixed or per-student randomised from the bank, auto-marked where possible,
  teacher marks the rest, results feed reports, mastery and follow-ups. Lockdown per §6.

**Effort:** L for v1 (bank + PDF extraction + review + practice + in-session quick checks +
tests without lockdown). **Decisions needed:** which courses first (the seed suggests IGCSE, SAT,
IB maths); whether your PDFs include answer keys; confirm that every AI-extracted or generated
question is human-reviewed before students see it (strongly recommended).

## 6. Screen lock, anti-cheat, eye tracking, camera on

**Honest feasibility.** A web page cannot lock a device. The browser can *require* fullscreen
and *detect* tab switches, window blur, fullscreen exit, paste and devtools, and log them, but it
cannot prevent a second device, a phone next to the laptop, or a parent helping. Real lockdown
needs a kiosk: iPad Guided Access or Apple's Automatic Assessment Configuration (which Safari
supports for web apps and exam vendors use), Chromebook kiosk mode, or a dedicated desktop app.
Webcam gaze tracking (e.g. WebGazer) is unreliable for a child at a desk, produces false
accusations, and processes a minor's face continuously, which is a data-protection problem in
Singapore (PDPA), the UK/EU and India. Commercial proctoring is expensive and parents dislike it.

**Recommendation: a tiered integrity model, and lean on the 1-1 format.**

- **Tier 1 (build with tests, S).** Test mode requires fullscreen and camera on; every visibility
  change, blur, fullscreen exit or paste is an *integrity event* that pauses the timer, is shown to
  the teacher live and logged; after N events the test is flagged for review. Periodic camera
  snapshots (every 30–60 s) are stored, not continuous video, and only reviewed when flagged.
  All of it consent-gated.
- **Tier 2 (M, later).** Guided Access / AAC configuration for iPad and Chromebook kiosk
  instructions for take-home tests. A desktop exam shell only if a real need appears.
- **Design against AI rather than surveil.** For take-home tests: working must be shown on the
  canvas, per-question time limits, per-student question variants from the bank, and a comparison
  of at-home performance with in-session performance. A student at 95% at home and 60% in session
  is a more reliable signal than any eye tracker. For in-session tests, the teacher is on video and
  *is* the proctor; little else is needed.
- **Do not build** gaze/attention detection.

**Decision needed:** whether Tier 1 plus the design approach is acceptable, or you want to fund
a native kiosk app.

## 7. Session recordings and real-time teacher feedback

**Built.** Live, teacher-only, rate-limited nudges from rule thresholds (teacher monologue,
student silence, wait-time after questions, closed-question streaks, praise drought, confusion
phrases) plus a Claude pass every 2.5 minutes on the recent transcript. Post-session: talk-time,
question mix, wait-time, turns, praise → Claude produces strengths, suggestions, scores on four
dimensions and 3–6 timestamped key moments with quotes. Teacher coaching page with trends; admin
QA page flagging low-engagement lessons.

**Not built, by decision.** Cloud recording was removed in June 2026 so the platform would not
store video of minors; Daily transcription was kept. Re-enabling it is a policy reversal and
needs a consent flow (the `consents` table exists but nothing collects consent from parents).

**Gaps that hurt today.**

- The transcript lives in the teacher's browser tab and is saved only when they click "End &
  get feedback". Close the tab, lose the lesson. Transcription should be persisted incrementally
  server-side, and analysis should run from a Daily `meeting.ended` webhook, not a button.
- Nudges have no memory of the teacher's goals, and nobody measures whether a nudge changed the
  metric it targeted.

**Recommendation.**

- **Recording, with consent and limits.** Default to **audio plus notebook timeline** (audio track
  and a snapshot sequence of the canvas) rather than the child's camera feed; offer full video as an
  opt-in per family. Daily can record straight into your own S3 bucket. 90-day retention with
  automatic deletion, access limited to admin, the course in-charge and that lesson's teacher,
  every access logged, parent can request a copy or deletion. A parent consent flow at onboarding
  (recording / AI analysis), stored in `consents`, enforced at room creation.
- **Server-side transcript pipeline.** Daily webhooks → store segments as they arrive → run
  analysis, report draft and §8 extraction in a background job when the meeting ends.
- **Coaching loop.** A weekly focus per teacher (e.g. wait-time) so live nudges concentrate on one
  thing; measure before/after per nudge type; "watch this moment" links from key moments into the
  recording; silent observer join for the in-charge during a new teacher's first lessons; a weekly
  digest per teacher and a per-teacher scorecard for the in-charge.

**Effort:** recording with consent and retention M · server-side pipeline M · coaching loop M.
**Decision needed:** audio-only vs full video, retention period, who may watch.

## 8. Strong follow-up driven by the session

**Built.** Follow-up queue with five types (attendance gap, no-show, overdue homework, teacher
flag on a report, low rating), priority, snooze/resolve with note, WhatsApp outreach with a
templated message per type, and a "Scan now" action. The report AI draft can set
"needs follow-up" with a reason, but only when a teacher drafts a report.

**Gaps.**

- Nothing is extracted from the lesson itself. If a student says "I have my exam next Friday" or
  "I didn't sleep", or clearly struggles with the same thing for the third week, no one is told.
- The scan is manual; nothing runs it daily.
- Follow-ups have no owner, no due-by SLA, no escalation, and the outcome of a parent call is a
  free-text note. There is no student timeline to see the history in one place.

**Recommendation.**

- **Extraction step after every lesson** (runs with the post-session analysis): from the transcript
  and notebook, pull (1) wins worth sharing, (2) concerns (wellbeing, tiredness, distraction, a
  repeated misconception, tech trouble), (3) logistics the student mentioned (exam dates, holidays,
  wants a different time), (4) anything the student asked to be passed on. Each becomes a follow-up
  of a new type (`parent_update`, `concern`, `logistics`, `exam_upcoming`) with a priority, a
  suggested parent message, and a "call the parent" recommendation when warranted.
- **Ownership and SLA.** Every follow-up is assigned (support by default, in-charge for
  concerns), due within 24h for high and 72h for normal, escalated to the in-charge when overdue,
  with a morning digest to support over WhatsApp or email.
- **Parent conversation log.** A structured record (who, when, channel, outcome, commitments such
  as "moving to Thursdays from November") linked to the student.
- **Student timeline.** One page per student: sessions, reports, homework, practice and tests,
  follow-ups, parent contacts, consents. This becomes the hub for teachers, in-charge and support.
- **Daily cron** for the existing scan.

**Effort:** M.

## 9. Reports to parents

**Built.** Per-session report drafted by Claude from the teacher's notes, the transcript and
metrics; teacher edits every field, rates the lesson, publishes; parent and student see it on web
and mobile; WhatsApp notifies on publish; homework and a follow-up can be raised from it.

**Gaps.** No periodic (monthly or termly) progress report; no PDF or shareable document; no
progress charts (topic mastery, attendance, homework completion, test scores); no in-charge
review before publishing; no parent acknowledgement or reply.

**Recommendation.** Monthly progress report assembled from the month's session reports, practice
and test results, attendance and homework data; Claude drafts, teacher edits, in-charge approves;
rendered as a branded PDF; delivered as a WhatsApp document plus in-app; parent can acknowledge,
comment or book a call. Add a short quality rubric and have the in-charge sample a few session
reports per teacher per week.

**Effort:** M.

## 10. Other features worth adding

In rough order of value for lesson quality:

1. **"Last time" pre-lesson brief.** Before each lesson the teacher sees a one-screen summary:
   previous lesson's report and key moments, open homework, recent practice errors, open follow-ups,
   the plan for today. Cheap, and it fixes the most common 1-1 failure (the teacher not remembering
   where the student was). **S**
2. **Learning plan and syllabus tracker** per student: topics in the course, status per topic,
   so agendas, reports and practice all hang off a plan and parents see coverage. **M**
3. **Teacher quality scorecard** for the in-charge: coaching scores, parent ratings, punctuality,
   report timeliness, homework turnaround, with observation notes. **S–M**
4. **Substitution workflow.** Teacher sick → find a qualified, available teacher → confirm → tell
   the parent. Plus make-up lessons, a holiday calendar and a cancellation policy that drives
   credits. **M**
5. **Attendance and punctuality** for teachers as well as students (late joins are already
   measurable from the lesson clock). **S**
6. **Parent one-tap rating** after each lesson via WhatsApp, and a quarterly NPS. **S**
7. **Billing.** Credit balances exist in the schema; add packages, Stripe checkout, invoices,
   low-balance reminders, and local payment methods per market. **M**
8. **Data protection.** Consent capture, retention jobs, export and delete on request, access
   logs for recordings and transcripts. Needed before recording minors. **S–M**
9. **Support inbox** for inbound WhatsApp with internal notes and assignment (see §2). **M**
10. **Admin analytics**: utilisation, retention risk (attendance gap + low ratings + unpaid),
    teacher load. **S–M**
11. **Multi-language parent messaging** (WhatsApp templates per language). **S**
12. **Platform upgrade.** The lessons app is on Next.js 14 and React 18; the portal is on
    Next.js 16 and React 19. Worth aligning before the big practice build so new work is not
    written twice. **S–M**

---

## Proposed build order

**Phase 0 (this week, all S):** decisions below · finish the materials integration (portal API +
course mapping) · server-side transcript persistence · daily follow-up scan cron · notification
centre · "last time" pre-lesson brief.

**Phase 1 (weeks 2–5):** Practice and tests v1: question bank, PDF extraction with review queue,
practice sets with auto-marking, in-session quick checks, tests without lockdown · worksheet on
the whiteboard.

**Phase 2 (weeks 5–7):** Follow-up engine (extraction, ownership, SLA, digest, conversation log) ·
student timeline · monthly progress report with PDF.

**Phase 3 (weeks 7–9):** Recordings with consent and retention · server-side analysis pipeline ·
coaching loop refinements · test integrity tier 1 · in-charge and support roles.

**Phase 4:** two-way WhatsApp and support inbox · mobile app store release · billing · learning
plan.

## Decisions needed before building

1. **In-charge**: course lead (recommended) or family account manager?
2. **Recording**: audio + notebook timeline by default with video opt-in (recommended), or full
   video for everyone? Retention period (90 days recommended)? Who may watch?
3. **Question source**: start by extracting from your existing PDFs (recommended), with generated
   variants for extra practice. Which courses first? Do the PDFs have answer keys?
4. **Test integrity**: Tier 1 browser integrity plus AI-resistant design (recommended), or fund a
   native kiosk app?
5. **Materials**: integrate with the portal (recommended) rather than rebuild.
6. **Order**: start with Phase 0 + Phase 1 as above, or pull follow-up (Phase 2) forward?
