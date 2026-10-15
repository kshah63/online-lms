# Pencil Spaces integration — implementation plan

**Status:** design reviewed with the owner (decisions 1–5 closed), not yet implemented · **Branch:** `claude/eloquent-galileo-i6i3yh` · **Owner:** product owner · **Audience:** engineers / AI agents executing the change · **Reference:** [`api-notes.md`](./api-notes.md) (verified API + helpdesk facts), [`openapi-2026-10-15.json`](./openapi-2026-10-15.json) (vendor spec), [`endpoint-summary.txt`](./endpoint-summary.txt)

## Summary

1. The live lesson room (Daily video + tldraw notebook + our live coach) is replaced by one persistent Pencil Space per (student, course), embedded in `/lesson/[sessionId]` next to our Materials panel; join URLs are minted client-side per click and never appear in server-rendered HTML.
2. Scheduling, assignment, credits, reports, follow-ups, WhatsApp and the homework assign → submit → verify state machine stay in our Supabase DB; Pencil only learns about users and Spaces (Events mirroring is a recommended later phase). Every Pencil call made with the institution API key sits behind an explicit server-side authorization check, because RLS no longer protects it.
3. Post-session intelligence moves server-side: Pencil webhooks are hints that enqueue jobs; every job re-fetches the Pencil object, verifies it belongs to the lesson's Space, re-checks the opt-out flag, then runs our `computeMetrics`/`analyzeLesson`/`draftReport` on Pencil's diarized transcript with Pencil's analytics and AI Coach report stored alongside.
4. Recording policy is **opt-out**: always-on cloud recording at institution level (switched on at the start of Phase 2); opted-out students get `disableAlwaysOnRecording=true` on their Space, confirmed by read-back, with a hard stop on joining if the setting has not landed and automatic deletion of any recording that should not exist.
5. Live coaching nudges are dropped; a no-show is never billed (completion requires evidence of both participants); demo mode keeps working with a mock Space and a fixture transcript; the old Daily/tldraw lesson path is deleted, with a plain fallback meeting link as the outage path.

## Decisions (facts)

- Pencil replaces video, collaborative board, screen share/chat, recordings, attendance signals, transcript + AI summary, and provides its own post-session AI Coach report.
- One persistent Space per (student, course), reused for every lesson and for homework. The tldraw `notebooks`/`tldraw_snapshot` machinery is retired (lesson side in Phase 1, homework side in Phase 3).
- Homework: student works on a board in their Space, submits in our app; teacher reviews the board in the Space, verifies/sends back in our app. Our attachments bar remains the fallback and the durable evidence.
- Materials panel (and the Materials Portal repo) stay unchanged.
- Our DB is the schedule of record. No per-session Pencil room. Pencil Events/attendance mirroring is a recommended Phase 4, not v1.
- Recording is opt-out (owner decision 1). "Record participant video" OFF is the recommended default: recordings hold audio + whiteboard + teacher video, not the student's camera. This costs the AI features nothing: transcripts, summaries and the AI Coach report are audio/transcript-derived.
- Live coaching nudges are dropped (owner decision 2). Post-session coaching = Pencil AI Coach report + our Claude analysis of Pencil's transcript.
- 1-1 only. `hosts[]`/`participants[]` stay arrays but nothing is designed for groups.
- "End & get feedback" becomes "End lesson" (or "Mark as no-show"); coaching arrives later (teacher coaching page + push/in-app notice).
- The API key is the env secret `PENCIL_SPACES_API_KEY`. Plan tier (Advanced for AI Coach, Expert for Summaries) is a go-live prerequisite to confirm.
- Parents get a status card only (teacher, elapsed time, recording status). They get no Pencil user and no seat in the room (owner decision 3).
- AI evaluation of teachers is mandatory for every teacher on the platform (owner decision 4): the pipeline never gates on a `teacher_eval` consent row; the policy is stated in the teacher onboarding copy and README.
- Pencil outage fallback is Zoom (owner decision 5): one master Zoom meeting link for the whole school (env `LESSON_FALLBACK_URL`); nothing is stored per teacher; admins can override the link per lesson.
- A student (or teacher) may use two devices in one lesson: laptop for the call, iPad for writing on the board (owner request; supported by Pencil, see decision o).
- Lessons app is Next.js 14 App Router (not 16).

## Architecture

- **Users.** Every profile that must enter a Space (student, teacher, admin) gets a Pencil API user lazily on first need via `POST /users/createAPIUser` with `externalId = profiles.id`, `userRole` `Student` for students and `Teacher` for teachers and admins. **Name sent to Pencil:** students → first name only (first token of `display_name`); staff → `display_name`. Stored in the service-only table `pencil_users` (not on `profiles`). Parents get no Pencil user (owner decision 3: status card only).
- **Spaces.** `pencil_spaces` row per (student, course), created lazily by `ensureSpace()` with `externalId = '<course_id>:<student_id>'`, `title = '<course name> · <student first name>'`, `visibility: 'private'`, `notifyInvitees: false`, `hosts = [assigned teacher]`, `participants = [student]`. Recovery after a failed insert: `GET /spaces` filtered by `externalId`. Host changes → `PATCH /spaces/{spaceId}/updateUsers`, only ever for profiles passing `canHostSpace`. Recording policy → `PATCH /spaces/{spaceId}/settings/`, confirmed by `GET /spaces/{spaceId}`.
- **Join.** The page renders from the DB only (no Pencil calls in the server component). The client calls `POST /api/lesson/[id]/space`, which re-applies the access rule, provisions only when rows are missing/stale, mints `GET /users/{pencilUserId}/authorize?redirectUrl=<Space link + params>` (5 s timeout, no retries) and returns `{url}`; the client sets `iframe.src` (desktop) or `window.open(url, '_blank', 'noopener,noreferrer')` (Redirect mode). Tokens are valid 3600 s, re-minted on every click, never persisted or logged.
- **Webhooks.** One URL + secret per environment. `POST /api/webhooks/pencil` verifies the Bearer secret (SHA-256 digests compared with `timingSafeEqual`), writes a ledger row, enqueues a job and returns 200 in milliseconds. Payloads are hints only: no row in `sessions`, `transcripts` or `teacher_feedback` is written from a payload without a Pencil round-trip confirming the Space.
- **Post-session job.** A `pencil_sessions` row is the per-lesson state machine; `pencil_jobs` is a queue drained by `/api/cron/pencil-jobs` every 5 minutes. Steps are idempotent, re-check the opt-out flag, and are ordered as Pencil really delivers: analytics (minutes), recording (~1 h), transcript + summary (later), AI Coach report (~30 min after a 1 h lesson, often after the transcript).
- **Authorization boundary.** One server-only predicate guards every Pencil mutation and every join URL:

```ts
// src/lib/pencil/authz.ts
export async function canHostSpace(admin, profile, studentId, courseId): Promise<boolean> {
  if (profile.role === "admin") return true;
  if (profile.role !== "teacher") return false;
  const { count } = await admin.from("sessions").select("id", { count: "exact", head: true })
    .eq("teacher_id", profile.id).eq("student_id", studentId).eq("course_id", courseId).neq("status", "cancelled");
  return (count ?? 0) > 0;
}
export function canJoinLesson(profile, session, childIds): boolean { /* admin | assigned teacher | own student | parent-of — unchanged rule */ }
```

`syncHosts` only ever adds the session's assigned teacher (plus admins), never "the caller". A teacher who passes RLS `teaches_student` for a different course can grade in our app but gets no host seat and no Space link.

### Join a lesson

```
Teacher browser                 lessons app (server)                              Pencil
---------------                 --------------------                              ------
GET /lesson/{id} -------------> requireProfile, getSessionById, canJoinLesson (unchanged rule)
                                admin client: pencil_spaces, pencil_users, recording_opt_outs (DB only)
                                opted out && !space.recording_disabled -> "Recording policy not applied" (no join)
<-- HTML <LessonRoom> (studentPencilUserId, recordingOn, fallbackJoinUrl; NO join URL in HTML/RSC)
POST /api/lesson/{id}/space --> canJoinLesson again; rateLimit pencilJoin 30/h; logAudit pencil.join
                                only when missing/stale:
                                  ensurePencilUser(viewer) --------------------> POST /users/createAPIUser
                                  ensureSpace(student, course) ----------------> POST /spaces/create | GET /spaces?externalId
                                  syncHosts(assigned teacher, admins) ---------> PATCH /spaces/{id}/updateUsers
                                  applyRecordingPolicy (opted-out only) -------> PATCH /spaces/{id}/settings/ ; GET /spaces/{id}
                                mintJoinUrl(viewer, 'lesson') -----------------> GET /users/{uid}/authorize?redirectUrl=
                                                                              <- {url}   (5 s timeout, no retry)
<-- {configured:true, url, mode:'iframe'|'redirect'}  | PencilError -> {configured:false, fallbackJoinUrl}
iframe.src = url  |  window.open(url) ----------------------------------------> my.pencilapp.com/spaces/{spaceId}?startCall=true
                                                                                 &skipCallHostCheck=true&standalone=true&broadcastEvents=true
<-- postMessage ready, user_joined_call                     (teacher "in call" badge)
<-- postMessage participant_join{id==studentPencilUserId} | participantupdate{count>=2}
startSessionClock(id) --------> UPDATE sessions SET actual_start=now(), status='in_progress' WHERE actual_start is null (teacher-scoped)
Teacher clicks End -----------> endLesson(id, outcome): caller == teacher_id || admin
                                UPDATE sessions SET status=outcome, actual_end=now() ... RETURNING id  (abort if 0 rows)
                                best-effort POST /spaces/{spaceId}/endOngoingSession (1 attempt, 5 s) -> {endedSessionId}
                                upsert pencil_sessions(endedSessionId, hint_session_id=id, state='ended'); logAudit lesson.end
<-- iframe unmounted -> "Lesson ended" card
```

### After the call ends

```
Pencil                          /api/webhooks/pencil            /api/cron/pencil-jobs (every 5 min, maxDuration 300)
------                          --------------------            ----------------------------------------------------
SPACE_USER joinSpace ---------> ledger; pencil_sessions(state='live', hint_session_id) — no sessions write
SPACE_SESSION SESSION_ENDED --> ledger + job ingest_session -->  GET /analytics/sessions/{sid}
                                                                 REQUIRE fetched.spaceId == pencil_spaces.pencil_space_id else state='failed'
                                                                 attendees -> teacher_present / student_present (pencil_users)
                                                                 both present: match lesson (hint, else window); actual_start/end backfill;
                                                                   status='completed' if not already (audit pencil.session_autocompleted)
                                                                 teacher only: status='no_show' + follow-up; student only: unmatched
                                                                 session_metrics talk fraction <- callActiveTalkingDuration
                                                                 opted out? -> state skipped_opt_out, stop (analytics kept)
                                                                 else analytics_done, next_poll_at = +90 min
SPACE_RECORDING RECORDING_AVAILABLE> job ingest_recording ---->  GET /spaces/recordings/{spaceId} (verify recordingId listed)
                                                                 opted out | unmatched | no overlapping lesson ->
                                                                   DELETE /spaces/recordings/{spaceId}/{rid}; audit; follow-up
                                                                 else store recording_id
SPACE_RECORDING <transcript evt> -> job ingest_transcript ---->  re-check opt-out; GET /transcriptions/{recordingId}
                                                                 toSegments() -> transcripts (+pencil_summary); computeMetrics()
                                                                 analyzeLesson(+pencilSummary) -> teacher_feedback(teacher_id = taught_by)
                                job run_claude --------------->  draftReport -> reports (teacher_id = taught_by) + session_ai_outputs
                                                                 (agenda draft, homework suggestion), followups (ai), notify teacher
(no webhook for coach report)   job ingest_coach_report ------>  GET /analytics/sessions/{sid}/reports (poll until coaching != null)
(webhook never arrives)         reconcile + retention (cron) ->  GET /analytics/sessions?filters{spaceIds,createdStart}
                                                                 GET /spaces/recordings/{spaceId}; DELETE recordings past retention
```

## API surface we use (verified spec only)

| Purpose | Call | Fields we rely on |
|---|---|---|
| Create user | `POST /users/createAPIUser` `{name, userRole:'Student'\|'Teacher', externalId}` | `userId`, `email` |
| Rename user | `PATCH /users/{userId}` `{name}` | — (on `display_name` change) |
| Join URL | `GET /users/{userId}/authorize?redirectUrl=<url-encoded Space link + params>` | `url` (valid 3600 s) |
| Create Space | `POST /spaces/create` `{title, hosts:[{userId}], participants:[{userId}], visibility:'private', notifyInvitees:false, externalId}` | `spaceId`, `link`, `settings.disableAlwaysOnRecording` |
| Find / read Space | `GET /spaces` with `externalId` filter; `GET /spaces/{spaceId}` | `results[]`; `settings.disableAlwaysOnRecording`, `hosts[]` |
| Hosts | `PATCH /spaces/{spaceId}/updateUsers` `{addUsers:[{userId, role:'host'}], removeUsers:[{userId}], notifyInvitees:false}` | — |
| Recording policy | `PATCH /spaces/{spaceId}/settings/` `{settings:{disableAlwaysOnRecording}}` | — |
| End lesson | `POST /spaces/{spaceId}/endOngoingSession` | `endedSessionId`, `newSessionId` |
| Analytics | `GET /analytics/sessions/{sessionId}` | `spaceId`, `sessionStartTime`, `sessionEndTime`, `callStats[]`, `attendees[].userId/callActiveTalkingDuration/callVideoOnDuration/callDuration/spaceFirstJoinTime/spaceLastLeaveTime` |
| List sessions (reconcile) | `GET /analytics/sessions` filters `{spaceIds, createdStart, createdEnd, status}` | `results[]` |
| AI Coach | `GET /analytics/sessions/{sessionId}/reports` | `coaching{score, categories[], items[]}`, `safeguarding` |
| Recordings | `GET /spaces/recordings/{spaceId}?startingAfter&endingBefore` | `recordings[].recordingId/startingTime/duration` |
| Playback (Phase 4) | `GET /spaces/recordings/download/{recordingId}` | `downloadLink` (short-lived) |
| Delete recording | `DELETE /spaces/recordings/{spaceId}/{recordingId}` | — |
| Transcript | `GET /transcriptions/{recordingId}` | `recordingStartTime`, `transcript[].text/start/end/userId`, `transcriptUsers[]`, `summary.description` |
| Webhook config | `POST /webhooks {url, secret}`, `GET /webhooks`, `DELETE /webhooks` | — |
| Phase 4 | `POST /events`, `PATCH /events/{eventId}/update`, `POST /events/{eventId}/cancel`, `GET /attendance/{event_id}` | `event.id`, `results[].status` |

Space URL params (on the Space link inside `redirectUrl`): lesson links for teacher **and** student: `startCall=true&skipCallHostCheck=true&standalone=true&broadcastEvents=true&gv=true` (the student's call auto-starts when the host starts it; `skipDeviceSetup` stays off so the child confirms mic/camera); homework links: `standalone=true` only.

Webhook payloads (`_type` discriminates; Bearer = our secret): `SPACE_USER {spaceId, sessionId, timestamp, eventType: joinSpace|leaveSpace|hideTab|unhideTab, userId}`; `SPACE_SESSION {spaceId, sessionId, timestamp, eventType:'SESSION_ENDED'}`; `SPACE_RECORDING {spaceId, recordingId, timestamp, eventType:'RECORDING_AVAILABLE'|<transcript-ready>}`; Phase 4: `SCHEDULE`, `ATTENDANCE`, `CONTROL_CENTER_ALERT {alertType:'EVENT_NO_SHOW'}`.

Embed events (postMessage `{type, detail}`; accept only when `event.source === iframe.contentWindow` and `event.origin ∈ {https://my.pencilapp.com, https://staging.pencilapp.com}`): `ready`, `participant_join/participant_leave {id}`, `user_started_call`, `user_joined_call`, `user_left_call`, `call_ended`, `user_ended_call`, `recording_status_change {status}`, `participantupdate {count}`, `connection_status_change`.

**Still unknown:** (1) exact `eventType` string of the transcript-ready `SPACE_RECORDING` event — we match on `_type`, treat any non-`RECORDING_AVAILABLE` value as transcript-ready, then verify with `GET /transcriptions`; (2) how/if Pencil's in-Space idle/tab-switch alerts surface beyond the `hideTab` webhook; (3) whether always-on cloud recording is enabled for the institution, who switches it on, and the exact propagation delay (helpdesk: up to 3 h for Spaces with recent calls); (4) no boards API (create/list/export/deep-link) exists; (5) webhook retry/ordering semantics (we dedupe ourselves); (6) whether `endOngoingSession` also ends the call and splits the recording; (7) iframe cookie behaviour in Safari must be tested empirically; (8) whether deleting a recording also deletes its transcript, summary and coach report on Pencil's side.

## Explicit design decisions

a. **Idempotent provisioning.** `createAPIUser.externalId = profiles.id`; `spaces/create.externalId = '<course_id>:<student_id>'` (also stored as `pencil_spaces.external_id`). If the DB insert fails after the Pencil call, the next `ensureSpace` recovers with `GET /spaces` filtered by `externalId` before creating. Space state (`host_profile_ids`, `recording_disabled`, `hosts_synced_at`, `recording_verified_at`) is cached in `pencil_spaces` so a normal join makes exactly one Pencil call (`authorize`), plus one `GET /spaces/{id}` for opted-out students.

b. **One Pencil session = one lesson; completion needs evidence.** `endLesson(sessionId, outcome: 'completed' | 'no_show')` (server action): loads the session with the cookie client, requires `admin || session.teacher_id === profile.id`, writes `status=outcome, actual_end=now()` with `.neq('status', 'completed').select('id')` and aborts if no row returned, **then** calls `POST /spaces/{spaceId}/endOngoingSession` once (5 s timeout, no retries; failure is logged, never blocks), stores `endedSessionId` in `sessions.pencil_session_id` + `pencil_sessions(hint_session_id)`, `logAudit(profile, 'lesson.end' | 'lesson.no_show')`. If `actual_start` is null and no student join was seen, the button offers "Mark as no-show" instead of "End lesson". In the iframe the Space is unmounted and replaced by a "Lesson ended" card so no post-End Pencil session with the teacher is created. `ingest_session` marks a lesson `completed` only when **both** the teacher's and the student's `pencil_user_id` appear in `attendees` with `callDuration > 0` (audit `pencil.session_autocompleted`, credit trigger fires once); teacher-only → `status='no_show'`, `actual_end`, `raiseFollowup(no_show)`, never `completed`; student-only (homework time) → `unmatched`. Fallback correlation when no hint exists: `spaceId → pencil_spaces → (student, course)` → session with `status in ('scheduled','confirmed','in_progress','completed')`, `pencil_session_id is null`, `sessionStartTime` within `[scheduled_start − 15 min, scheduled_end + 3 h]`, both participants present with `callDuration ≥ 5 min`, preferring the session whose `scheduled_start` is closest. A second Pencil session matching a lesson that already has `pencil_session_id` is recorded in `pencil_sessions` only (`state='unmatched'`, `last_error='lesson already bound'`), and `ingest_recording` prefers the recording whose `startingTime` is closest to `actual_start`. The teaching identity is derived from Pencil, not from the current row: `pencil_sessions.taught_by_profile_id` = the attendee whose `pencil_user_id` belongs to a teacher/admin profile (fallback `sessions.teacher_id`); `toSegments` speaker mapping and `teacher_feedback.teacher_id` / `reports.teacher_id` use it.

c. **Analytics and AI Coach ingestion — fractions, not percentages.** The codebase stores talk share as a 0–1 fraction (`metrics.ts:121`, `heuristicFeedback` thresholds `≥ 0.4` / `> 0.65`, `pct()` multiplies by 100). So `teacher_talk_pct = round2(T / (T + S))`, `student_talk_pct = round2(1 − teacher_talk_pct)` from `callActiveTalkingDuration` (`talk_source='pencil_analytics'`); `teacher_camera_pct = round2(callVideoOnDuration / callDuration)` likewise 0–1; the other six `SessionMetrics` fields stay transcript-derived. `tests/pencil-analytics.test.ts` asserts "returns fractions compatible with computeMetrics". The AI Coach report is stored in `teacher_feedback.pencil_coach` (jsonb) + `pencil_coach_score`. UI: `/coaching/[sessionId]` shows two cards — "Pencil AI Coach" (score, four category scores, moments with `recordingOffset`) and "MathVision coaching" (our `dimension_scores`, strengths, suggestions, moments). Trends on `/teacher/coaching` use our scores; Pencil's score is a secondary chip; "processing" placeholder until it lands. **Teacher evaluation is mandatory (owner decision 4):** `analyzeLesson` and `ingest_coach_report` run for every teacher; nothing reads `consents.type='teacher_eval'` any more (the table stays for history only). The policy is stated in the teacher onboarding/request-access copy and in README ("Lessons are recorded and AI-evaluated for coaching; this is a condition of teaching on MathVision"). `ai_used=false` therefore only ever means "Claude was unavailable or rate-limited", never "not consented".

d. **Opt-out recording policy, enforced.** Institution recording mode = Always-on (enabled at the start of Phase 2); "Record participant video" OFF. The flag lives in the service-only table `recording_opt_outs` (presence = opted out), written exclusively by `setRecordingOptOut` (`requireRole('admin')`, admin client, `logAudit 'student.recording_opt_out'`). Enforcement: (1) `applyRecordingPolicy` PATCHes `disableAlwaysOnRecording=true`, then `GET /spaces/{spaceId}` and writes `pencil_spaces.recording_disabled=true, recording_verified_at` only when the read-back confirms; (2) **hard stop** — the lesson page, `/api/lesson/[id]/space`, `getHomeworkSpaceLink` and the mobile routes refuse to mint a join URL when the student is opted out and `recording_disabled` is false, show "Recording policy not applied — contact admin" and raise an admin follow-up; (3) because Pencil propagates settings to Spaces with recent calls in up to 3 h, `setRecordingOptOut` warns the admin and raises a follow-up when the student has a lesson within 3 h, and an `apply_space_settings` job re-PATCHes + re-verifies 10 min before each lesson of an opted-out student (enqueued by `/api/cron/reminders`, which already enumerates upcoming lessons); (4) every job step re-checks the flag; `ingest_recording` and `reconcile` immediately `DELETE /spaces/recordings/{spaceId}/{recordingId}` any recording of an opted-out student, store nothing, `logAudit(null, 'pencil.recording_deleted_opt_out')` and raise an admin follow-up so the family can be told; (5) the teacher's header shows a red "Recording is ON but this student is opted out — stop the recording" banner if `recording_status_change` reports recording while the flag is set; (6) on opt-out, a `delete_recording` job is enqueued for every existing recording of that student's Spaces and `transcripts.raw` is nulled for their past sessions; whether segments, `pencil_summary`, our feedback and `pencil_coach` for past lessons are also purged is an owner decision (default: retained until the family asks). For opted-out students nothing recording-derived exists: no transcript, summary, AI Coach, Claude analysis, report pre-fill, agenda, AI follow-ups; analytics (talk time) is still stored; `sessions.analysis_status='skipped_opt_out'`; the report editor shows "Not recorded — write from your notes". The old `consents` gating (`recording`, `ai_analysis`) is removed from code; the table stays for `teacher_eval` and history; no backfill — those rows were never enforced (recording was hard-off). Students and parents see a persistent "This lesson is recorded (audio + board)" notice in their lesson view and on the session card; opted-out students see "Not recorded".

e. **Embed events drive our state — gated on the student.** In iframe mode, for the teacher viewer, `startSessionClock` fires on the first event proving the student is present: `participant_join` whose `detail.id === studentPencilUserId`, or `participantupdate.count >= 2`; `user_joined_call` only drives the teacher's own "in call" badge and "waiting for student" (today `daily-room.tsx` fires `onPeerPresent` on the first *remote* participant; this preserves that semantics so the admin actual-duration column is not inflated). `call_ended`/`user_left_call` → "call ended" badge; `recording_status_change` → recording chip. In Redirect mode nothing is written live: `ingest_session` backfills `actual_start = coalesce(actual_start, max(teacher.spaceFirstJoinTime, student.spaceFirstJoinTime))` clamped to `≥ scheduled_start − 5 min`, and `actual_end = coalesce(actual_end, sessionEndTime)`. The `SPACE_USER joinSpace` webhook is only a "student is here" hint in `pencil_sessions`, never a clock.

f. **iframe on desktop, Redirect on mobile/unsupported.** Desktop (`lg ≥ 1024px`, fine pointer) → iframe with the vendor's `allow` list and `referrerpolicy="no-referrer"`; mobile, coarse pointer, or no `ready` postMessage within 15 s → "Open lesson in a new tab" button that re-mints via `/api/lesson/[id]/space` and opens the `{url}` returned by `authorize` (never a hand-built token URL) with `window.open(url, '_blank', 'noopener,noreferrer')`. The `message` handler checks `event.source === iframeRef.current?.contentWindow` and an allowlist of both Pencil origins. A `Content-Security-Policy: frame-src https://my.pencilapp.com https://staging.pencilapp.com` header for `/lesson/*` and `/hw/*` is added in `next.config.mjs`. Parent page must be HTTPS (`next dev` needs a trusted local cert, e.g. `mkcert` + `--experimental-https`). A `BroadcastChannel('lesson-room')` lock warns when a second lesson room tab is opened in the same browser (an `authorize` login logs out whoever is logged into Pencil in that browser — relevant for a teacher's next lesson and for siblings sharing a device).

g. **Teacher reassignment.** `assignTeacher()` refuses when the session is `in_progress` or `completed` (admin must cancel and rebook, or use an explicit `force` that is audited and does not touch coaching ownership — the pipeline derives `taught_by` from attendees). Before the lesson, host sync is additive and fire-and-forget (`createSupabaseAdminClient()`, `captureError`, never fails the form action): add the new teacher as host first; remove the previous teacher only when they have no remaining non-cancelled sessions and no non-completed homework for that (student, course). `logAudit 'pencil.space.hosts_changed' {added, removed}`. `syncHosts` also runs lazily in `/api/lesson/[id]/space` when `sessions.teacher_id ∉ host_profile_ids`.

h. **Events mirroring (recommended Phase 4, owner decision).** Mirror each session into an ONLINE Event (`POST /events` on schedule, `PATCH …/update` on reschedule/assign, `POST …/cancel` on cancel) to get the in-Space session timer, automatic attendance, `EVENT_NO_SHOW` alerts and the "End Event" redirect back to our app. Breakage: Pencil forbids two concurrent events in one Space; a Space is per (student, course), so this only happens if two of our sessions for the same pair overlap, which `sessions_no_student_overlap` (0014) already prevents for active statuses — except when a host extends an event past the next start. The mirror must treat a 4xx as "unmirrored" (log, raise an admin follow-up) and never block our scheduling.

i. **No boards API.** Homework deep-links to the Space (`standalone=true`, no `startCall`); the student creates a board named by our `board_hint` convention; evidence of submission stays in our app (status, `submitted_at`, attachments, optional screenshot upload). The homework hint tells students not to start a call; if staging shows homework calls are recorded anyway, `ingest_recording` discards (deletes at Pencil) recordings that overlap no matched lesson.

j. **Live coaching.** Pencil's AI Coach is post-session (~30 min after a 1 h lesson). Pencil has no live teacher-coaching nudges — only student idle/tab-switch alerts to the host. Our live coach is retired (owner decision 2). **Owner decision:** optionally, in a later phase, surface `SPACE_USER hideTab/unhideTab` as an "attention" timeline on the coaching detail page by writing them into the existing `live_events` table (`source='pencil'`). Until then `live_events` stays as an empty table; its reader and card are removed.

k. **Pencil-side prerequisites (owner, before go-live):** plan tier (API = Usage-based/Enterprise; AI Coach = Advanced+; AI Summaries = Expert+); Settings > Permissions > Recording = Always-on **(switched on at the start of Phase 2, not before)**, "Record participant video" OFF, local recording prevented, recordings admin/host-only; Settings > AI Assist: Coaching Insights ON, Session Summaries ON, Post-Session Emails OFF for API users; Standalone branding; webhook URL + secret per environment (staging → preview URL, prod → `https://<app>/api/webhooks/pencil`); a generic admin account owning the API key; subscribe to statuspage; **signed DPA/processor agreement with Pencil covering recordings and transcripts of minors, confirmation of data region, and Pencil's own retention of derived artefacts after `DELETE /spaces/recordings`**; `SUPABASE_SERVICE_ROLE_KEY` set in every environment that runs Pencil (provisioning, webhooks and jobs are no-ops without it).

l. **Timing-aware job design.** See "Post-session job": a per-lesson state machine with independent idempotent steps, Space verification on every fetch, polling fallbacks, and reconciliation — not one webhook handler.

m. **Audit coverage.** `logAudit` for `pencil.user.create`, `pencil.space.create`, `pencil.space.hosts_changed {added, removed}`, `pencil.join {spaceId, purpose, mode}` (every minted URL, including mobile), `lesson.end`, `lesson.no_show`, `pencil.session_autocompleted`, `pencil.recording.deleted {reason}`, `pencil.recording.download {recordingId}` (awaited; fail closed if the insert errors), `pencil.transcript_processed`, `student.recording_opt_out`, `homework.submit`. The badge map in `src/app/(app)/admin/audit/page.tsx` (`ACTION_TONE`) gets entries for all of them.

n. **Outage fallback = Zoom (owner decision 5).** One master Zoom meeting link for the whole school lives in the server env var `LESSON_FALLBACK_URL` (validated at startup: `https://` + a `zoom.us` host). Nothing is stored per teacher. `sessions.fallback_join_url` stays as an admin per-lesson override, which is also the escape hatch when two lessons fall back at the same time and would otherwise share one Zoom meeting. Resolution order: session override → master link → "no backup link, contact admin". Env `LESSON_FALLBACK_MODE=on|off` forces fallback for everyone. When Pencil errors, is rate-limited, or the switch is on, `SpaceStage` renders "Classroom unavailable — join on Zoom" (new tab) plus Materials for teacher and student; the End button still works (status/`actual_end` only) and sets `analysis_status='no_recording'` so the report editor shows "write from notes"; no transcript or coaching exists for Zoom lessons. Runbook in README.

o. **Second device for writing (iPad + laptop).** Pencil supports one account in the same Space on several devices and bills it once; the constraints (helpdesk "Can I join a Space from more than one device?") are: never join the *call* from the second device (tap "Not Now" on the call prompt), keep its speaker off to avoid echo, and never open the Space twice on one device. The whiteboard supports an iPad stylus in the browser (Redirect mode; iframe is unreliable on tablets). Design: the lesson page on a coarse-pointer device shows two buttons: **"Join the call here"** (normal lesson params: `startCall=true&skipCallHostCheck=true&standalone=true&gv=true`) and **"Use this device for writing"**, which mints a URL with `standalone=true` only (no `startCall`/`skipCallHostCheck`), opens it in a new tab and shows the three rules above; the student signs into our app on the iPad as usual and each tap re-mints its own authorize URL (one token per device, 3600 s; a login on the iPad does not log the laptop out because Pencil sessions are per browser). The desktop iframe stays the call device, so the lesson clock still starts from the laptop's `participant_join`. Pencil analytics key attendees by `userId`, so the two devices are one attendee (`spaceCountJoined` increments; `callDuration` is unaffected). Nothing in our data model changes; one extra `purpose:'board'` value in `mintJoinUrl`/`pencil.join` audit.

## Data model

New table `pencil_spaces` rather than columns on `notebooks`: `notebooks` is a tldraw artefact (jsonb snapshot, Realtime channel, `attach_notebook` trigger) scheduled for deletion, and a Space carries hosts, settings and an external id. Pencil identity and the opt-out flag live in **service-only tables**, not on `profiles`: `profiles_update_self` (0003) has no `with check` and no column guard, so anything on `profiles` is self-writable from the browser or the mobile anon client. Naming rule: `pencil_space_id` always holds Pencil's 24-hex id; our uuid FK is `space_id`.

### `supabase/migrations/0017_pencil_spaces.sql`

```sql
-- 1. Close the pre-existing profiles self-update hole (now load-bearing for every new policy)
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.current_profile_role();   -- null for service role
begin
  if r is not null and r <> 'admin'
     and (new.role, new.email) is distinct from (old.role, old.email) then
    raise exception 'only admins may change role or email';
  end if;
  return new;
end $$;
drop trigger if exists on_profile_guard on public.profiles;
create trigger on_profile_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- 2. Pencil identity: service-role writes, admin-only reads (staff Pencil ids are not public)
create table if not exists public.pencil_users (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  pencil_user_id text not null unique,
  pencil_email   text,
  pencil_name    text,                       -- what we sent: first name (students) / display_name (staff)
  created_at     timestamptz not null default now()
);
alter table public.pencil_users enable row level security;
drop policy if exists pencil_users_admin_read on public.pencil_users;
create policy pencil_users_admin_read on public.pencil_users for select using (public.is_admin());

-- 3. Recording policy = OPT-OUT: presence of a row means "do not record"
create table if not exists public.recording_opt_outs (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  set_by     uuid references public.profiles(id),
  set_at     timestamptz not null default now(),
  note       text
);
alter table public.recording_opt_outs enable row level security;
drop policy if exists recording_opt_outs_admin_read on public.recording_opt_outs;
create policy recording_opt_outs_admin_read on public.recording_opt_outs for select using (public.is_admin());

-- 4. One persistent Space per (student, course)
create table if not exists public.pencil_spaces (
  id                      uuid primary key default gen_random_uuid(),
  student_id              uuid not null references public.profiles(id) on delete cascade,
  course_id               uuid not null references public.courses(id) on delete cascade,
  external_id             text not null unique,          -- '<course_id>:<student_id>'
  pencil_space_id         text unique,                   -- Pencil id; null only when status='mock'
  link                    text,                          -- spaces/create .link
  title                   text,
  host_profile_ids        uuid[] not null default '{}',
  participant_profile_ids uuid[] not null default '{}',
  hosts_synced_at         timestamptz,
  recording_disabled      boolean not null default false, -- written only after a confirmed read-back
  recording_verified_at   timestamptz,
  status                  text not null default 'active' check (status in ('active','archived','mock')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (student_id, course_id)
);
alter table public.pencil_spaces enable row level security;
drop policy if exists pencil_spaces_admin_read on public.pencil_spaces;
create policy pencil_spaces_admin_read on public.pencil_spaces for select using (public.is_admin());
-- app code reads Spaces with the admin client after its own authorization check
drop trigger if exists on_pencil_spaces_touch on public.pencil_spaces;
create trigger on_pencil_spaces_touch before update on public.pencil_spaces
  for each row execute function public.touch_updated_at();

-- 5. Sessions: Space actually used, Pencil session id (NOT unique: a forgotten End can span lessons),
--    analysis state (non-sensitive), outage fallback
alter table public.sessions add column if not exists space_id          uuid references public.pencil_spaces(id) on delete set null;
alter table public.sessions add column if not exists pencil_session_id text;
alter table public.sessions add column if not exists analysis_status   text not null default 'none'
  check (analysis_status in ('none','pending','done','skipped_opt_out','no_recording','failed'));
alter table public.sessions add column if not exists fallback_join_url text;
create index if not exists sessions_pencil_session_idx on public.sessions (pencil_session_id) where pencil_session_id is not null;
-- NOTE: on_session_attach_notebook stays until 0019 (homework canvas keeps working through Phases 1-2)

-- 6. Per-Pencil-session state machine
create table if not exists public.pencil_sessions (
  pencil_session_id    text primary key,
  pencil_space_id      text not null,
  space_id             uuid references public.pencil_spaces(id) on delete set null,
  hint_session_id      uuid references public.sessions(id) on delete set null,  -- from End button / joinSpace, unverified
  session_id           uuid references public.sessions(id) on delete set null,  -- verified by analytics; null = unmatched
  taught_by_profile_id uuid references public.profiles(id),
  teacher_present      boolean, student_present boolean,
  started_at           timestamptz, ended_at timestamptz,
  recording_id         text,
  state                text not null default 'live' check (state in
    ('live','ended','analytics_done','awaiting_transcript','transcript_done','done',
     'skipped_opt_out','no_recording','no_show','unmatched','failed')),
  analytics            jsonb, analytics_at timestamptz, recording_at timestamptz,
  transcript_at        timestamptz, claude_at timestamptz, coach_report_at timestamptz,
  safeguarding         jsonb,
  attempts             int not null default 0, last_error text, next_poll_at timestamptz,
  created_at           timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists pencil_sessions_session_idx on public.pencil_sessions (session_id);
create index if not exists pencil_sessions_poll_idx on public.pencil_sessions (next_poll_at) where next_poll_at is not null;
alter table public.pencil_sessions enable row level security;
drop policy if exists pencil_sessions_admin_read on public.pencil_sessions;
create policy pencil_sessions_admin_read on public.pencil_sessions for select using (public.is_admin());
drop trigger if exists on_pencil_sessions_touch on public.pencil_sessions;
create trigger on_pencil_sessions_touch before update on public.pencil_sessions
  for each row execute function public.touch_updated_at();

-- 7. Webhook ledger (idempotency + replay) and job queue; service-role only
create table if not exists public.pencil_webhook_events (
  id            uuid primary key default gen_random_uuid(),
  delivery_key  text not null unique,   -- `${_type}:${eventType}:${sessionId|recordingId|eventId}:${timestamp}`
  event_group   text, event_type text not null,
  space_id      text, pencil_session_id text, recording_id text,
  payload       jsonb not null,         -- never contains the Authorization header
  status        text not null default 'received' check (status in ('received','queued','processed','ignored','failed')),
  error         text, received_at timestamptz not null default now(), processed_at timestamptz
);
alter table public.pencil_webhook_events enable row level security;
drop policy if exists pencil_webhook_events_admin_read on public.pencil_webhook_events;
create policy pencil_webhook_events_admin_read on public.pencil_webhook_events for select using (public.is_admin());

create table if not exists public.pencil_jobs (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null check (kind in ('ingest_session','ingest_recording','ingest_transcript',
                      'run_claude','ingest_coach_report','apply_space_settings','delete_recording','reconcile','retention')),
  pencil_session_id text, recording_id text, pencil_space_id text,
  session_id        uuid references public.sessions(id) on delete cascade,
  dedupe_key        text unique,          -- e.g. 'ingest_session:<pencilSessionId>'
  state             text not null default 'queued' check (state in ('queued','running','done','failed','dead')),
  attempts          int not null default 0, run_after timestamptz not null default now(),
  locked_at         timestamptz, last_error text, created_at timestamptz not null default now()
);
create index if not exists pencil_jobs_due_idx on public.pencil_jobs (run_after) where state = 'queued';
alter table public.pencil_jobs enable row level security;   -- no policies: service role only
notify pgrst, 'reload schema';
```

### `supabase/migrations/0018_pencil_post_session.sql`

```sql
alter table public.transcripts add column if not exists source text not null default 'daily' check (source in ('daily','pencil','demo'));
alter table public.transcripts add column if not exists pencil_recording_id text;
alter table public.transcripts add column if not exists pencil_session_id   text;
alter table public.transcripts add column if not exists pencil_summary      text;   -- Pencil AI summary, prompt context only
alter table public.transcripts add column if not exists raw                 jsonb;  -- GET /transcriptions payload; nulled by retention
alter table public.transcripts add column if not exists received_at         timestamptz not null default now();

alter table public.session_metrics add column if not exists talk_source        text not null default 'transcript' check (talk_source in ('transcript','pencil_analytics'));
alter table public.session_metrics add column if not exists teacher_speaking_s int;
alter table public.session_metrics add column if not exists student_speaking_s int;
alter table public.session_metrics add column if not exists teacher_camera_pct real;   -- 0..1 fraction, like talk pct
alter table public.session_metrics add column if not exists student_camera_pct real;
alter table public.session_metrics add column if not exists pencil_analytics   jsonb;
-- (all transcript-derived columns are already nullable in 0001 -> analytics-only rows are legal)

alter table public.teacher_feedback add column if not exists source             text not null default 'browser' check (source in ('browser','pencil_pipeline','demo'));
alter table public.teacher_feedback add column if not exists ai_used            boolean not null default false;
alter table public.teacher_feedback add column if not exists pencil_coach       jsonb;   -- /reports .coaching
alter table public.teacher_feedback add column if not exists pencil_coach_score real;
alter table public.teacher_feedback add column if not exists pencil_coach_at    timestamptz;
alter table public.teacher_feedback add column if not exists notified_at        timestamptz;

alter table public.reports add column if not exists ai_prefilled_at    timestamptz;
alter table public.reports add column if not exists next_lesson_agenda text;
alter table public.reports add column if not exists created_at         timestamptz not null default now();
alter table public.reports add column if not exists id                 uuid not null default gen_random_uuid(); -- mobile selects it
create unique index if not exists reports_id_idx on public.reports (id);

-- Unreviewed AI drafts are coaching-class data: teacher + admin only, never on `sessions` (families select * there)
create table if not exists public.session_ai_outputs (
  session_id           uuid primary key references public.sessions(id) on delete cascade,
  next_session_id      uuid references public.sessions(id) on delete set null,   -- lesson the agenda draft is for
  agenda_draft         text,
  homework_suggestion  text,
  followup_suggestions jsonb not null default '[]'::jsonb,
  model                text,
  created_at           timestamptz not null default now()
);
alter table public.session_ai_outputs enable row level security;
drop policy if exists session_ai_outputs_read on public.session_ai_outputs;
create policy session_ai_outputs_read on public.session_ai_outputs for select using (
  public.is_admin() or exists (select 1 from public.sessions s
    where s.id = session_ai_outputs.session_id and s.teacher_id = auth.uid()));

alter table public.followups drop constraint if exists followups_type_check;
alter table public.followups add constraint followups_type_check check (type in
  ('attendance_gap','no_show','report_flag','low_rating','homework_overdue',
   'teacher_commitment','concept_gap','parent_contact'));
alter table public.followups add column if not exists source      text not null default 'manual' check (source in ('manual','scan','report','ai','pipeline'));
alter table public.followups add column if not exists details     jsonb not null default '{}'::jsonb;  -- {quote, at_ms, suggested_action}
alter table public.followups add column if not exists dedupe_key  text;
alter table public.followups add column if not exists assigned_to uuid references public.profiles(id);  -- teacher_commitment -> teacher
create unique index if not exists followups_dedupe_key_idx on public.followups (dedupe_key) where dedupe_key is not null;
-- notifications (0001) starts being written: types 'coaching_ready', 'report_draft_ready'; notifications_owner suffices.
notify pgrst, 'reload schema';
```

### `supabase/migrations/0019_homework_space.sql`

```sql
alter table public.homework add column if not exists space_id     uuid references public.pencil_spaces(id) on delete set null;
alter table public.homework add column if not exists board_hint   text;      -- 'HW 14 Oct · Quadratics' (naming convention, no boards API)
alter table public.homework add column if not exists ai_suggested boolean not null default false;
create index if not exists homework_space_idx on public.homework (space_id);
drop trigger if exists on_session_attach_notebook on public.sessions;        -- homework canvas is gone from here on
-- notebook_id / notebook_page_id are no longer written; dropped in 0020.

-- Our app is the state of record: split the permissive homework_mark policy and guard columns.
drop policy if exists homework_mark on public.homework;
drop policy if exists homework_family_update on public.homework;
create policy homework_family_update on public.homework for update
  using (student_id = auth.uid() or public.is_parent_of(student_id))
  with check (student_id = auth.uid() or public.is_parent_of(student_id));
drop policy if exists homework_staff_update on public.homework;
create policy homework_staff_update on public.homework for update
  using (public.is_admin() or public.teaches_student(student_id))
  with check (public.is_admin() or public.teaches_student(student_id));

create or replace function public.guard_homework_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.current_profile_role();   -- null for service role -> no guard
begin
  if r is null or r = 'admin' then return new; end if;
  -- identity fields are read-only for everyone but admin/service (no re-homing between siblings or Spaces)
  if (new.student_id, new.course_id, new.session_id, new.space_id, new.board_hint, new.ai_suggested, new.assigned_at)
     is distinct from
     (old.student_id, old.course_id, old.session_id, old.space_id, old.board_hint, old.ai_suggested, old.assigned_at) then
    raise exception 'homework identity fields are read-only';
  end if;
  if r in ('student','parent') then
    -- families may change only: status (assigned|incomplete -> submitted), submitted_at, attachments
    if new.status is distinct from old.status
       and not (old.status in ('assigned','incomplete') and new.status = 'submitted') then
      raise exception 'students may only submit homework';
    end if;
    if (new.mark_correct, new.mark_incorrect, new.mark_not_done, new.feedback, new.verified_by, new.verified_at,
        new.review_note, new.completed_at, new.description, new.due_at, new.marked_by)
       is distinct from
       (old.mark_correct, old.mark_incorrect, old.mark_not_done, old.feedback, old.verified_by, old.verified_at,
        old.review_note, old.completed_at, old.description, old.due_at, old.marked_by) then
      raise exception 'students may not change grading fields';
    end if;
    if new.status = 'submitted' and old.status <> 'submitted' then new.submitted_at := coalesce(new.submitted_at, now()); end if;
  elsif r = 'teacher' and new.status is distinct from old.status
        and not ((old.status = 'submitted' and new.status in ('completed','incomplete'))
              or (old.status = 'completed' and new.status = 'incomplete')) then   -- re-grade allowed
    raise exception 'teachers may only verify, send back or re-open submitted homework';
  end if;
  return new;
end $$;
drop trigger if exists on_homework_guard on public.homework;
create trigger on_homework_guard before update on public.homework for each row execute function public.guard_homework_update();
notify pgrst, 'reload schema';
```

### `supabase/migrations/0020_drop_notebooks.sql` (after the export window)

```sql
alter table public.homework drop column if exists notebook_page_id;
alter table public.homework drop column if exists notebook_id;
alter table public.sessions drop column if exists notebook_id;
drop function if exists public.attach_notebook();
drop trigger if exists on_notebook_touch on public.notebooks;
drop policy if exists notebooks_access on public.notebooks;
drop table if exists public.notebooks;
notify pgrst, 'reload schema';
```

**Backfill / seed.** `seed.sql`: after 0019 the `(select id from public.notebooks …)` subselects become explicit `null`; insert one `pencil_spaces` row per enrollment with `status='mock'`, `external_id='<course>:<student>'`; set `homework.space_id` from it; for session …0001 set `transcripts.source='pencil'` with a `pencil_summary`, `teacher_feedback.source='demo'`, `session_metrics.talk_source='transcript'`, `sessions.analysis_status='done'`, plus a matching `pencil_sessions` row (`state='done'`); add a `recording_opt_outs` row for student …b3 (Lena) to seed the opted-out path. Export existing tldraw pages to PNG/PDF into `homework.attachments` before running 0020 (one-off script; owner may accept loss if pre-production). `.env.example` and README list `SUPABASE_SERVICE_ROLE_KEY` as a hard go-live prerequisite (`createSupabaseAdminClient()` returns null without it and the Pencil path would silently answer `{skipped:true}`).

## File-by-file changes

**Dependencies.** Phase 1 removes `@daily-co/daily-js`, `@daily-co/daily-react` (only `daily-room.tsx`) and `jotai` (unused). `tldraw` and `transpilePackages: ['tldraw']` stay until Phase 3 because `homework-canvas.tsx`, `use-notebook-sync.ts` and `actions/notebook.ts` keep the homework canvas working; confirmed no other importer in `src/` or `mobile/`. Keep `@anthropic-ai/sdk`, `zod`, `luxon`, `@supabase/*`. No new runtime dependency (plain `fetch`).

### Lesson room
| Path | Action | What / why |
|---|---|---|
| `src/app/lesson/[sessionId]/page.tsx` | modify | Keep access rule + `AccessDenied`; drop `loadNotebookSnapshot`; DB-only reads via admin client (`pencil_spaces`, `pencil_users`, `recording_opt_outs`); hard stop when opted out and `!recording_disabled`; parents get a status card (teacher name, elapsed, recording status) with no Space; pass `{studentPencilUserId, recordingOn, fallbackJoinUrl, mode}` — never a join URL. |
| `src/app/lesson/[sessionId]/error.tsx` | new | Route error boundary so a thrown error never blanks the Materials panel. |
| `src/components/lesson/lesson-room.tsx` | modify | Centre `<SpaceStage>`; rail `<MaterialsPanel>`; tabs `space\|materials`; delete inline `CoachChip` (line 293), `useIsDesktop` (280, existed only for Daily's single call object), the three coaching `useEffect`s (96–139), the `Dialog`/`ScoreBars`/`Sparkles`/`TeacherFeedback` imports and `getSegments` prop of `EndLessonButton`, the `DEMO_LESSON_TRANSCRIPT` import, `VideoStage`; postMessage handler (source + origin check) → `startSessionClock` gated on the student; `EndLessonButton` → `endLesson(id, outcome)` with "Mark as no-show" when the student never joined; unmounts the iframe on End; `BroadcastChannel` lock. |
| `src/components/lesson/space-stage.tsx` | new | Calls `POST /api/lesson/[id]/space` on mount; iframe (`allow="clipboard-read; clipboard-write; display-capture; fullscreen; autoplay; camera; microphone; picture-in-picture; compute-pressure"`, `referrerpolicy="no-referrer"`); 15 s `ready` watchdog → "Open in a new tab" (re-mints, `window.open … noopener,noreferrer`); "Classroom unavailable — Retry / fallback link" state; renders `MockSpacePanel` when `{configured:false}` in demo. |
| `src/components/lesson/video-panel.tsx` | modify | `MockVideoPanel` → `MockSpacePanel` (board area + tiles + "Pencil Spaces not configured — sample room", "Simulate student joins" button firing the same handler as `participant_join`); `ProviderBadge` reads `Pencil Spaces` / `Mock Space`. |
| `src/components/lesson/video-stage.tsx`, `daily-room.tsx`, `notebook-panel.tsx`, `lesson-timer.tsx` | remove | Daily/tldraw lesson panel/dead code. |
| `src/components/lesson/materials-panel.tsx`, `src/app/api/materials/*`, `src/lib/materials/portal.ts` | keep | Unchanged (note: real mode still needs portal `/api/v1` routes that `/home/user/material` lacks — pre-existing, not Pencil). |
| `src/components/session-card.tsx`, `src/app/(app)/home/page.tsx` | modify | Parent perspective: "Lesson in progress" / "Recorded" status instead of Join buttons (parents have no Pencil user). |
| `src/app/api/lesson/[sessionId]/video/route.ts` | remove | Replaced by `src/app/api/lesson/[sessionId]/space/route.ts`: same access block, `rateLimit(pencilJoin 30/h)`, provisioning when missing, opt-out hard stop, `mintJoinUrl`, `logAudit pencil.join`, `{configured, url, mode, fallbackJoinUrl}`. |
| `src/lib/video/daily.ts` | remove | Replaced by `src/lib/pencil/*`. |
| `src/lib/actions/sessions.ts` | modify | Keep scheduling; `assignTeacher` refuses `in_progress`/`completed`, fire-and-forget additive `syncHosts` with admin client; add `endLesson(sessionId, outcome)` (caller check, `.select('id')`, best-effort `endOngoingSession`, `pencil_sessions` upsert, audit, revalidate); `startSessionClock` unchanged. |
| `src/lib/actions/people.ts` | new | `setRecordingOptOut(studentId, optOut)`: `requireRole('admin')`, admin client, `applyRecordingPolicy` + read-back, 3 h warning + follow-up, enqueue `delete_recording` jobs, `logAudit`. |
| `src/app/globals.css` | modify | Keep `.bg-dotted` for `MockSpacePanel`. |
| `next.config.mjs` | modify | CSP `frame-src` header for `/lesson/*`, `/hw/*`; `transpilePackages` removal deferred to Phase 3. |
| `sentry.server.config.ts`, `sentry.client.config.ts` | modify | `beforeSend`/`beforeBreadcrumb` scrub `token=` query params and `/authorize` URLs. |

### Pencil library (new, all `server-only`)
| Path | Action | What / why |
|---|---|---|
| `src/lib/pencil/client.ts` | new | `pencilConfigured`, `pencilFetch` (configurable timeout/retries), typed wrappers for every endpoint in the API table, `PencilError`. |
| `src/lib/pencil/types.ts` | new | zod schemas for responses/webhook payloads (permissive `.passthrough()`). |
| `src/lib/pencil/authz.ts` | new | `canHostSpace`, `canJoinLesson` (shared by page, routes, actions, mobile routes). |
| `src/lib/pencil/provision.ts` | new | `ensurePencilUser(admin, profile)` (first-name rule), `ensureSpace(admin, studentId, courseId, {teacherId})`, `syncHosts`, `applyRecordingPolicy` (PATCH + confirm GET), externalId recovery; all audited. |
| `src/lib/pencil/urls.ts` | new | `buildSpaceUrl(link, params)`, `mintJoinUrl(viewer, space, purpose:'lesson'\|'homework')` (5 s, no retry). |
| `src/lib/pencil/webhooks.ts` | new | pure `verifyBearer` (SHA-256 digests + `timingSafeEqual`), `parsePayload`, `deliveryKey`, `jobsFor(payload)`. |
| `src/lib/pencil/transcript.ts` | new | pure `toSegments(transcription, {teacherIds, studentIds})` → `TranscriptSegment[]` (s → ms, lesson-relative, unknown `userId` dropped + counted). |
| `src/lib/pencil/analytics.ts` | new | pure `talkSplit(attendees, ids)` → 0–1 fractions, `cameraPct` (0–1), `presence(attendees, ids)`. |
| `src/lib/pencil/correlate.ts` | new | pure `pickSession(candidates, sessionStart, presence)` window matcher; documents the "already bound" rule. |
| `src/lib/pencil/mock.ts` | new | mock Space/user/transcription when `!pencilConfigured \|\| isDemoMode`. |
| `src/lib/pencil/fixtures/transcription.ts` | new | demo transcript in `GET /transcriptions` shape (replaces `demo-transcript.ts`, exercised through `toSegments`). |

### Coaching / post-session
| Path | Action | What / why |
|---|---|---|
| `src/lib/actions/coaching.ts` | modify | Delete `finalizeLesson`, `logLiveEvent`; file becomes thin (or fold `endLesson` here). |
| `src/lib/coaching/post-session.ts` | new | `runStep(admin, pencilSession, kind)` implementing the state machine steps below; every step starts with Space verification + opt-out re-check. |
| `src/lib/coaching/coach.ts`, `live-llm.ts`, `use-live-coach.ts`, `demo-transcript.ts`, `src/app/api/coach/live/route.ts` | remove | Live coaching dropped. |
| `src/lib/coaching/metrics.ts` | keep | Pure; override happens in post-session.ts, in fractions. |
| `src/lib/coaching/analyze.ts` | modify | `ctx.pencilSummary?: string` appended as "Platform summary (context only)". |
| `src/lib/reports/draft.ts` | modify | Optional `pencilSummary`, `feedback`; schema adds `next_lesson_agenda`, `followups[{type, reason, priority}]`; no-notes wording. |
| `src/lib/data/coaching.ts` | modify | Drop `live_events` nudges query (fixes the `created_at`-vs-`ts` bug by removal) and the dead `demoProfiles`/`DateTime` imports; add `pencilCoach`, `talkSource`, camera fields, `analysisStatus`; `getPendingAnalysis(teacherId)`; demo branch reads `src/lib/demo/runtime.ts`. |
| `src/lib/data/reports.ts` | modify | `getSessionTranscript` returns `pencilSummary`; client-parameterised variant for the admin client; demo branch uses the fixture via `toSegments`. |
| `src/lib/data/sessions.ts` | modify | `findSessionForPencilEvent(admin, …)`, `getNextScheduledSession(admin, studentId, courseId, afterISO)`. |
| `src/lib/data/people.ts` | modify | `isRecordingOptedOut(admin, studentId)`, `getPencilUser(admin, profileId)`; `getConsents` no longer gates anything. |
| `src/lib/rate-limit.ts` | modify | Remove `coachLive`, `finalizeLesson`; add `rateLimitStrict()` (deny on error/unconfigured); `pencilPipeline {3/day}` keyed `ai:pencil_pipeline:<sessionId>` + `ai:pencil_pipeline:global {200/day}` (strict); `pencilJoin {30/h}` per profile (page route + mobile routes). |
| `src/app/api/webhooks/pencil/route.ts` | new | Bearer verify, ledger, enqueue, 200. |
| `src/app/api/cron/pencil-jobs/route.ts` | new | Job drainer + reconciliation + retention (`maxDuration = 300`, hard cap 6 Claude calls per run). |
| `vercel.json` | modify | Add `/api/cron/pencil-jobs` `*/5 * * * *`. |
| `src/middleware.ts` | modify | Exclude `api/webhooks` and `api/cron` from `updateSession`. |

### Reports / follow-ups / notifications
| Path | Action | What / why |
|---|---|---|
| `src/lib/actions/reports.ts` | modify | Homework insert: drop `notebook_id` (Phase 3), set `space_id`, `board_hint`, `ai_suggested`; `ReportInput.next_lesson_agenda` → "Use as agenda" copies `session_ai_outputs.agenda_draft` into `sessions.agenda` of `next_session_id` under `sessions_teacher_update`; `generateReportDraft` passes `pencilSummary`. |
| `src/components/teacher/report-editor.tsx` | modify | Banner "AI pre-drafted from the transcript", Pencil summary read-only, agenda field, "Not recorded (opted out)" state; notes optional. |
| `src/app/(app)/teacher/reports/page.tsx`, `[sessionId]/page.tsx` | modify | "AI draft ready" badge; load summary/status/`session_ai_outputs`. |
| `src/lib/followups/raise.ts` | new | Shared idempotent `raiseFollowup(client, …)` with `dedupe_key`. |
| `src/lib/actions/followups.ts`, `src/lib/data/followups.ts` | modify | Use `raiseFollowup`; demo rows for the three new types. |
| `src/lib/types.ts` | modify | `Profile += whatsapp_opt_in` (drift fix; **no** pencil/opt-out fields on Profile); new `PencilUser`, `PencilSpace`, `SessionAiOutputs`; `Session += space_id, pencil_session_id, analysis_status, fallback_join_url` (keep `notebook_id` marked `@deprecated` until 0020); `Homework += space_id, board_hint, ai_suggested` (keep `notebook_*` deprecated); `FollowupType`/`FOLLOWUP_LABEL` + 3 types; `Followup += source, details, dedupe_key, assigned_to`. |
| `src/app/(app)/admin/followups/page.tsx` | modify | `defaultBody` cases for new types; `teacher_commitment` shows "Remind teacher" instead of `MessageParentDialog`; "AI" badge. |
| `src/lib/messaging/notify.ts` | modify | `notifyTeacherCoachingReady({teacherId, sessionId})`: `notifications` row + `sendExpoPush` (no WhatsApp). |
| `src/lib/data/notifications.ts`, `src/lib/actions/notifications.ts` | new | Server `getNotifications(profile)`; server action `markNotificationRead(id)` (cookie client; `notifications_owner` is `for all`). |
| `src/app/(app)/layout.tsx`, `src/components/app-shell.tsx` | modify | Layout (server) loads notifications and passes them to the client `AppShell`, which renders the bell and calls `markNotificationRead`. |
| `src/app/(app)/coaching/[sessionId]/page.tsx`, `teacher/coaching/page.tsx` | modify | Two coaching cards, Pencil summary card, remove nudges card, "analysis pending" strip, speaking-time label. |
| `src/app/(app)/admin/people/page.tsx` | modify | Replace `REQUIRED_STUDENT_CONSENTS` badge with "Recording: on / opted out" toggle → `setRecordingOptOut`, "Pencil linked" badge (admin client reads). |
| `src/app/(app)/admin/audit/page.tsx` | modify | Extend `ACTION_TONE` with every action in (m). |

### Homework (Phase 3)
| Path | Action | What / why |
|---|---|---|
| `src/app/hw/[id]/page.tsx` | modify | Keep role gating; drop snapshot; pass `spaceReady`, `canOpenSpace` (student self, admin, teacher passing `canHostSpace` — parents false) to `HomeworkWorkspace`. |
| `src/components/homework/homework-workspace.tsx` | new | Header/status/Actions/AttachmentsBar/marks + "Open my Space board" (re-mints per click, new tab), board-hint instructions ("do not start a call"), mock panel in demo; parent mode hides the Space button. |
| `src/components/homework/homework-canvas.tsx`, `homework-canvas-loader.tsx`, `src/lib/notebook/use-notebook-sync.ts`, `src/lib/actions/notebook.ts` | remove | tldraw (Phase 3, together with the `tldraw` dependency). |
| `src/components/homework/attachments-bar.tsx`, `grade-dialog.tsx`, `homework-marks.tsx`, `homework-list.tsx`, `src/app/api/homework/**` | keep | Fallback evidence path; grade dialog gets an "Open board in Space" link (host, `canHostSpace`). |
| `src/lib/actions/homework.ts` | modify | Delete `setHomeworkPage`; `submitHomework` actor check (student/parent-of/admin) + `logAudit 'homework.submit'` + fix `revalidatePath('/hw/${id}')`; add `getHomeworkSpaceLink(id)` resolving the Space from `(hw.student_id, hw.course_id)` via `pencil_spaces`, never from `homework.space_id`, with `canHostSpace`/self check, opt-out hard stop, `pencilJoin` limit, audit. |
| `src/lib/data/homework.ts` | modify | No `pencil_spaces` join (admin-only table); demo fixtures use mock space ids `space-<student>-<course>` from `demoSpaces`. |
| `src/app/(app)/home/homework/page.tsx`, `teacher/homework/page.tsx` | modify | Copy: notebook → Space board; students told to upload a photo of the board when submitting. |

### Platform / config / docs
`.env.example` (replace Daily/Deepgram block with Pencil block; `SUPABASE_SERVICE_ROLE_KEY` required for Pencil; `LESSON_FALLBACK_MODE`), `README.md` (incl. Pencil outage runbook), `src/app/layout.tsx` + `login/page.tsx` copy, `package.json`, `supabase/seed.sql`, `tests/*` (below). `src/lib/demo/data.ts` | modify: `sv()` gains `space_id` (mock `space-<short>-<course>`), `pencil_session_id: null`, `analysis_status: 'none'`, `fallback_join_url: null`; `p()` gains `whatsapp_opt_in`; new `demoSpaces` keyed (student, course) consumed by `src/lib/pencil/mock.ts` and `data/homework.ts`; new `demoRecordingOptOuts = ['…b3']`; `demoConsents` reduced to the `teacher_eval` row. New `src/lib/demo/runtime.ts`: module-level in-memory map of simulated pipeline results keyed by session id, read by `getFeedbackHistory`/`getFeedbackDetail`/`getSessionTranscript` in demo mode. `src/lib/env.ts`, `supabase/*`(0001–0016), `src/lib/supabase/*`, `src/lib/data/auth.ts`, `src/lib/audit.ts`, `src/lib/observability.ts`, `src/lib/actions/bookings.ts|accounts.ts|enrollment.ts|courses.ts` keep (no eager Space creation; lazy is simpler and teacher is unknown at enrollment). Wherever `display_name` is edited (admin people dialogs), enqueue `PATCH /users/{userId} {name}` fire-and-forget.

### Mobile
`mobile/app/(tabs)/lessons.tsx` (Join → bearer `GET /api/mobile/sessions/[id]/space-link` → `Linking.openURL` of the returned `{url}`, re-minted per tap; fallback web URL; parents see status only), `mobile/app/homework/[id].tsx` ("Open in Pencil Space" for students/staff only; "Mark as done" → "Submit for review"; grading form shown only when `status === 'submitted'`, trigger errors surfaced), `mobile/lib/data.ts` (`submitHomework`, `gradeHomework` sets `verified_by`), `mobile/lib/api.ts` (`getSpaceUrl`, `getHomeworkSpaceUrl`), `mobile/lib/types.ts`, `mobile/README.md`; new routes `src/app/api/mobile/sessions/[id]/space-link/route.ts` and `src/app/api/mobile/homework/[id]/space-link/route.ts` (pattern: `profileFromBearer` + `canJoinLesson`/`canHostSpace`, opt-out hard stop, `pencilJoin`, audit `pencil.join {mode:'mobile'}`).

## Server-side Pencil module

**Env (server-only, never `NEXT_PUBLIC_` except the origin):** `PENCIL_SPACES_API_KEY` (owner-provided secret), `PENCIL_API_BASE_URL` (default `https://apis.pencilapp.com/public/api/`; staging `https://staging-apis.pencilapp.com/public/api/`), `PENCIL_WEBHOOK_SECRET`, `NEXT_PUBLIC_PENCIL_APP_ORIGIN` (`https://my.pencilapp.com` | `https://staging.pencilapp.com`, used only for the postMessage origin allowlist alongside the hard-coded pair), `LESSON_FALLBACK_URL` (master Zoom link), `LESSON_FALLBACK_MODE`, `NEXT_PUBLIC_APP_URL` (webhook URL in docs only). `pencilConfigured = Boolean(PENCIL_SPACES_API_KEY)`; every exported function short-circuits to `mock.ts` when `!pencilConfigured || isDemoMode` (mock Space row `status='mock'`, `{configured:false}` → `MockSpacePanel`). `src/lib/env.ts` is untouched (it is imported by the browser client).

```ts
// src/lib/pencil/client.ts
import "server-only";
const KEY = process.env.PENCIL_SPACES_API_KEY ?? "";
const BASE = (process.env.PENCIL_API_BASE_URL ?? "https://apis.pencilapp.com/public/api/").replace(/\/?$/, "/");
export const pencilConfigured = Boolean(KEY);
export class PencilError extends Error { constructor(public status: number, public err?: string, public error_code?: string) { super(`Pencil ${status} ${error_code ?? ""} ${err ?? ""}`); } }
type Opts = { timeoutMs?: number; retries?: number };   // jobs: 15 s / 2 retries; join path: 5 s / 0 retries

async function pencilFetch<T>(path: string, init: RequestInit = {}, opts: Opts = {}, attempt = 0): Promise<T> {
  const { timeoutMs = 15_000, retries = 2 } = opts;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path.replace(/^\//, ""), { ...init, cache: "no-store", signal: ctl.signal,
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {       // <5 QPS: back off
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1) + Math.random() * 500));
      return pencilFetch<T>(path, init, opts, attempt + 1);
    }
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new PencilError(res.status, b.err, b.error_code); }
    return (await res.json()) as T;
  } finally { clearTimeout(t); }
}
export const createApiUser = (b: { name: string; userRole: "Student" | "Teacher"; externalId: string }) => pencilFetch<ApiUser>("users/createAPIUser", { method: "POST", body: JSON.stringify(b) });
export const authorizeUrl = (userId: string, redirectUrl: string) => pencilFetch<{ url: string }>(`users/${userId}/authorize?redirectUrl=${encodeURIComponent(redirectUrl)}`, {}, { timeoutMs: 5_000, retries: 0 });
export const createSpace = (b: CreateSpaceBody) => pencilFetch<Space>("spaces/create", { method: "POST", body: JSON.stringify({ visibility: "private", notifyInvitees: false, ...b }) });
export const getSpace = (spaceId: string) => pencilFetch<Space>(`spaces/${spaceId}`);
export const updateSpaceUsers = (spaceId: string, b: UpdateUsersBody) => pencilFetch<Space>(`spaces/${spaceId}/updateUsers`, { method: "PATCH", body: JSON.stringify({ notifyInvitees: false, ...b }) });
export const updateSpaceSettings = (spaceId: string, settings: { disableAlwaysOnRecording?: boolean }) => pencilFetch<unknown>(`spaces/${spaceId}/settings/`, { method: "PATCH", body: JSON.stringify({ settings }) });
export const endOngoingSession = (spaceId: string) => pencilFetch<{ endedSessionId: string; newSessionId: string | null }>(`spaces/${spaceId}/endOngoingSession`, { method: "POST" }, { timeoutMs: 5_000, retries: 0 });
export const getAnalyticsSession = (id: string) => pencilFetch<AnalyticsSession>(`analytics/sessions/${id}`);
export const getSessionReports = (id: string) => pencilFetch<SessionReports>(`analytics/sessions/${id}/reports`);
export const listRecordings = (spaceId: string, q: { startingAfter?: string; endingBefore?: string }) => pencilFetch<{ recordings: Recording[] }>(`spaces/recordings/${spaceId}?${new URLSearchParams(q)}`);
export const deleteRecording = (spaceId: string, recordingId: string) => pencilFetch<unknown>(`spaces/recordings/${spaceId}/${recordingId}`, { method: "DELETE" });
export const getTranscription = (recordingId: string) => pencilFetch<Transcription>(`transcriptions/${recordingId}`);
// + patchUser, findSpacesByExternalId, getRecordingDownload, listAnalyticsSessions, registerWebhook
```

Rules: authorize URLs are credentials — minted per click, returned only from `POST`/bearer routes, never persisted, never logged, never placed in `href` attributes or props rendered server-side (they would land in the HTML/RSC payload); Sentry `beforeSend`/`beforeBreadcrumb` strip `token=` and `/authorize` on server and client. Writes from provisioning/webhook/jobs use `createSupabaseAdminClient()` only (webhooks carry no cookie; `transcripts`/`session_metrics`/`teacher_feedback` are select-only under RLS). Every mutation with the API key is preceded by `canJoinLesson`/`canHostSpace`/`requireRole('admin')` in the calling route or action. If `SUPABASE_SERVICE_ROLE_KEY` is unset the webhook answers 200 `{skipped:true}` like `/api/cron/reminders` and the Space routes answer `{configured:false}`.

**Webhook route** (`src/app/api/webhooks/pencil/route.ts`): `export const dynamic = "force-dynamic"`; fail closed when `PENCIL_WEBHOOK_SECRET` is unset (503) or the Bearer mismatches (401; compare `sha256(header)` with `sha256(secret)` via `crypto.timingSafeEqual` — equal length by construction); never log the header; parse with zod; insert `pencil_webhook_events` (`delivery_key` conflict → 200 `duplicate`); `jobsFor(payload)`: `SESSION_ENDED → ingest_session`, `RECORDING_AVAILABLE → ingest_recording`, other `SPACE_RECORDING → ingest_transcript`, `SPACE_USER joinSpace → inline`: upsert `pencil_sessions(pencil_session_id, pencil_space_id, state='live', hint_session_id = in-window lesson for that Space)` — **no write to `sessions`**; everything else `ignored`. Jobs carry `dedupe_key` (`kind:pencilSessionId|recordingId`) so a redelivery with a different timestamp cannot double-run. Respond 200 in < 100 ms; best-effort fire-and-forget `fetch` to the drainer with `CRON_SECRET` for low latency (not awaited; cron is the guarantee).

**Job runner** (`/api/cron/pencil-jobs`, `GET`, `Authorization: Bearer CRON_SECRET`, `export const maxDuration = 300` — requires Vercel Pro, as the existing 15-min cron already implies): claim jobs with `update … set state='running', locked_at=now() where id=$1 and state='queued' returning *`, process sequentially (well under 5 QPS and analytics' stricter limits) within a 240 s budget and a **hard cap of 6 Claude calls per invocation independent of the DB**; on error `attempts++`, `run_after = now() + 2^attempts min`, `dead` after 8 with `captureError`. Timing per lesson: analytics ingest ≈ 2 s; transcript fetch + `computeMetrics` ≈ 2 s; `analyzeLesson` (Opus, adaptive thinking) 20–60 s; `draftReport` (one call also yields agenda + follow-ups) 15–45 s; coach report ≈ 1 s. The two Claude steps are separate jobs (`ingest_transcript` runs `analyzeLesson`; `run_claude` runs `draftReport` + agenda + follow-ups + notify), so no job exceeds ~90 s and a 300 s invocation drains 3–4 lessons. End-to-end latency is dominated by Pencil (recording ≤ 1 h, AI Coach ≈ 30 min), not by our 5-minute cron. Each invocation also runs `reconcile` and `retention`.

## Post-session job: steps

Every step begins with: load `pencil_sessions` + Space; fetch the Pencil object; `if (fetched.spaceId !== space.pencil_space_id) → state='failed', last_error='space mismatch', admin follow-up, stop`; `isRecordingOptedOut(student)` re-check.

1. **`ingest_session`** (SESSION_ENDED or End button): `GET /analytics/sessions/{id}`; `presence(attendees)` via `pencil_users` → `teacher_present`, `student_present`, `taught_by_profile_id`; match the lesson per (b). **Both present:** bind `session_id`, backfill `actual_start`/`actual_end`, set `status='completed'` with `.neq('status','completed')` if the teacher never clicked End (credit fires once; `logAudit(null,'pencil.session_autocompleted')`); upsert `session_metrics` talk/camera fractions (`talk_source='pencil_analytics'`, `teacher_speaking_s`, `student_speaking_s`, `pencil_analytics`). **Teacher only:** if the lesson is not yet `completed`/`no_show`, set `status='no_show'`, `actual_end`, `raiseFollowup(no_show)`, state `no_show`, stop. **Student only / no lesson:** `unmatched`, stop. Store `safeguarding` later if non-null and raise an admin `parent_contact` follow-up (owner to confirm type). **Opt-out:** `state='skipped_opt_out'`, `sessions.analysis_status='skipped_opt_out'`, stop. Else `analytics_done`, `next_poll_at = +90 min`.
2. **`ingest_recording`**: `GET /spaces/recordings/{spaceId}` around the payload timestamp and require the `recordingId` to be listed; find the `pencil_sessions` row whose `[started_at − 5 min, ended_at + 5 min]` overlaps `startingTime` (prefer closest to `actual_start`). If the student is opted out, the row is `unmatched`/`no_show`, or no row overlaps (homework-time call): `DELETE /spaces/recordings/{spaceId}/{recordingId}`, store nothing, `logAudit(null,'pencil.recording.deleted',{reason})`, admin follow-up when the reason is opt-out. Else store `recording_id`; `sessions.recording_url` stays null (playback is Phase 4, teacher/admin only).
3. **`ingest_transcript`**: `GET /transcriptions/{recordingId}` (must equal the row's `recording_id`); empty `transcript` → retry later (≤ 3 h, then `no_recording`); `toSegments()` with `pencil_user_id` of `taught_by` and the student; upsert `transcripts {segments, source:'pencil', pencil_summary, raw}`; `computeMetrics` for the six transcript-derived fields, keeping Pencil talk fractions; `useAi = aiConfigured && rateLimitStrict(pencilPipeline per session) && rateLimitStrict(global)`; `analyzeLesson(segments, metrics, ctx, {useAi, pencilSummary})` → `teacher_feedback` with `teacher_id = taught_by_profile_id`, `source='pencil_pipeline'`, `ai_used`; enqueue `run_claude`.
4. **`run_claude`**: `draftReport({notes:'', segments, metrics, ctx, pencilSummary, feedback})` → insert `reports` only if none exists and `taught_by` is set (`teacher_id = taught_by_profile_id`, `ai_drafted=true`, `ai_prefilled_at`, `published_at=null`, `homework` = suggestion, `next_lesson_agenda`); `getNextScheduledSession` → `session_ai_outputs {next_session_id, agenda_draft, homework_suggestion, followup_suggestions}` (never `sessions.agenda`); `raiseFollowup` for each suggested `teacher_commitment` (assigned_to `taught_by`) / `concept_gap` / `parent_contact` with `source='ai'`, `dedupe_key = '<sessionId>:<type>:<slug(reason)>'`; `sessions.analysis_status='done'`; `notifyTeacherCoachingReady`; `logAudit(null, 'pencil.transcript_processed', {type:'session', id})`; `state='transcript_done'`.
5. **`ingest_coach_report`**: scheduled at `transcript_at + 10 min`, polls `GET /analytics/sessions/{id}/reports` every 15 min until `coaching != null` (≤ 4 h); store `pencil_coach`, `pencil_coach_score`; `state='done'`. If the report lands before our row exists, run step 3 first.
6. **`reconcile`** (every cron run): (i) `in_progress` lessons past `scheduled_end + 3 h` → `GET /analytics/sessions` filtered by the Space and window; attach and enqueue `ingest_session` (which applies the same evidence rules — never auto-complete without the student), or if no Pencil session exists mark `analysis_status='failed'` and raise an admin follow-up leaving `status` for the admin to settle; (ii) `analytics_done` rows past `next_poll_at` with no recording → `GET /spaces/recordings/{spaceId}`; (iii) rows with a recording but no transcript past 3 h → `getTranscription` once more, then `no_recording`; (iv) any recording listed for an opted-out student's Space → `delete_recording`. This covers a transcript webhook whose `eventType` string we do not yet recognise, lost deliveries, and settings drift.
7. **`retention`** (every cron run; Phase 2): `DELETE /spaces/recordings/{spaceId}/{recordingId}` for recordings older than the retention period (owner to confirm; default 90 days), null `transcripts.raw` after 180 days; audit each deletion.

## Homework in the Space

- **Student** (`/hw/[id]`, web or mobile): sees description, due date, `board_hint` ("Create a board called *HW 14 Oct · Quadratics* in your Space; add photos of paper work there; do not start a call"); "Open my Space board" mints an authorize URL per click (`standalone=true`, no `startCall`) in a new tab; "Submit for review" → `submitHomework` (status `submitted`; guarded by 0019; audited); the copy asks for a photo of the board via `AttachmentsBar` so parents and the audit trail have evidence.
- **Teacher** (review mode): "Open Space (host)" shown only when `canHostSpace` (assigned teacher of that course, past or present) + `GradeDialog` (verify → `completed`, send back → `incomplete`, re-open → `incomplete`); `/teacher/homework` queue unchanged.
- **Parent**: no Pencil user; sees status, marks, feedback, attachments; no Space button; `AttachmentsBar` upload allowed as today.
- **Admin**: same as teacher (admin → Pencil Teacher user, added as host lazily by `ensureSpace`).
- **Mobile**: "Open in Pencil Space" via the bearer route (system browser); "Submit for review" replaces "Mark as done"; grading form only for `submitted`.
- **Board evidence:** Pencil can export a board as an image or `.space` file, but only for *hosts* on paid plans (helpdesk "How do I download the board as image?"), so students cannot export their own board; they attach a photo or screenshot instead, and the teacher may download the board image as evidence when verifying. "Private board per participant" exists as a host UI feature (not via API) and suits assessments later.
- **Degraded path (no boards API):** no programmatic proof a board exists; grading relies on the teacher viewing the Space; attachments are the durable evidence. A student alone in the Space creates a Pencil Session but no call unless they start one; if staging shows such calls are recorded, step 2 deletes them. If Pencil adds board endpoints, `board_hint` becomes `pencil_board_id/url` with no other change.

## Lesson room UX

Header: Leave · course name + `StatusBadge` (scheduled / waiting for student / live / call ended) · peer avatar · `Elapsed` from `actual_start` ("—" in Redirect mode until analytics backfill) · recording chip ("Recording on (audio + board)" / "Not recorded (opted out)", confirmed live by `recording_status_change`; red banner if recording while opted out) · `ProviderBadge` · teacher `EndLessonButton` / "Mark as no-show". Desktop: Space iframe fills the centre (full height, replacing both video and notebook), Materials rail on the right (files open in a new tab as today). Mobile: tabs `Space | Materials`; the Space tab is a card "Open lesson in Pencil" (Redirect mode; re-mints per tap) with "Lesson open in another tab" state and the End button. Student/parent view: the same header plus a persistent "This lesson is recorded" notice; parents see a status card only. Fallback detection: no `ready` within 15 s, or `{configured:false}` from the route → overlay "Having trouble? Open in a new tab" or "Classroom unavailable — join via fallback link" while Materials stays usable. End lesson: `endLesson()` → iframe unmounted → card "Lesson ended." with, when `pencilConfigured && pipelineEnabled` (Phase 2+), "Your coaching and a report draft arrive on your Coaching page in ~30–60 min". Demo: `MockSpacePanel` with "Simulate student joins" (fires the same handler as `participant_join` with the demo student's id) and a dev-only "Simulate Pencil post-session" action that runs steps 1–5 with the fixture transcription and stores the result in `src/lib/demo/runtime.ts` so `/teacher/coaching` and `/coaching/[sessionId]` show it.

## Mobile app changes

Join → `getSpaceUrl(sessionId)` (bearer) → `Linking.openURL` of the Pencil `{url}` (no web login step; URL re-minted per tap, never cached); fallback to `lessonWebUrl` when `{configured:false}`; parents see status only. Homework as above. Push payload `data.kind='coaching_ready'` deep-links to the coaching page later (web only for now). `FollowupRow.type` is a string so new types render unchanged. No new mobile env vars.

## Privacy & minors

- Recording is opt-out at the owner's decision; recordings exclude student video ("Record participant video" OFF), include audio + whiteboard + teacher video. The lesson view always states recording status to every role; opted-out students' Spaces carry `disableAlwaysOnRecording=true` verified by read-back, with a join hard stop and automatic deletion of stray recordings.
- Pencil never receives a minor's full name: `createAPIUser.name` is the first name, Space titles use the first name; our mapping is `externalId = profiles.id`. Pencil is a processor of minors' voice recordings: DPA, data region and Pencil-side retention are go-live prerequisites (k).
- Pencil stores recordings, transcripts, summaries, AI Coach and safeguarding reports, attendance and analytics. We store transcript segments, `pencil_summary`, `raw` payload, metrics, feedback and the coach report — all teacher/admin-only under RLS (`transcripts_read`, `feedback_read`, `session_ai_outputs_read`); families read published reports only and never AI drafts.
- Retention (owner to confirm numbers): delete Pencil recordings 90 days after the lesson, null `transcripts.raw` after 180 days, keep metrics/feedback for coaching history. `DELETE /users/{userId}/remove` is permanent — never called automatically.
- `captureError` contexts never include transcript text, authorize URLs or the webhook Authorization header (`sendDefaultPii:false` stays; Sentry scrubbers added).
- Pencil identity, opt-out flags, Spaces and ledgers are admin-only tables written by the service role; `profiles.role`/`email` are guarded by trigger.

## Rollout

**Phase 0 — prerequisites (owner).** Items in (k) except always-on recording; staging key + webhook secret in Vercel preview env; `SUPABASE_SERVICE_ROLE_KEY` everywhere; HTTPS local dev cert. *Done when* `GET /webhooks` on staging shows our preview URL and a manual `POST /spaces/create` works with the key.

**Phase 1 — a real lesson in Pencil (smallest shippable).** Migration 0017; `src/lib/pencil/*` (client, authz, provision, urls, mock); lesson page + `error.tsx` + `LessonRoom`/`SpaceStage`/`MockSpacePanel`; `/api/lesson/[id]/space`; `endLesson` (completed | no_show) with `endOngoingSession`; parent status view (session card, home, lesson page); `LESSON_FALLBACK_URL` (master Zoom link) + `sessions.fallback_join_url` override + `LESSON_FALLBACK_MODE`; second-device ("use this device for writing") join mode on tablets; `setRecordingOptOut` admin toggle (flag + PATCH + read-back; no-op on recording until Phase 2); Sentry scrubbers, CSP header; delete Daily, the lesson `NotebookPanel`, live coach, `/api/coach/live`, `tests/coach.test.ts`, `jotai`. **Homework is untouched**: the tldraw homework canvas, `use-notebook-sync.ts`, `actions/notebook.ts`, the `tldraw` dependency and the `attach_notebook` trigger keep working until Phase 3 (the "Open my Space board" deep link may ship early since it needs only `ensureSpace` + `mintJoinUrl`, but is not required). Institution recording mode stays Host/Disabled. End copy is "Lesson ended." only. *Done when* a teacher and a student hold a lesson from `/lesson/[id]` on production, the clock starts only when the student is present (`participant_join` with the student's id), a teacher-only room visit ends as `no_show` and consumes no credit, End marks the session completed and consumes one credit, a student `UPDATE profiles SET role='admin'` fails (`tests/profile-guard.sql`), demo mode works with no key, Safari + Chrome (third-party cookies blocked) behaviour is documented, the Redirect fallback works on a phone, the shared-device/second-tab case is tested on staging, and unknown #6 (`endOngoingSession` vs call) is answered by Pencil.

**Phase 2 — recording + post-session pipeline.** Switch on institution always-on recording at the start of the phase; migration 0018; webhook route, jobs cron (incl. `retention`, `delete_recording`, `apply_space_settings`), `post-session.ts`, `transcript.ts`, `analytics.ts`, `correlate.ts`; coaching UI (two cards), report pre-fill + `session_ai_outputs` + agenda, AI follow-ups, teacher notifications + bell; End copy gains the "~30–60 min" line. *Done when* a recorded staging lesson yields `transcripts`, `session_metrics (talk_source='pencil_analytics', fractions 0–1)`, `teacher_feedback` with `teacher_id` = the attending teacher and both cards, a pre-filled report visible in the teacher's queue, a `session_ai_outputs` row, follow-ups on `/admin/followups`, and a push; an opted-out lesson yields `skipped_opt_out`, no recording at Pencil (or a deleted one with an audit row); a forged payload with another Space's `sessionId` ends in `state='failed'`; a lesson with the webhook disabled is reconciled by the cron; retention deletes an aged recording.

**Phase 3 — homework in the Space + mobile.** Migration 0019 (incl. the `attach_notebook` trigger drop); `HomeworkWorkspace`, `getHomeworkSpaceLink`, mobile routes/screens, RLS tightening; remove `homework-canvas*`, `use-notebook-sync.ts`, `actions/notebook.ts`, `tldraw`, `transpilePackages`. *Done when* student submits from web and mobile, teacher grades from the Space, mobile "Mark as done" is gone, the column guard rejects a student setting `completed` or moving an item to a sibling (`tests/homework-guard.sql` matrix), a teacher of another course gets no Space link.

**Phase 4 — recommended.** Events mirroring (h), recording playback route (`/api/recordings/[sessionId]/download`: `requireRole('teacher','admin')`, teacher must be `sessions.teacher_id`, rate-limited, awaited audit `pencil.recording.download`, returns the short-lived `downloadLink` without storing it), optional `hideTab` attention feed into `live_events`, tldraw export + migration 0020.

**Tests.** Remove `tests/coach.test.ts`. Keep `tests/metrics.test.ts`, `tests/heuristics.test.ts`. Add `tests/pencil-transcript.test.ts` (seconds→ms, lesson-relative, speaker mapping by `taught_by`, unknown userIds, empty/null transcript), `tests/pencil-analytics.test.ts` (talk split and camera as 0–1 fractions compatible with `computeMetrics`, zero durations, presence), `tests/pencil-correlate.test.ts` (window matcher, teacher-only → no_show, student-only → unmatched, already-bound lesson, two lessons same day), `tests/pencil-webhooks.test.ts` (digest-based bearer verify incl. length mismatch, payload discrimination, `deliveryKey`, `jobsFor`), `tests/post-session-reducer.test.ts` (transitions are monotonic and idempotent; completion requires both participants; report payload carries the attending teacher's id; opt-out re-check stops every step), `tests/profile-guard.sql` and `tests/homework-guard.sql` notes for manual psql checks. Manual: iframe in Safari (ITP) and Chrome with third-party cookies blocked; mobile Redirect; shared device back-to-back lessons; `endOngoingSession` → SESSION_ENDED arrival time; log the first transcript-ready payload to capture the `eventType`; opt-out toggle flips `settings.disableAlwaysOnRecording` and read-back confirms; join refused while unconfirmed; teacher reassignment adds the host; duplicate webhook delivery → one job; forged `sessionId` → failed.

**Rollback.** Delete the old lesson path; do not keep Daily/tldraw behind a flag. Reasons: the two stacks are entangled (single Daily call object constraint, `attach_notebook` trigger, Realtime channel, RLS-blocked `finalizeLesson` writes that never worked in real mode), a dual path doubles the test surface, and the pre-Pencil path was never live for real users. Rollback = revert the squash-merged PR per phase; migrations 0017–0019 are additive (notebooks survive until 0020), so a code revert is sufficient. Operational degrade is the fallback link, not the mock: during a Pencil outage `LESSON_FALLBACK_MODE=on` (or a per-session `fallback_join_url`) lets lessons run on a plain meeting link with Materials and End still working, while the webhook pipeline keeps processing lessons that did run; unsetting the key is never the outage path.

## Open questions

**For the product owner**
- Confirm the plan tier (Advanced for AI Coach; Expert for Summaries) and that always-on cloud recording is acceptable cost-wise (recording hours billed separately).
- Is opt-out retroactive: on opt-out we delete Pencil recordings and `transcripts.raw` for past lessons; also purge segments, summaries, our feedback and the coach report?
- Recording playback (Phase 4): teacher/admin only, or also parents of recorded students?
- Retention numbers for Pencil recordings (default 90 days) and our raw transcripts (default 180 days).
- Approve Phase 4 Events mirroring and the optional `hideTab` attention feed; or drop `live_events` entirely.
- Which families to inform about the new default-recording policy before the Phase 2 switch; wording of the in-room "This lesson is recorded" notice.

**For Pencil support**
- Exact `eventType` string of the transcript-ready `SPACE_RECORDING` event, and webhook retry/ordering semantics.
- Does `POST /spaces/{spaceId}/endOngoingSession` also end the active call and split the cloud recording?
- Does a student alone on a whiteboard (no call) trigger always-on recording or billing; can participants start a call alone in `standalone` mode?
- Can institution always-on recording be enabled by us or only by an account manager; exact propagation delay of `disableAlwaysOnRecording` for a Space with recent calls; is there a way to read the effective recording state per Space beyond `settings`?
- Does `DELETE /spaces/recordings/{spaceId}/{recordingId}` also delete the transcript, summary and AI Coach/safeguarding items derived from it; what does Pencil retain afterwards; data region; DPA for minors' recordings.
- Confirm no live teacher-coaching nudges exist and whether idle alerts are exposed beyond `hideTab/unhideTab`.
- Any plan for a boards API (create/list/export, deep-link to a board)?
- Second-device use: confirm a user who opens the Space on an iPad without joining the call is not counted as a second call participant in `GET /analytics/sessions` and does not affect always-on recording.
- Expected timings for recording availability, transcript and AI Coach report, and whether `GET /analytics/sessions/{id}/reports` returns `coaching: null` versus 404 while processing.
- Can the API key be scoped to a generic admin account that does not appear as a host in the Space UI; does the Space `frame-ancestors` policy allow our origin?
