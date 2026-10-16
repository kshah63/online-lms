# Pencil Spaces integration — implementation plan

**Status:** design reviewed with the owner (decisions 1–5 closed); Phase 1 built; Pencil support's answers folded in on 2026-10-16 (see "Pencil support answers (2026-10-16)") · **Branch:** `claude/eloquent-galileo-i6i3yh` · **Owner:** product owner · **Audience:** engineers / AI agents executing the change · **Reference:** [`api-notes.md`](./api-notes.md) (verified API + helpdesk facts), [`vendor-answers-2026-10-16.md`](./vendor-answers-2026-10-16.md) (Pencil support's answers, verbatim), [`openapi-2026-10-15.json`](./openapi-2026-10-15.json) (vendor spec), [`endpoint-summary.txt`](./endpoint-summary.txt)

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
- Homework tracking (owner decision 6): the work lives on a dedicated board in the student's Space; the student taps **Done** in our app (no photo required); Pencil's Space activity (student-only sessions after the assignment) is attached to the homework item automatically as a signal; the teacher verifies by viewing the board and recording the outcome in our app. Pencil has no assignment concept, board API or done flag, so status stays ours.
- Parent progress dashboard (owner request, Phase 5): one page per child (web + mobile tab) with lesson attendance and time, homework completion, marks, Space activity, speaking minutes, camera-on share (owner decision 7: show both) and published-report ratings over 4/12 weeks; aggregates only via a SECURITY DEFINER function; never teacher coaching data, AI drafts or transcripts; an interim v1 on today's data can ship after Phase 1. See "Parent progress dashboard (Phase 5)".
- Lessons app is Next.js 14 App Router (not 16).

## Architecture

- **Users.** Every profile that must enter a Space (student, teacher, admin) gets a Pencil API user lazily on first need via `POST /users/createAPIUser` with `externalId = profiles.id`, `userRole` `Student` for students and `Teacher` for teachers and admins. **Name sent to Pencil:** students → first name only (first token of `display_name`); staff → `display_name`. Stored in the service-only table `pencil_users` (not on `profiles`). Parents get no Pencil user (owner decision 3: status card only).
- **Spaces.** `pencil_spaces` row per (student, course), created lazily by `ensureSpace()` with `externalId = '<course_id>:<student_id>'`, `title = '<course name> · <student first name>'`, `visibility: 'private'`, `notifyInvitees: false`, `hosts = [assigned teacher]`, `participants = [student]`, and **no `owner`** (decision p: the API account stays the owner, so teachers are always removable hosts). Recovery after a failed insert: `GET /spaces` filtered by `externalId`. Host changes → `PATCH /spaces/{spaceId}/updateUsers`, only ever for profiles passing `canHostSpace`. Recording policy → `PATCH /spaces/{spaceId}/settings/`, confirmed by `GET /spaces/{spaceId}`.
- **Join.** The page renders from the DB only (no Pencil calls in the server component). The client calls `POST /api/lesson/[id]/space`, which re-applies the access rule, provisions only when rows are missing/stale, mints `GET /users/{pencilUserId}/authorize?redirectUrl=<Space link + params>` (5 s timeout, no retries) and returns `{url}`; the client sets `iframe.src` (desktop) or `window.open(url, '_blank', 'noopener,noreferrer')` (Redirect mode). Tokens are valid 3600 s, re-minted on every click, never persisted or logged.
- **Webhooks.** One URL + secret per environment. `POST /api/webhooks/pencil` verifies the Bearer secret (SHA-256 digests compared with `timingSafeEqual`), writes a ledger row, enqueues a job and returns 200 in milliseconds. Payloads are hints only: no row in `sessions`, `transcripts` or `teacher_feedback` is written from a payload without a Pencil round-trip confirming the Space. Pencil makes up to 10 delivery attempts in all for anything but a 2xx within 15 s, with gaps growing from 30 s to 10 min, and **does not guarantee order** (support 2026-10-16; no total was given — about 55 min if the gaps double), so the route answers 2xx for everything it stored or chose to ignore, and no job assumes one event precedes another.
- **Post-session job.** A `pencil_sessions` row is a per-Pencil-session state machine (a lesson can have several; its outcome is decided per lesson); `pencil_jobs` is a queue drained by `/api/cron/pencil-jobs` every 5 minutes. Steps are idempotent, re-check the opt-out flag, and tolerate any arrival order. Pencil's guide for a 1 h lesson (support 2026-10-16): recording within a few minutes of the call ending, transcript ~10 min, summary + AI Coach report ~15 min; analytics (`SESSION_ENDED`) only after the session closes, six minutes after the last participant leaves or becomes inactive, and is processed, so from that guide we expect the recording often to arrive **before** the analytics it must be matched against (our inference; Pencil guarantees no order).
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
                                                                                 &standalone=true&broadcastEvents=true&gv=true
<-- postMessage ready, user_joined_call                     (teacher "in call" badge)
<-- postMessage participant_join{id==studentPencilUserId} | participantupdate{count>=2}
startSessionClock(id) --------> UPDATE sessions SET actual_start=now(), status='in_progress' WHERE actual_start is null (teacher-scoped)
Teacher clicks End -----------> endLesson(id, outcome): caller == teacher_id || admin
                                UPDATE sessions SET status=outcome, actual_end=now() ... RETURNING id  (abort if 0 rows)
                                logAudit lesson.end — NO Pencil call (endOngoingSession ends neither call nor recording)
<-- iframe unmounted -> "Lesson ended" card
Student / admin rooms --------> GET /api/lesson/{id}/status every 15 s (cookie client, RLS)
<-- {status:'completed'} -> iframe unmounted -> everyone has left the call -> Pencil closes the session 6 min later
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
                                                                 teacher only: presence stored, NO sessions write (no-show is per lesson, in reconcile)
                                                                 student only: homework_activity | unmatched
                                                                 session_metrics talk fraction <- callActiveTalkingDuration
                                                                 opted out? -> state skipped_opt_out, stop (analytics kept)
                                                                 else analytics_done, next_poll_at = +20 min
SPACE_RECORDING RECORDING_AVAILABLE> job ingest_recording ---->  GET /spaces/recordings/{spaceId} (verify recordingId listed)
  (usually BEFORE SESSION_ENDED)                                 opted out -> DELETE /spaces/recordings/{spaceId}/{rid} now; audit; follow-up
                                                                 no ingested pencil_sessions row overlaps yet -> requeue +10 min (never delete)
                                                                 overlapping row is no_show | unmatched -> DELETE; audit
                                                                 else store recording_id
SPACE_RECORDING TRANSCRIPT_AVAILABLE> job ingest_transcript -->  re-check opt-out; recording not ingested yet -> requeue; GET /transcriptions/{recordingId}
                                                                 toSegments() -> transcripts (+pencil_summary); computeMetrics()
                                                                 analyzeLesson(+pencilSummary) -> teacher_feedback(teacher_id = taught_by)
                                job run_claude --------------->  draftReport -> reports (teacher_id = taught_by) + session_ai_outputs
                                                                 (agenda draft, homework suggestion), followups (ai), notify teacher
COACHING_AVAILABLE -----------> job ingest_coach_report ------>  GET /analytics/sessions/{sid}/reports; store coaching.status (+ report if completed)
(sent only WITH insights)       fallback poll every 15 min ---->  until coaching.status is terminal; still null 2 h after the transcript -> not_applicable
(webhook never arrives)         reconcile + retention (cron) ->  GET /analytics/sessions?filters{spaceIds,createdStart}
                                                                 GET /spaces/recordings/{spaceId}; DELETE recordings past retention
```

## API surface we use (verified spec only)

| Purpose | Call | Fields we rely on |
|---|---|---|
| Create user | `POST /users/createAPIUser` `{name, userRole:'Student'\|'Teacher', externalId}` | `userId`, `email` |
| Rename user | `PATCH /users/{userId}` `{name}` | — (on `display_name` change) |
| Join URL | `GET /users/{userId}/authorize?redirectUrl=<url-encoded Space link + params>` | `url` (valid 3600 s) |
| Create Space | `POST /spaces/create` `{title, hosts:[{userId}], participants:[{userId}], visibility:'private', notifyInvitees:false, externalId}` — never `owner` (decision p) | `spaceId`, `link`, `settings.disableAlwaysOnRecording` |
| Find / read Space | `GET /spaces` with `externalId` filter; `GET /spaces/{spaceId}` | `results[]`; `settings.disableAlwaysOnRecording`, `hosts[]` |
| Hosts | `PATCH /spaces/{spaceId}/updateUsers` `{addUsers:[{userId, role:'host'}], removeUsers:[{userId}], notifyInvitees:false}` | — |
| Recording policy | `PATCH /spaces/{spaceId}/settings/` `{settings:{disableAlwaysOnRecording}}` | — (applies from the next call, never stops a running recording; the `GET /spaces/{id}` read-back shows the stored setting — no endpoint gives the effective recording state) |
| Analytics | `GET /analytics/sessions/{sessionId}` | `spaceId`, `sessionStartTime`, `sessionEndTime`, `callStats[]`, `attendees[].userId/callActiveTalkingDuration/callVideoOnDuration/callDuration/spaceFirstJoinTime/spaceLastLeaveTime` |
| List sessions (reconcile) | `GET /analytics/sessions` filters `{spaceIds, createdStart, createdEnd, status}` | `results[]` |
| AI Coach | `GET /analytics/sessions/{sessionId}/reports` (200 while processing) | `coaching` (null, or `{status, score, categories[], items[]}`), `safeguarding`; `summary`, `snippets` not used |
| Recordings | `GET /spaces/recordings/{spaceId}?startingAfter&endingBefore` | `recordings[].recordingId/startingTime/duration` (a recording is listed only once it finishes; a deleted one is not listed) |
| Playback (Phase 4) | `GET /spaces/recordings/download/{recordingId}` | `downloadLink` (short-lived) |
| Delete recording | `DELETE /spaces/recordings/{spaceId}/{recordingId}` | — (final for us: gone from lists, playback and `GET /transcriptions`; what Pencil keeps is pending; every call inserts `pencil_recording_deletions`) |
| Transcript | `GET /transcriptions/{recordingId}` | `recordingStartTime`, `transcript[].text/start/end/userId`, `transcriptUsers[]`, `summary.description` |
| Webhook config | `POST /webhooks {url, secret}`, `GET /webhooks`, `DELETE /webhooks` | — |
| Phase 4 | `POST /events`, `PATCH /events/{eventId}/update`, `POST /events/{eventId}/cancel`, `GET /attendance/{event_id}` | `event.id`, `results[].status` |

Space URL params (on the Space link inside `redirectUrl`): lesson links for teacher **and** student: `startCall=true&standalone=true&broadcastEvents=true&gv=true`. The teacher, a host, starts the call on arrival. `skipCallHostCheck` is left out because with it a participant can start a call alone, and always-on recording records and bills that call (support 2026-10-16); a student who arrives first waits on the board. `skipDeviceSetup` stays off so the child confirms mic/camera. Second-device ("board") and homework links: `standalone=true&mode=whiteboardonly`, which hides the call controls and join prompts (support 2026-10-16), so no call can start from them. `standalone` only hides navigation and never changes who can start a call.

Webhook payloads (`_type` discriminates; Bearer = our secret): `SPACE_USER {spaceId, sessionId, timestamp, eventType, userId}` — Pencil's webhook docs (api.pencilspaces.com, read 2026-10-15; the saved OpenAPI file has no webhook schemas) print `joinSpace|leaveSpace|hideTab|unhideTab`, support names the tab events `USER_ENTERED_BACKGROUND|USER_ENTERED_FOREGROUND` — a different naming scheme, not just a different case — so the join/leave strings are unconfirmed (asked); known strings are mapped explicitly, anything else is ledgered `ignored`, and each new `SPACE_USER` eventType is reported to Sentry once so a renamed join is noticed (the join hint is optional: correlation falls back to the window); `SPACE_SESSION {spaceId, sessionId, timestamp, eventType:'SESSION_ENDED'}`; `SPACE_RECORDING {spaceId, recordingId, timestamp, eventType:'RECORDING_AVAILABLE'|'TRANSCRIPT_AVAILABLE'}`; `COACHING_AVAILABLE` (sent only when an AI Coach report completes with insights; `_type` and fields not yet documented, so it is keyed on `eventType` and ledgered raw); Phase 4: `SCHEDULE`, `ATTENDANCE`, `CONTROL_CENTER_ALERT {alertType:'EVENT_NO_SHOW'}`. Delivery: 2xx within 15 s or Pencil retries (backoff 30 s → 10 min, 10 attempts, about 55 min in all if the gaps double); order not guaranteed.

Embed events (postMessage `{type, detail}`; accept only when `event.source === iframe.contentWindow` and `event.origin ∈ {https://my.pencilapp.com, https://staging.pencilapp.com}`): `ready`, `participant_join/participant_leave {id}`, `user_started_call`, `user_joined_call`, `user_left_call`, `call_ended`, `user_ended_call`, `recording_status_change {status}`, `participantupdate {count}`, `connection_status_change`.

**Answered by Pencil support (2026-10-16):** the transcript event string, retry/ordering, timings and the reports endpoint's per-block states, `endOngoingSession` semantics, recording and billing for a student alone, who can start a call, enabling always-on and when a Space setting applies, live alerts, second-device counting, boards, the API account and `owner`, and iframe embedding — see "Pencil support answers (2026-10-16)" below for what each changed. **Still open:** the follow-up questions in "Open questions → For Pencil support" below (the same list as [`vendor-answers-2026-10-16.md`](./vendor-answers-2026-10-16.md)), including the pending deletion answer; plus our own test of Safari/ITP and Chrome with third-party cookies blocked.

## Pencil support answers (2026-10-16)

Pencil support answered the twelve questions this plan sent (verbatim in [`vendor-answers-2026-10-16.md`](./vendor-answers-2026-10-16.md)). What each answer changed:

| # | Answer, in short | Changed |
|---|---|---|
| 1 | Transcript event is `SPACE_RECORDING` / `TRANSCRIPT_AVAILABLE`; payloads never carry content | `jobsFor` maps it by name; the "any other `SPACE_RECORDING` is the transcript" rule is gone |
| 2 | 2xx within 15 s, or up to 10 delivery attempts in all (gaps 30 s → 10 min); order not guaranteed | Route answers 2xx for anything stored or ignored; jobs tolerate any order; `reconcile` asks Pencil for sessions itself, so abandoned deliveries are recovered whatever the total retry time |
| 3 | 1 h lesson: recording in minutes, transcript ~10 min, AI Coach ~15 min; reports answer 200 while processing with `coaching.status`; `COACHING_AVAILABLE` only for reports with insights | Coach report triggered by the webhook, statuses stored (`pencil_coach_status`), polls shortened; End copy says "about 30 min" |
| 4 | `endOngoingSession` ends only the analytics session — not the call or recording — and opens a new one for whoever remains; sessions close 6 min after the last participant leaves or becomes inactive | End makes no Pencil call; every open room polls the lesson status and unmounts its Space (decision b); `ingest_recording` waits for the session instead of deleting (step 2) |
| 5 | No call → no recording; time alone is not billed (per-user-hour plans; group plans from 2 users by default); only hosts start calls by default; `startCall`+`skipCallHostCheck` lets a participant start one alone, recorded and billed | Lesson links drop `skipCallHostCheck`; homework time is neither recorded nor billed (decision i) |
| 6 | We enable always-on ourselves; `disableAlwaysOnRecording` applies from the next call and does not stop a running recording; no effective-state endpoint | Opt-out warns only about a lesson that may be in a call now; the 3 h window and the pre-lesson re-PATCH are dropped (decision d) |
| 7 | `DELETE` hides the recording and its transcript endpoint; the rest is pending | Retention deletes only after our transcript copy exists; Pencil-side retention stays a prerequisite |
| 8 | No live coaching prompts; distraction notifications on tab switch; signals `USER_ENTERED_BACKGROUND`/`FOREGROUND` and `spaceDurationInBackground` | Decision (j) rewritten, incl. the Redirect-mode false alarm; owner question added |
| 9 | A second device that never joins the call is not a participant, counts once, never touches recording; `mode=whiteboardonly` hides call controls | "Use this device for writing" and homework links are whiteboard-only (decision o) |
| 10 | No boards API or board deep link; a Space opens on the last-viewed board; on the roadmap | Decision (i) stands |
| 11 | Generic admin account is right; passing `owner` keeps the API account out of the Space; keep "Grant admins access to all Spaces" on | We still pass no `owner` (new decision p); the admin-access setting joins the prerequisites (k) |
| 12 | No `frame-ancestors`/`X-Frame-Options`; HTTPS; allow list; fresh token per page load | Confirms decision (f) as built |

## Explicit design decisions

a. **Idempotent provisioning.** `createAPIUser.externalId = profiles.id`; `spaces/create.externalId = '<course_id>:<student_id>'` (also stored as `pencil_spaces.external_id`). If the DB insert fails after the Pencil call, the next `ensureSpace` recovers with `GET /spaces` filtered by `externalId` before creating. Space state (`host_profile_ids`, `recording_disabled`, `hosts_synced_at`, `recording_verified_at`) is cached in `pencil_spaces` so a normal join makes exactly one Pencil call (`authorize`), plus one `GET /spaces/{id}` for opted-out students.

b. **Lessons and Pencil sessions are many-to-one; everyone leaving ends the call; completion needs evidence.** `endLesson(sessionId, outcome: 'completed' | 'no_show')` (server action): loads the session with the cookie client, requires `admin || session.teacher_id === profile.id`, writes `status=outcome, actual_end=now()` only while the lesson is live (`.in('status', ['scheduled','confirmed','in_progress']).select('id')`) and aborts if no row returned, `logAudit(profile, 'lesson.end' | 'lesson.no_show')`. **It makes no Pencil call.** `POST /spaces/{spaceId}/endOngoingSession` ends only the analytics session — it does not end the call, disconnect anyone, or stop or split the recording — and immediately opens a new session for anyone still in the Space (support 2026-10-16); calling it while the student was still connected would have split off a student-only session that decision (i) counts as homework activity. What ends the call is everyone leaving: the teacher's room unmounts its Space on End, and every other open room (student, observing admin) polls `GET /api/lesson/[id]/status` every 15 s with the viewer's cookie client and unmounts its Space as soon as the status is `completed`/`no_show`/`cancelled`; Pencil then closes the session six minutes after the last participant leaves or becomes inactive, and `SESSION_ENDED` follows once analytics are processed. A Space opened in its own tab (Redirect mode, mobile) stays open until that tab is closed — the ended card says so, and Phase 4's "End Event" redirect is the full fix. `sessions.pencil_session_id` is written by `ingest_session` when it matches, never by End. Two lessons of the same pair less than six minutes apart can fall into one Pencil session; correlation binds it to the lesson whose window holds `sessionStartTime`, and the second lesson keeps the status and clocks its End wrote, with `reconcile` flagging that it has no Pencil session of its own. If `actual_start` is null and no student join was seen, the button offers "Mark as no-show" instead of "End lesson". `ingest_session` marks a lesson `completed` only when **both** the teacher's and the student's `pencil_user_id` appear in `attendees` with `callDuration ≥ 5 min` each — both in the **call**: a whiteboard-only device or a teacher reviewing homework while the student is in the Space is presence without a call and never counts (support 2026-10-16: call participants are counted by who joins the call) — and only from a live status (`.in('status', ['scheduled','confirmed','in_progress'])`, never over an End-set `no_show`) (audit `pencil.session_autocompleted`, credit trigger fires once); a teacher-only Pencil session never changes `sessions` by itself. A session closes six minutes after the last participant leaves or becomes inactive (support 2026-10-16), so one lesson can be several Pencil sessions — the teacher opening the room early, a dropped call rejoined — and they are ingested in any order; the no-show is therefore decided per **lesson** by `reconcile` (step 6) once `scheduled_end + 90 min` has passed, after asking Pencil itself for the window's sessions (Pencil gave no total retry duration, so the rule never relies on one), and only when a teacher-only session is the evidence. Student-only → homework time or `unmatched` (step 1). Fallback correlation when no hint exists: `spaceId → pencil_spaces → (student, course)` → session with `status in ('scheduled','confirmed','in_progress','completed')`, `sessionStartTime` within `[scheduled_start − 15 min, scheduled_end + 3 h]`, both participants present with `callDuration ≥ 5 min`, preferring the session whose `scheduled_start` is closest. **Every** both-in-the-call Pencil session inside a lesson's window binds to that lesson (`pencil_sessions.session_id` is not unique, nor is `sessions.pencil_session_id`); `sessions.pencil_session_id` points at the bound session with the longest `callDuration`, whichever arrived first, and that session supplies `taught_by` and the transcript (`ingest_recording` prefers its recording whose `startingTime` is closest to `actual_start`). Recordings overlapping any bound session are kept. The teaching identity is derived from Pencil, not from the current row: `pencil_sessions.taught_by_profile_id` = the attendee whose `pencil_user_id` belongs to a teacher/admin profile (fallback `sessions.teacher_id`); `toSegments` speaker mapping and `teacher_feedback.teacher_id` / `reports.teacher_id` use it.

c. **Analytics and AI Coach ingestion — fractions, not percentages.** The codebase stores talk share as a 0–1 fraction (`metrics.ts:121`, `heuristicFeedback` thresholds `≥ 0.4` / `> 0.65`, `pct()` multiplies by 100). So `teacher_talk_pct = round2(T / (T + S))`, `student_talk_pct = round2(1 − teacher_talk_pct)` from `callActiveTalkingDuration` (`talk_source='pencil_analytics'`); `teacher_camera_pct = round2(callVideoOnDuration / callDuration)` likewise 0–1; the other six `SessionMetrics` fields stay transcript-derived. `tests/pencil-analytics.test.ts` asserts "returns fractions compatible with computeMetrics". The AI Coach report is stored in `teacher_feedback.pencil_coach` (jsonb) + `pencil_coach_score`, with `pencil_coach_status` (mirrored from `pencil_sessions.coach_status`) holding Pencil's `coaching.status` (`completed`, `failed`, `meeting_too_short`, `meeting_irrelevant`, `no_transcript`, `disabled`, or our `not_applicable` when `coaching` stays null); the card shows a plain reason for every non-completed status ("Lesson too short for AI Coach") instead of an endless "processing". UI: `/coaching/[sessionId]` shows two cards — "Pencil AI Coach" (score, four category scores, moments with `recordingOffset`) and "MathVision coaching" (our `dimension_scores`, strengths, suggestions, moments). Trends on `/teacher/coaching` use our scores; Pencil's score is a secondary chip; "processing" placeholder until it lands. **Teacher evaluation is mandatory (owner decision 4):** `analyzeLesson` and `ingest_coach_report` run for every teacher; nothing reads `consents.type='teacher_eval'` any more (the table stays for history only). The policy is stated in the teacher onboarding/request-access copy and in README ("Lessons are recorded and AI-evaluated for coaching; this is a condition of teaching on MathVision"). `ai_used=false` therefore only ever means "Claude was unavailable or rate-limited", never "not consented".

d. **Opt-out recording policy, enforced.** Institution recording mode = Always-on (enabled at the start of Phase 2); "Record participant video" OFF. The flag lives in the service-only table `recording_opt_outs` (presence = opted out), written exclusively by `setRecordingOptOut` (`requireRole('admin')`, admin client, `logAudit 'student.recording_opt_out'`). Enforcement: (1) `applyRecordingPolicy` PATCHes `disableAlwaysOnRecording=true`, then `GET /spaces/{spaceId}` and writes `pencil_spaces.recording_disabled=true, recording_verified_at` only when the read-back confirms; (2) **hard stop** — the lesson page, `/api/lesson/[id]/space`, `getHomeworkSpaceLink` and the mobile routes refuse to mint a join URL when the student is opted out and `recording_disabled` is false, show "Recording policy not applied — contact admin" and raise an admin follow-up; (3) the Space setting takes effect from the **next call** and does not stop a recording that is already running (support 2026-10-16; we read the helpdesk's "up to 3 h" as being about switching the institution mode — Pencil did not comment, follow-up asked), so `setRecordingOptOut` warns the admin and raises a follow-up only when one of the student's lessons may be in a call right now (slot from 15 min before start to 30 min after end) — end and restart that call, and delete its recording when it lands — and the pre-lesson `apply_space_settings` re-PATCH is dropped (the `pencil_jobs.kind` value stays unused); drift is still caught by the read-back on every opted-out join; (4) every job step re-checks the flag; `ingest_recording` and `reconcile` `DELETE /spaces/recordings/{spaceId}/{recordingId}` a recording of an opted-out student at once when it started after the opt-out, and hand an earlier one to the delayed `delete_recording` job of (6) (it then disappears from lists and playback and `GET /transcriptions` stops returning it; what else Pencil removes is still pending from support), store nothing, `logAudit(null, 'pencil.recording.deleted', {reason:'opt_out'})` and raise an admin follow-up so the family can be told; (5) the teacher's header shows a red "Recording is ON but this student is opted out — stop the recording, or end the call for everyone and start a new one" banner (under always-on, hosts cannot stop a recording, and the setting reaches the next call) if `recording_status_change` reports recording while the flag is set; (6) on opt-out, a `delete_recording` job is enqueued for every existing recording of that student's Spaces with `run_after = now() + 24 h`, and "Resume recording" within that window deletes the still-queued `delete_recording` rows for that student's recordings (so their `dedupe_key`s are free for a later opt-out): a DELETE is final for us (gone from lists, playback and the transcript endpoint — support 2026-10-16), so a mistaken toggle must not destroy a year of lessons; every delete is written to `pencil_recording_deletions` and `transcripts.raw` is nulled for their past sessions; whether segments, `pencil_summary`, our feedback and `pencil_coach` for past lessons are also purged is an owner decision (default: retained until the family asks). For opted-out students nothing recording-derived exists **on our side** (a call already running when the opt-out was set is recorded until it is restarted, and that recording is deleted when it lands; whether Pencil still produces or keeps its transcript, summary, AI Coach or safeguarding items is pending from support): no transcript, summary, AI Coach, Claude analysis, report pre-fill, agenda, AI follow-ups; analytics (talk time) is still stored; `sessions.analysis_status='skipped_opt_out'`; the report editor shows "Not recorded — write from your notes". The old `consents` gating (`recording`, `ai_analysis`) is removed from code; the table stays for `teacher_eval` and history; no backfill — those rows were never enforced (recording was hard-off). Students and parents see a persistent "This lesson is recorded (audio + board)" notice in their lesson view and on the session card; opted-out students see "Not recorded".

e. **Embed events drive our state — gated on the student.** In iframe mode, for the teacher viewer, `startSessionClock` fires on the first event proving the student is present: `participant_join` whose `detail.id === studentPencilUserId`, or `participantupdate.count >= 2`; `user_joined_call` only drives the teacher's own "in call" badge and "waiting for student" (today `daily-room.tsx` fires `onPeerPresent` on the first *remote* participant; this preserves that semantics so the admin actual-duration column is not inflated). `call_ended`/`user_left_call` → "call ended" badge; `recording_status_change` → recording chip. In Redirect mode nothing is written live: `ingest_session` backfills `actual_start = coalesce(actual_start, max(teacher.spaceFirstJoinTime, student.spaceFirstJoinTime))` clamped to `≥ scheduled_start − 5 min`, and `actual_end = coalesce(actual_end, least(max(teacher.spaceLastLeaveTime, student.spaceLastLeaveTime), last callStats[].callEndTime))` — not `sessionEndTime`, which may include Pencil's six-minute close (asked). The `SPACE_USER joinSpace` webhook is only a "student is here" hint in `pencil_sessions`, never a clock.

f. **iframe on desktop, Redirect on mobile/unsupported.** Pencil sets no `frame-ancestors` or `X-Frame-Options`, and asks for token login with a fresh token on every page load because browser storage partitioning can stop a login carrying into the iframe (support 2026-10-16) — which is what `SpaceStage` does on every mount, Retry and new-tab open. Desktop (`lg ≥ 1024px`, fine pointer) → iframe with the vendor's `allow` list and `referrerpolicy="no-referrer"`; mobile, coarse pointer, or no `ready` postMessage within 15 s → "Open lesson in a new tab" button that re-mints via `/api/lesson/[id]/space` and opens the `{url}` returned by `authorize` (never a hand-built token URL) with `window.open(url, '_blank', 'noopener,noreferrer')`. The `message` handler checks `event.source === iframeRef.current?.contentWindow` and an allowlist of both Pencil origins. A `Content-Security-Policy: frame-src https://my.pencilapp.com https://staging.pencilapp.com` header for `/lesson/*` and `/hw/*` is added in `next.config.mjs`. Parent page must be HTTPS (`next dev` needs a trusted local cert, e.g. `mkcert` + `--experimental-https`). A `BroadcastChannel('lesson-room')` lock warns when a second lesson room tab is opened in the same browser (an `authorize` login logs out whoever is logged into Pencil in that browser — relevant for a teacher's next lesson and for siblings sharing a device).

g. **Teacher reassignment.** Removing the previous teacher is always possible because no teacher is ever a Space owner (decision p). `assignTeacher()` refuses when the session is `in_progress` or `completed` (admin must cancel and rebook, or use an explicit `force` that is audited and does not touch coaching ownership — the pipeline derives `taught_by` from attendees). Before the lesson, host sync is additive and fire-and-forget (`createSupabaseAdminClient()`, `captureError`, never fails the form action): add the new teacher as host first; remove the previous teacher only when they have no remaining non-cancelled sessions and no non-completed homework for that (student, course). `logAudit 'pencil.space.hosts_changed' {added, removed}`. `syncHosts` also runs lazily in `/api/lesson/[id]/space` when `sessions.teacher_id ∉ host_profile_ids`.

h. **Events mirroring (recommended Phase 4, owner decision).** Mirror each session into an ONLINE Event (`POST /events` on schedule, `PATCH …/update` on reschedule/assign, `POST …/cancel` on cancel) to get the in-Space session timer, automatic attendance, `EVENT_NO_SHOW` alerts and the "End Event" redirect back to our app (which also disconnects the call in a Space opened in its own tab, the one case our End cannot reach — decision b). Breakage: Pencil forbids two concurrent events in one Space; a Space is per (student, course), so this only happens if two of our sessions for the same pair overlap, which `sessions_no_student_overlap` (0014) already prevents for active statuses — except when a host extends an event past the next start. The mirror must treat a 4xx as "unmirrored" (log, raise an admin follow-up) and never block our scheduling.

i. **No boards API — Done + automatic activity signal (owner decision 6).** Homework opens the student's Space (`standalone=true&mode=whiteboardonly`, no `startCall`). There is no board deep link: a Space opens on the user's last-viewed board, otherwise the first (support 2026-10-16), so the item names the board to switch to. We cannot create boards either: the teacher adds and names the board (`board_hint`) in the Space when setting the homework, and the student adds one with that name if it is missing (whether a participant can add and rename boards on a whiteboard-only link is a staging check). The student works on that board and taps **Done** in our app (status `submitted`; no photo or export required — attachments stay optional). Pencil cannot report board content or a done state, but it does record a Session whenever the student is alone in their Space (`SPACE_USER joinSpace/leaveSpace` webhooks, `GET /analytics/sessions` with `spaceIds` filter), so the job runner attributes every **student-only** Pencil session in that Space to the open homework items of that (student, course) whose window `[assigned_at, due_at + 7 days]` contains `sessionStartTime`, and accumulates the time the Space was actually in view — `spaceDuration − spaceDurationInBackground` (support 2026-10-16 confirms the per-user background figure), so a tab left behind our app is not counted as work — into `homework.space_activity_s` + `last_space_activity_at` (`pencil_sessions.state='homework_activity'` instead of `unmatched`). The UI shows "Worked in Space 25 min on Tue" on the item for student, teacher and parent. Nudges: overdue with no activity → the existing reminder path (push/WhatsApp); activity ≥ 10 min but not Done → a "Mark it done?" prompt to the student (once, `activity_nudged_at`). Activity is a signal, never a status: nothing auto-completes. Homework time the student spends alone is neither recorded (only hosts can start a call by default, homework links are `standalone=true&mode=whiteboardonly`, and always-on recording starts only with a call) nor billed on per-user-hour plans or at the default group-session threshold of 2 (support 2026-10-16); a host in the Space makes it billable, and a host-started call is recorded, hence the backstop below. `ingest_recording` still deletes a recording that overlaps no matched lesson, as a backstop for a teacher-started call outside a lesson.

j. **Live coaching.** Pencil's AI Coach is post-session (~15 min after a 1 h lesson; support 2026-10-16). Pencil confirms there are no live teacher-coaching nudges. Its live attention alert is the **distraction notification** when a participant switches away from the Pencil tab (hidden at 5+ participants, switchable off in Settings > AI Assist > In Session); the alert itself is not in the API, but its signals are — `SPACE_USER USER_ENTERED_BACKGROUND/USER_ENTERED_FOREGROUND` webhooks and the per-user `spaceDurationInBackground` in session analytics. Opening Materials raises the alert and counts as background time: in **Redirect mode** the student switches to our tab; in the desktop iframe room every Materials file opens in a new tab, which hides the Space, so we expect the same there (a staging check). A writing iPad switched away may count too. None of it is evidence of inattention. The tab events are high-volume, so the webhook route acknowledges them with a 200 and ledgers them with `payload = '{}'::jsonb` (only `_type`, `eventType` and the ids kept in columns), and `retention` deletes `ignored` ledger rows after 30 days. Our live coach is retired (owner decision 2). **Owner decision:** keep distraction notifications on or switch them off (if on, consider showing Materials inside the room so the Space tab stays visible); optionally, in a later phase, show "time away from the Space" from `spaceDurationInBackground` (already inside the stored `analytics` jsonb, so no webhook is needed) on the coaching detail page, labelled with the Materials caveat (background time includes reading Materials, in either layout). Until then `live_events` stays as an empty table; its reader and card are removed.

k. **Pencil-side prerequisites (owner, before go-live):** plan tier (API = Usage-based/Enterprise; AI Coach = Advanced+; AI Summaries = Expert+; a plan that includes **always-on cloud recording**); Settings > Permissions > Recording = Always-on **(switched on at the start of Phase 2, not before, by our own institution admin — support 2026-10-16)**, "Record participant video" OFF, local recording prevented, recordings admin/host-only; Settings > AI Assist: Coaching Insights ON, Session Summaries ON, Post-Session Emails **OFF** (or limited to hosts who were present): with no `owner` the generic API account is an invited host of every Space (decision p) and is not an "API user", so "off for API users" alone would mail it every lesson's summary; In Session distraction notifications per decision (j); "Grant admins access to all Spaces" **ON** (the default; it lets the API account manage Spaces it is not a member of — made in Pencil's UI or recovered by `externalId` — while the Spaces we create have it as a host anyway); Standalone branding; webhook URL + secret per environment (staging → preview URL, prod → `https://<app>/api/webhooks/pencil`); a generic admin account owning the API key (support confirms), named for families (e.g. "MathVision") because it shows as a host in every Space, and used by nobody day to day; revoking or regenerating the key signs that account out everywhere and the old key stops working, so `PENCIL_SPACES_API_KEY` must be updated everywhere at once (rooms fall back to Zoom meanwhile); subscribe to statuspage; **signed DPA/processor agreement with Pencil covering recordings and transcripts of minors, confirmation of data region, and Pencil's own retention of derived artefacts after `DELETE /spaces/recordings`**; `SUPABASE_SERVICE_ROLE_KEY` set in every environment that runs Pencil (provisioning, webhooks and jobs are no-ops without it).

l. **Timing-aware job design.** See "Post-session job": a per-Pencil-session state machine with independent, idempotent and order-independent steps (the lesson outcome decided per lesson), Space verification on every fetch, polling fallbacks, and reconciliation — not one webhook handler.

m. **Audit coverage.** `logAudit` for `pencil.user.create`, `pencil.space.create`, `pencil.space.hosts_changed {added, removed}`, `pencil.join {spaceId, purpose, mode}` (every minted URL, including mobile), `lesson.end`, `lesson.no_show`, `pencil.session_autocompleted`, `pencil.recording.deleted {reason}`, `pencil.recording.download {recordingId}` (awaited; fail closed if the insert errors), `pencil.transcript_processed`, `student.recording_opt_out`, `homework.submit`. The badge map in `src/app/(app)/admin/audit/page.tsx` (`ACTION_TONE`) gets entries for all of them.

n. **Outage fallback = Zoom (owner decision 5).** One master Zoom meeting link for the whole school lives in the server env var `LESSON_FALLBACK_URL` (validated at startup: `https://` + a `zoom.us` host). Nothing is stored per teacher. `sessions.fallback_join_url` stays as an admin per-lesson override, which is also the escape hatch when two lessons fall back at the same time and would otherwise share one Zoom meeting. Resolution order: session override → master link → "no backup link, contact admin". Env `LESSON_FALLBACK_MODE=on|off` forces fallback for everyone. When Pencil errors, is rate-limited, or the switch is on, `SpaceStage` renders "Classroom unavailable — join on Zoom" (new tab) plus Materials for teacher and student; the End button still works (status/`actual_end` only) and sets `analysis_status='no_recording'` so the report editor shows "write from notes"; no transcript or coaching exists for Zoom lessons. Runbook in README.

o. **Second device for writing (iPad + laptop).** Pencil supports one account in the same Space on several devices and bills it once. Support (2026-10-16): call participants are counted from who joins the call, so an iPad that never joins it is not a second participant; attendance and billing count per user; a whiteboard-only device never starts or stops always-on recording; and `mode=whiteboardonly` hides the call controls and join prompts on that device. The one constraint left from the helpdesk ("Can I join a Space from more than one device?") is never to open the Space twice on one device; and because our End cannot close a separate tab, the writing tab must be closed when the lesson ends, or it may keep the lesson's Pencil session open (a session closes six minutes after the last participant leaves or becomes inactive; whether an idle whiteboard-only device counts as inactive is asked). The helpdesk's speaker-off rule also stays until Pencil says whether a whiteboard-only device plays call audio. The whiteboard supports an iPad stylus in the browser (Redirect mode; iframe is unreliable on tablets). Design: the lesson page on a coarse-pointer device shows two buttons: **"Join the call here"** (normal lesson params: `startCall=true&standalone=true&broadcastEvents=true&gv=true`) and **"Use this device for writing"**, which mints a URL with `standalone=true&mode=whiteboardonly` (no `startCall`), opens it in a new tab and says the device shows the board only; the student signs into our app on the iPad as usual and each tap re-mints its own authorize URL (one token per device, 3600 s; a login on the iPad does not log the laptop out because Pencil sessions are per browser). The desktop iframe stays the call device, so the lesson clock still starts from the laptop's `participant_join`. Pencil analytics key attendees by `userId`, so the two devices are one attendee (`spaceCountJoined` increments; `callDuration` is unaffected). Nothing in our data model changes; one extra `purpose:'board'` value in `mintJoinUrl`/`pencil.join` audit.

p. **The API account owns every Space; teachers are hosts.** Support (2026-10-16) suggests passing `owner` (for example the tutor) on `POST /spaces/create`, so the API account is not added to the Space and does not appear in it. We do not, for now. Our notes record an owner as permanent (helpdesk; unconfirmed by support — asked), so a tutor-owner could never be taken out of the child's Space: not when a teacher who never taught the pair is reassigned away (decision g removes those), and not when a teacher leaves the school. Decision (g) keeps the seat of a teacher who has taught the pair, so day-to-day reassignment barely separates the two designs; offboarding does. A separate generic owner account would sit in the Space exactly as the API account does now. Without `owner` the API account is the owner and a host that can never be removed, which also guarantees every Space keeps "at least one host" while teachers are swapped. Cost: a generic school account is visible in the member list. Revisit if Pencil confirms an owner can be changed (open question). "Grant admins access to all Spaces" stays on either way.

## Phase 1 as built (deviations from the text below)

The Phase 1 build, its review and Pencil support's answers changed these things; the code and migration 0017 are authoritative where this section and the DDL below disagree.

- `pencil_webhook_events.space_id` is named `pencil_space_id` (it holds Pencil's id, per the naming rule).
- `pencil_spaces.provision_lock_until` is a per-pair lease so the teacher's and student's first joins cannot create two Spaces; Pencil users converge on the first stored id.
- Migration 0017 also closes three pre-existing holes found in review: a column guard on teacher session updates (only lesson-room columns, status forward only), `rl_check` revoked from anon/authenticated (rate limiting runs with the service role), and `handle_new_user` always creates a `student` (README: disable Supabase self-signup).
- `PENCIL_RECORDING_ENABLED` (unset = off) gates every "recorded" label until institution recording is switched on in Phase 2; a new audit action `session.assign_teacher` records reassignments, which now also remove the previous teacher's host seat when they have no other lesson or open homework for the pair.
- After Pencil support's answers (2026-10-16): `endLesson` makes no Pencil call (the `endOngoingSession` wrapper is gone) and every open room polls the new `GET /api/lesson/[id]/status` and unmounts its Space when the lesson is over (decision b); lesson links drop `skipCallHostCheck`, board and homework links are `standalone=true&mode=whiteboardonly` (decisions i, o); `setRecordingOptOut` warns about a lesson that may be in a call now instead of one within 3 h (decision d); `POST /spaces/create` still sends no `owner`, now pinned by a test (decision p).

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
alter table public.teacher_feedback add column if not exists pencil_coach_status text check (pencil_coach_status in
  ('pending','completed','failed','meeting_too_short','meeting_irrelevant','no_transcript','disabled','not_applicable'));
  -- Pencil's coaching.status (support 2026-10-16) + our not_applicable (coaching stayed null); mirrors
  -- pencil_sessions.coach_status for the teacher's card when a feedback row exists
alter table public.pencil_sessions add column if not exists coach_status text;  -- the job's copy: it exists even
  -- when no transcript (so no teacher_feedback row) ever came; no CHECK, the vendor vocabulary may grow
alter table public.pencil_sessions add column if not exists student_active_s int;  -- spaceDuration − spaceDurationInBackground
                                                                                  -- of a student-alone session (decision i)
-- ingest_session (Phase 2) writes 'homework_activity' once 0019 adds the homework columns; the state is allowed from here
alter table public.pencil_sessions drop constraint if exists pencil_sessions_state_check;
alter table public.pencil_sessions add constraint pencil_sessions_state_check check (state in
  ('live','ended','analytics_done','awaiting_transcript','transcript_done','done',
   'skipped_opt_out','no_recording','no_show','unmatched','failed','homework_activity'));

-- Every DELETE we make at Pencil (support 2026-10-16: final for us; the transcript endpoint stops returning it, response not stated).
-- Steps 2-3 read it to tell "we deleted it" from "not listed yet"; Phase 4 playback answers 410 from it.
create table if not exists public.pencil_recording_deletions (
  recording_id    text primary key,
  pencil_space_id text not null,
  reason          text not null check (reason in ('opt_out','orphan','no_show','retention')),
  deleted_at      timestamptz not null default now()
);
alter table public.pencil_recording_deletions enable row level security;   -- no policies: service role only

-- 0017's column comments predate the 2026-10-16 answers (End no longer writes a hint or a Pencil session id)
comment on column public.pencil_sessions.hint_session_id is 'lesson hinted by a SPACE_USER join webhook; unverified';
comment on column public.sessions.pencil_session_id is 'primary bound Pencil session (longest callDuration); not unique: Pencil closes a session six minutes after the last participant leaves or becomes inactive, so one lesson can span several';
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
alter table public.homework add column if not exists space_activity_s      int not null default 0;  -- seconds of student-only Space time attributed (decision i)
alter table public.homework add column if not exists last_space_activity_at timestamptz;
alter table public.homework add column if not exists activity_nudged_at     timestamptz;             -- "Mark it done?" sent once
create index if not exists homework_space_idx on public.homework (space_id);
create index if not exists homework_open_window_idx on public.homework (student_id, course_id, assigned_at) where status in ('assigned','incomplete');
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
| `src/lib/actions/sessions.ts` | modify | Keep scheduling; `assignTeacher` refuses `in_progress`/`completed`, fire-and-forget additive `syncHosts` with admin client; add `endLesson(sessionId, outcome)` (caller check, `.select('id')`, audit, revalidate; no Pencil call — decision b); `startSessionClock` unchanged. |
| `src/app/api/lesson/[sessionId]/status/route.ts` | new | `GET` → `{status, actual_end}` with the cookie client (RLS), `no-store`; polled every 15 s by every open room so a teacher's End unmounts the student's Space too (decision b). |
| `src/lib/actions/people.ts` | new | `setRecordingOptOut(studentId, optOut)`: `requireRole('admin')`, admin client, `applyRecordingPolicy` + read-back, a warning + follow-up when a lesson may be in a call now (the setting reaches the next call only), enqueue `delete_recording` jobs, `logAudit`. |
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
| `src/lib/pencil/webhooks.ts` | new | pure `verifyBearer` (SHA-256 digests + `timingSafeEqual`), `parsePayload` (unknown `_type`/`eventType` → `ignored`, never a parse error), `deliveryKey`, `jobsFor(payload)` (exact `eventType` names, case-insensitive). |
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
| `src/lib/data/coaching.ts` | modify | Drop `live_events` nudges query (fixes the `created_at`-vs-`ts` bug by removal) and the dead `demoProfiles`/`DateTime` imports; add `pencilCoach`, `pencilCoachStatus`, `talkSource`, camera fields, `analysisStatus`; `getPendingAnalysis(teacherId)`; demo branch reads `src/lib/demo/runtime.ts`. |
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
| `src/app/(app)/coaching/[sessionId]/page.tsx`, `teacher/coaching/page.tsx` | modify | Two coaching cards (the Pencil AI Coach card is driven by `pencil_coach_status`: processing, the report, or a plain reason such as "Lesson too short for AI Coach"), Pencil summary card ("still processing" while `pencil_summary` is empty), remove nudges card, "analysis pending" strip, speaking-time label. |
| `src/app/(app)/admin/people/page.tsx` | modify | Replace `REQUIRED_STUDENT_CONSENTS` badge with "Recording: on / opted out" toggle → `setRecordingOptOut`, "Pencil linked" badge (admin client reads). |
| `src/app/(app)/admin/audit/page.tsx` | modify | Extend `ACTION_TONE` with every action in (m). |

### Homework (Phase 3)
| Path | Action | What / why |
|---|---|---|
| `src/app/hw/[id]/page.tsx` | modify | Keep role gating; drop snapshot; pass `spaceReady`, `canOpenSpace` (student self, admin, teacher passing `canHostSpace` — parents false) to `HomeworkWorkspace`. |
| `src/components/homework/homework-workspace.tsx` | new | Header/status/Actions/AttachmentsBar/marks + "Open my Space board" (re-mints per click, new tab), board-hint instructions (which board to switch to; the whiteboard-only link has no call to start), mock panel in demo; parent mode hides the Space button. |
| `src/components/homework/homework-canvas.tsx`, `homework-canvas-loader.tsx`, `src/lib/notebook/use-notebook-sync.ts`, `src/lib/actions/notebook.ts` | remove | tldraw (Phase 3, together with the `tldraw` dependency). |
| `src/components/homework/attachments-bar.tsx`, `grade-dialog.tsx`, `homework-marks.tsx`, `homework-list.tsx`, `src/app/api/homework/**` | keep | Fallback evidence path; grade dialog gets an "Open board in Space" link (host, `canHostSpace`). |
| `src/lib/actions/homework.ts` | modify | Delete `setHomeworkPage`; `submitHomework` actor check (student/parent-of/admin) + `logAudit 'homework.submit'` + fix `revalidatePath('/hw/${id}')`; add `getHomeworkSpaceLink(id)` resolving the Space from `(hw.student_id, hw.course_id)` via `pencil_spaces`, never from `homework.space_id`, with `canHostSpace`/self check, opt-out hard stop, `pencilJoin` limit, audit. |
| `src/lib/data/homework.ts` | modify | No `pencil_spaces` join (admin-only table); demo fixtures use mock space ids `space-<student>-<course>` from `demoSpaces`. |
| `src/app/(app)/home/homework/page.tsx`, `teacher/homework/page.tsx` | modify | Copy: notebook → Space board ("work on the board called … in your Space"); Done needs no photo (owner decision 6), the attachments bar stays optional for paper work. |

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
export const getAnalyticsSession = (id: string) => pencilFetch<AnalyticsSession>(`analytics/sessions/${id}`);
export const getSessionReports = (id: string) => pencilFetch<SessionReports>(`analytics/sessions/${id}/reports`);
export const listRecordings = (spaceId: string, q: { startingAfter?: string; endingBefore?: string }) => pencilFetch<{ recordings: Recording[] }>(`spaces/recordings/${spaceId}?${new URLSearchParams(q)}`);
export const deleteRecording = (spaceId: string, recordingId: string) => pencilFetch<unknown>(`spaces/recordings/${spaceId}/${recordingId}`, { method: "DELETE" });
export const getTranscription = (recordingId: string) => pencilFetch<Transcription>(`transcriptions/${recordingId}`);
// + patchUser, findSpacesByExternalId, getRecordingDownload, listAnalyticsSessions, registerWebhook
```

Rules: authorize URLs are credentials — minted per click, returned only from `POST`/bearer routes, never persisted, never logged, never placed in `href` attributes or props rendered server-side (they would land in the HTML/RSC payload); Sentry `beforeSend`/`beforeBreadcrumb` strip `token=` and `/authorize` on server and client. Writes from provisioning/webhook/jobs use `createSupabaseAdminClient()` only (webhooks carry no cookie; `transcripts`/`session_metrics`/`teacher_feedback` are select-only under RLS). Every mutation with the API key is preceded by `canJoinLesson`/`canHostSpace`/`requireRole('admin')` in the calling route or action. If `SUPABASE_SERVICE_ROLE_KEY` is unset the webhook answers 503 — not 200 like `/api/cron/reminders`, because a 200 tells Pencil the event was delivered and it is never re-sent, while a 503 is retried, up to 10 attempts in all — and the Space routes answer `{configured:false}`.

**Webhook route** (`src/app/api/webhooks/pencil/route.ts`): `export const dynamic = "force-dynamic"`; fail closed when `PENCIL_WEBHOOK_SECRET` is unset (503) or the Bearer mismatches (401; compare `sha256(header)` with `sha256(secret)` via `crypto.timingSafeEqual` — equal length by construction); never log the header; parse with zod; insert `pencil_webhook_events` (`delivery_key` conflict → 200 `duplicate`); `jobsFor(payload)`: `SESSION_ENDED → ingest_session`, `RECORDING_AVAILABLE → ingest_recording`, `TRANSCRIPT_AVAILABLE → ingest_transcript`, `COACHING_AVAILABLE → ingest_coach_report` (by whichever of `sessionId`/`recordingId` it carries), `SPACE_USER` join (`joinSpace`, or the string the first staging deliveries show) `→ inline`: upsert `pencil_sessions(pencil_session_id, pencil_space_id, state='live', hint_session_id = in-window lesson for that Space)` — **no write to `sessions`**; everything else, including an unknown `_type` or `eventType`, is stored as `ignored` with a 200 (support 2026-10-16: anything but a 2xx within 15 s is retried, up to 10 delivery attempts in all, so a 4xx on a payload we will never accept only buys redeliveries). A body that fails the zod parse is stored with ledger `status='failed'` and answered 200 (re-sending the same bytes cannot fix it; it can be replayed by hand). A job-insert conflict on `dedupe_key` is a duplicate → 200. `delivery_key` drops the timestamp for session and recording events — `${_type}:${eventType}:${sessionId|recordingId}` — because whether a redelivery keeps its `timestamp` is unconfirmed (the 0017 column comment predates this); `SPACE_USER` keys add `:${userId}:${timestamp}`. The `joinSpace` inline write is insert-if-absent: on conflict it only fills a null `hint_session_id` and never moves `state` backwards, since a join can be redelivered after `ingest_session` ran. Answer 5xx only when the ledger insert itself failed, so Pencil retries what we did not store; while `PENCIL_WEBHOOK_SECRET` is unset the 503 makes Pencil keep retrying (up to 10 attempts, gaps growing to 10 min), which recovers events if the secret is fixed within that window. Jobs carry `dedupe_key` (`kind:pencilSessionId|recordingId`) so a redelivery with a different timestamp cannot double-run. Respond 200 in < 100 ms; best-effort fire-and-forget `fetch` to the drainer with `CRON_SECRET` for low latency (not awaited; cron is the guarantee).

**Job runner** (`/api/cron/pencil-jobs`, `GET`, `Authorization: Bearer CRON_SECRET`, `export const maxDuration = 300` — requires Vercel Pro, as the existing 15-min cron already implies): claim jobs with `update … set state='running', locked_at=now() where id=$1 and state='queued' returning *`, process sequentially (well under 5 QPS and analytics' stricter limits) within a 240 s budget and a **hard cap of 6 Claude calls per invocation independent of the DB**; on error `attempts++`, `run_after = now() + 2^attempts min`, `dead` after 8 with `captureError`. A step whose Pencil object is not ready yet (`coaching` null or `pending`, an empty transcript, a recording not yet adopted by a session) is not an error: it reschedules itself (`run_after = now() + 10–15 min`, `attempts` unchanged, no `captureError`) until that step's own deadline. Timing per lesson: analytics ingest ≈ 2 s; transcript fetch + `computeMetrics` ≈ 2 s; `analyzeLesson` (Opus, adaptive thinking) 20–60 s; `draftReport` (one call also yields agenda + follow-ups) 15–45 s; coach report ≈ 1 s. The two Claude steps are separate jobs (`ingest_transcript` runs `analyzeLesson`; `run_claude` runs `draftReport` + agenda + follow-ups + notify), so no job exceeds ~90 s and a 300 s invocation drains 3–4 lessons. End-to-end latency is dominated by Pencil (for a 1 h lesson: the session closes 6 min after everyone leaves, the recording lands within minutes of the call, the transcript at ~10 min and the AI Coach report at ~15 min — support 2026-10-16); at those latencies each 5-minute cron hop is a real share of the wait, which is why the webhook route also kicks the drainer. Each invocation also runs `reconcile` and `retention`.

## Post-session job: steps

Every step begins with: load `pencil_sessions` + Space; fetch the Pencil object; `if (fetched.spaceId !== space.pencil_space_id) → state='failed', last_error='space mismatch', admin follow-up, stop`; `isRecordingOptedOut(student)` re-check.

1. **`ingest_session`** (`SESSION_ENDED`, or `reconcile` when that delivery was lost): `GET /analytics/sessions/{id}`; `presence(attendees)` via `pencil_users` → `teacher_present`, `student_present`, `taught_by_profile_id`. The row's `started_at = min(spaceFirstJoinTime)` and `ended_at = max(spaceLastLeaveTime)` over all attendees — not `sessionStartTime`/`sessionEndTime`, which may include Pencil's six-minute close, and not decision (e)'s lesson clock. Exactly one outcome:
   - **Both in the call** (the bar in (b)): bind `session_id` to the lesson matched per (b). The lesson's figures are then recomputed from **all** its bound sessions, so arrival order cannot change them: `session_metrics` talk/camera fractions from the summed `callActiveTalkingDuration`/`callVideoOnDuration`/`callDuration` (`talk_source='pencil_analytics'`, `teacher_speaking_s`, `student_speaking_s`, `pencil_analytics`); `sessions.pencil_session_id` = the bound session with the longest `callDuration`; `actual_start`/`actual_end` per (e) as `least`/`greatest` across them, never replacing an End-written `actual_end`; `status='completed'` with `.in('status', ['scheduled','confirmed','in_progress'])` if the teacher never clicked End (credit fires once; `logAudit(null,'pencil.session_autocompleted')`). **Opt-out:** after storing those analytics, `state='skipped_opt_out'`, `sessions.analysis_status='skipped_opt_out'`, stop. Else `analytics_done`, `next_poll_at = +20 min` (the recording may already have landed; `ingest_recording` may be waiting for this row).
   - **Teacher in the call, student short of the bar** (absent, on the board only, or in the call under 5 min): store presence, state `no_show` (this Pencil session only), and write nothing to `sessions`. The lesson's no-show is decided per lesson by `reconcile` (v), because a both-in-the-call session of the same lesson may still arrive. Stop.
   - **Student alone** (the only attendee) outside every lesson's `[scheduled_start − 15 min, scheduled_end + 15 min]`: store `student_active_s = spaceDuration − spaceDurationInBackground` (floor 0); attribute it to open homework of that (student, course) per decision i (`state='homework_activity'`, added to `homework.space_activity_s`, `last_space_activity_at`). Before 0019 adds the homework columns, or with no homework open: `unmatched`. Stop.
   - **Anything else** (both in the Space without a call — a teacher reviewing homework on the whiteboard-only link — or a student waiting on the board inside a lesson's window): `unmatched`, presence stored, never bound and never homework time. Stop.
2. **`ingest_recording`**: first, a `recordingId` in `pencil_recording_deletions` → job `done`, no Pencil call. `GET /spaces/recordings/{spaceId}?startingAfter=<timestamp − 3 h 15 min>&endingBefore=<timestamp + 15 min>` (a recording can run 3 h and a redelivery can be late) and require the `recordingId` to be listed; if it is not, retry in 15 min for up to 3 h, then an admin follow-up — never a delete. **Opted-out student:** a recording that started after `recording_opt_outs.set_at` is deleted at once (reason `opt_out`); an earlier one is handed to a `delete_recording` job at `set_at + 24 h` (decision d(6)); nothing is stored either way, and the admin follow-up says so. Otherwise find the **ingested** `pencil_sessions` rows (`started_at`/`ended_at` set) whose `[started_at − 5 min, ended_at + 5 min]` overlaps the recording's `[startingTime, startingTime + duration]`. Pencil guarantees no order, and from its guide we expect the recording often to arrive before the analytics it is matched against (our inference, to be observed on staging), so when no ingested row overlaps yet the job **requeues itself** (`run_after = +10 min`) and never deletes on that ground; after 3 h `reconcile` (viii) settles it. An overlapping row bound to a lesson → store `recording_id` (the primary bound session's recording closest to `actual_start` is the one transcribed; any other is kept as a secondary). Every overlapping row `unmatched` or a teacher-only `no_show` → `DELETE` (reason `no_show` or `orphan`), store nothing. Every DELETE inserts a `pencil_recording_deletions` row and `logAudit(null,'pencil.recording.deleted',{reason})`. `sessions.recording_url` stays null (playback is Phase 4, teacher/admin only).
3. **`ingest_transcript`** (`TRANSCRIPT_AVAILABLE`, or the poll): first, a `recordingId` in `pencil_recording_deletions` → `no_recording`, no Pencil call (support says only that the transcript endpoint "stops returning" a deleted recording, so we key on our own ledger, not on a status code). Only the recording of the lesson's primary bound session (`sessions.pencil_session_id`) is transcribed: a secondary recording → job `done`, row untouched; no row has stored this `recording_id` yet (the transcript event can overtake the recording event) → requeue `+10 min` until its `ingest_recording` job has finished; if the primary changes later, steps 3–4 re-run for the new one. `GET /transcriptions/{recordingId}`; empty `transcript` → retry later (≤ 3 h, then `no_recording`); `toSegments()` with `pencil_user_id` of `taught_by` and the student; upsert `transcripts {segments, source:'pencil', pencil_summary, raw}` — `pencil_summary` only if the transcription already carries one: for a 1 h session Pencil's guide puts the transcript at ~10 min and the summary at ~15 min (both scale with length), so the summary may not be there yet; `analyzeLesson` treats it as optional context and step 5 back-fills it; `computeMetrics` for the six transcript-derived fields, keeping Pencil talk fractions; `useAi = aiConfigured && rateLimitStrict(pencilPipeline per session) && rateLimitStrict(global)`; `analyzeLesson(segments, metrics, ctx, {useAi, pencilSummary})` → `teacher_feedback` with `teacher_id = taught_by_profile_id`, `source='pencil_pipeline'`, `ai_used`; enqueue `run_claude`.
4. **`run_claude`**: `draftReport({notes:'', segments, metrics, ctx, pencilSummary, feedback})` → insert `reports` only if none exists and `taught_by` is set (`teacher_id = taught_by_profile_id`, `ai_drafted=true`, `ai_prefilled_at`, `published_at=null`, `homework` = suggestion, `next_lesson_agenda`); `getNextScheduledSession` → `session_ai_outputs {next_session_id, agenda_draft, homework_suggestion, followup_suggestions}` (never `sessions.agenda`); `raiseFollowup` for each suggested `teacher_commitment` (assigned_to `taught_by`) / `concept_gap` / `parent_contact` with `source='ai'`, `dedupe_key = '<sessionId>:<type>:<slug(reason)>'`; `sessions.analysis_status='done'`; `notifyTeacherCoachingReady`; `logAudit(null, 'pencil.transcript_processed', {type:'session', id})`; `state='transcript_done'`.
5. **`ingest_coach_report`**: triggered by `COACHING_AVAILABLE` (Pencil's recommended trigger, sent only when a report completes with insights), with a fallback poll every 15 min from `transcript_at + 15 min`, or from `analytics_at + 15 min` for a bound row that never got a transcript. The endpoint answers 200 while processing; read `coaching.status`: `pending` → poll again; `completed` → store `pencil_coach`, `pencil_coach_score`, status `completed`; `failed`/`meeting_too_short`/`meeting_irrelevant`/`no_transcript`/`disabled` → store the status only (the webhook never comes for these); `coaching` still `null` 2 h after the transcript (or the analytics) → `not_applicable`. That cut-off is ours — Pencil gave no deadline — and a later `COACHING_AVAILABLE` still overrides it. The status goes to `pencil_sessions.coach_status` and, when a feedback row exists, `teacher_feedback.pencil_coach_status`. From the same response read `safeguarding`: once it is present with `items`, store it in `pencil_sessions.safeguarding` and raise an admin `parent_contact` follow-up — each block has its own state (support 2026-10-16), so presence alone means nothing; for an opted-out student, per the owner's answer to the safeguarding question (owner to confirm the type). Any terminal coach status → `state='done'`. If `transcripts.pencil_summary` is still empty, re-`GET /transcriptions/{recording_id}` (unless the recording is in `pencil_recording_deletions`) and store `summary.description`; the reports `summary` block stays unused until Pencil says whether it is the same text. The `/reports` response carries no `spaceId`, so the Space check runs through the `pencil_sessions` row, which `ingest_session` bound after verifying the analytics `spaceId` (an unknown `sessionId` enqueues `ingest_session` first), and every `coaching.sources[].recordingId` must be a recording of this Space that overlaps the bound session (one session can hold several calls, so several recordings), with the row's `recording_id` among them. If the report lands before our row exists, run step 3 first.
6. **`reconcile`** (every cron run): (i) `in_progress` lessons past `scheduled_end + 3 h` → `GET /analytics/sessions` filtered by the Space and window; attach and enqueue `ingest_session` (which applies the same evidence rules — never auto-complete without the student), or if no Pencil session exists mark `analysis_status='failed'` and raise an admin follow-up leaving `status` for the admin to settle; (ii) `analytics_done` rows past `next_poll_at` with no recording → `GET /spaces/recordings/{spaceId}`; (iii) rows with a recording but no transcript 20 min after `recording_at` → `getTranscription`, again every 30 min, `no_recording` after 3 h; (iv) recordings listed for an opted-out student's Space → step 2's opt-out rule (at once if the recording started after the opt-out, otherwise a `delete_recording` job at `set_at + 24 h`); (v) **the per-lesson no-show of decision b**, for lessons still `scheduled`/`confirmed`/`in_progress` 90 min after `scheduled_end`: first `GET /analytics/sessions` (both `processed` and `inprogress`) for the Space and the lesson window, and enqueue `ingest_session` for any session not ingested yet; decide only once at least one ingested session lies in the window, none is still `live`/`inprogress` (a Redirect tab or a writing iPad left open may keep a session going — asked), and none has both in the call. Then a teacher-only session → `status='no_show'`, `actual_end`, `raiseFollowup(no_show)`; only student-only sessions (the teacher never came), or no Pencil session at all → leave `status`, set `analysis_status='failed'` and raise an admin follow-up, as in (i); (vi) lessons ended with End (`completed`/`no_show`) that have no ingested Pencil session 90 min after `actual_end` → `GET /analytics/sessions` for the Space and window → enqueue `ingest_session` for each session found (a `SESSION_ENDED` Pencil gave up on); if every session found is already bound to another lesson (two lessons sharing one Pencil session), raise one admin follow-up "lesson has no Pencil session of its own", set `analysis_status='failed'` and stop re-checking; (vii) bound rows whose coach status is still null or `pending` with no queued `ingest_coach_report` → enqueue it; (viii) `ingest_recording` jobs that requeued for 3 h with no overlapping row → `GET /analytics/sessions` for the Space and the recording's window: a session found → enqueue `ingest_session`; none → `DELETE` (reason `orphan`). This covers deliveries Pencil gave up on (up to 10 attempts, gaps growing from 30 s to 10 min — Pencil gave no total; about 55 min if they double), events that arrived in an order our jobs could not use yet, and settings drift. No rule here waits on an assumed retry horizon: (v) and (vi) ask Pencil for the sessions themselves.
7. **`retention`** (every cron run; Phase 2): `DELETE /spaces/recordings/{spaceId}/{recordingId}` for recordings older than the retention period (owner to confirm; default 90 days), only once our `transcripts` row exists and its coach status is terminal, or the row is terminal without a transcript (`no_recording`, `failed`, `skipped_opt_out`), in which case the coach status is not awaited — because after a delete `GET /transcriptions` stops returning it (support 2026-10-16; the response is not stated); every delete inserts a `pencil_recording_deletions` row; null `transcripts.raw` after 180 days; delete `pencil_webhook_events` rows with `status='ignored'` older than 30 days; audit each deletion.

## Homework in the Space

- **Student** (`/hw/[id]`, web or mobile): sees description, due date, `board_hint` ("Work on the board called *HW 14 Oct · Quadratics* in your Space"), and the automatic activity line ("Worked in Space 25 min on Tue"); "Open my Space board" mints an authorize URL per click (`standalone=true&mode=whiteboardonly`: no call controls, no join prompt) in a new tab — the Space opens on the student's last-viewed board, so the hint names the board to switch to; **Done** → `submitHomework` (status `submitted`; guarded by 0019; audited). No photo is required; `AttachmentsBar` stays as an optional extra (e.g. paper work).
- **Teacher** (review mode): "Open Space to review" — the same whiteboard-only link, so a review never starts a recorded call, with the item's `board_hint` beside it because the Space opens on the teacher's own last-viewed board — shown only when `canHostSpace` (assigned teacher of that course, past or present) + `GradeDialog` (verify → `completed`, send back → `incomplete`, re-open → `incomplete`); `/teacher/homework` queue unchanged.
- **Parent**: no Pencil user; sees status, the activity line, marks, feedback, attachments; no Space button; `AttachmentsBar` upload allowed as today.
- **Admin**: same as teacher (admin → Pencil Teacher user, added as host lazily by `ensureSpace`).
- **Mobile**: "Open in Pencil Space" via the bearer route (system browser); **Done** keeps its name but now sets `submitted` (teacher verifies); the activity line is shown; grading form only for `submitted`.
- **Board evidence:** Pencil can export a board as an image from inside the Space (support 2026-10-16; the helpdesk also lists a `.space` file), but only for *hosts* on paid plans (helpdesk "How do I download the board as image?"), so students cannot export their own board and are not asked to; the teacher may download the board image as evidence when verifying. There is no boards API and no deep link to a board; support says this is on Pencil's roadmap. "Private board per participant" exists as a host UI feature (not via API) and suits assessments later.
- **Activity signal (no boards API):** no programmatic proof a board exists; grading relies on the teacher viewing the Space. A student alone in the Space creates a Pencil Session that is neither recorded (no call: a participant cannot start one, and the link is whiteboard-only) nor billed (fewer than two users) — support 2026-10-16; the job runner attributes those sessions to open homework as `space_activity_s`/`last_space_activity_at` (decision i) and drives the two nudges. If Pencil adds board endpoints, `board_hint` becomes `pencil_board_id/url` and activity attribution narrows to the board, with no other change.

## Lesson room UX

Header: Leave · course name + `StatusBadge` (scheduled / waiting for student / live / call ended) · peer avatar · `Elapsed` from `actual_start` ("—" in Redirect mode until analytics backfill) · recording chip ("Recording on (audio + board)" / "Not recorded (opted out)", confirmed live by `recording_status_change`; red banner if recording while opted out) · `ProviderBadge` · teacher `EndLessonButton` / "Mark as no-show". Desktop: Space iframe fills the centre (full height, replacing both video and notebook), Materials rail on the right (files open in a new tab as today). Mobile: tabs `Space | Materials`; the Space tab is a card "Open lesson in Pencil" (Redirect mode; re-mints per tap) with "Lesson open in another tab" state and the End button. Student/parent view: the same header plus a persistent "This lesson is recorded" notice; parents see a status card only. Fallback detection: no `ready` within 15 s, or `{configured:false}` from the route → overlay "Having trouble? Open in a new tab" or "Classroom unavailable — join via fallback link" while Materials stays usable. End lesson: `endLesson()` → iframe unmounted → card "Lesson ended." with, when `pencilConfigured && pipelineEnabled` (Phase 2+), "Your coaching and a report draft arrive on your Coaching page in about 30 min" (Pencil's guide for a 1 h session, scaling with length: recording within a few minutes of the call ending, transcript ~10 min, summary and AI Coach ~15 min; plus our cron hops and Claude). Every other open room polls `GET /api/lesson/[id]/status` every 15 s and shows the same card when the lesson is over, unmounting its Space; the card adds "If the Space is still open in another tab, close that tab to leave the call". Demo: `MockSpacePanel` with "Simulate student joins" (fires the same handler as `participant_join` with the demo student's id) and a dev-only "Simulate Pencil post-session" action that runs steps 1–5 with the fixture transcription and stores the result in `src/lib/demo/runtime.ts` so `/teacher/coaching` and `/coaching/[sessionId]` show it.

## Mobile app changes

Join → `getSpaceUrl(sessionId)` (bearer) → `Linking.openURL` of the Pencil `{url}` (no web login step; URL re-minted per tap, never cached); fallback to `lessonWebUrl` when `{configured:false}`; parents see status only. Homework as above. Push payload `data.kind='coaching_ready'` deep-links to the coaching page later (web only for now). `FollowupRow.type` is a string so new types render unchanged. No new mobile env vars.

## Privacy & minors

- Pencil-side access: "Grant admins access to all Spaces" must stay ON (k), so every Pencil institution-admin login can open every child's Space and board. Keep those logins to the generic API account (used by nobody day to day) and named staff.
- Recording is opt-out at the owner's decision; recordings exclude student video ("Record participant video" OFF), include audio + whiteboard + teacher video. The lesson view always states recording status to every role; opted-out students' Spaces carry `disableAlwaysOnRecording=true` verified by read-back (the stored setting — Pencil has no effective-state endpoint), with a join hard stop and automatic deletion of stray recordings. The setting applies from the next call, so a call already running when a family opts out is recorded until it is restarted, and that recording is deleted when it lands.
- Pencil never receives a minor's full name: `createAPIUser.name` is the first name, Space titles use the first name; our mapping is `externalId = profiles.id`. Pencil is a processor of minors' voice recordings: DPA, data region and Pencil-side retention are go-live prerequisites (k).
- Pencil stores recordings, transcripts, summaries, AI Coach, safeguarding and AI snippet reports, attendance and analytics (we never store snippets). We store transcript segments, `pencil_summary`, `raw` payload, metrics, feedback and the coach report — all teacher/admin-only under RLS (`transcripts_read`, `feedback_read`, `session_ai_outputs_read`); families read published reports only and never AI drafts.
- Retention (owner to confirm numbers): delete Pencil recordings 90 days after the lesson, null `transcripts.raw` after 180 days, keep metrics/feedback for coaching history. A deleted recording disappears from Pencil's lists and playback and its transcript endpoint stops returning it (support 2026-10-16); what Pencil removes or keeps of the transcript, summary, AI Coach and safeguarding items is still pending from support and stays a go-live prerequisite (k). `DELETE /users/{userId}/remove` is permanent — never called automatically.
- `captureError` contexts never include transcript text, authorize URLs or the webhook Authorization header (`sendDefaultPii:false` stays; Sentry scrubbers added).
- Pencil identity, opt-out flags, Spaces and ledgers are admin-only tables written by the service role; `profiles.role`/`email` are guarded by trigger.

## Rollout

**Phase 0 — prerequisites (owner).** Items in (k) except always-on recording; staging key + webhook secret in Vercel preview env; `SUPABASE_SERVICE_ROLE_KEY` everywhere; HTTPS local dev cert. *Done when* a manual `POST /spaces/create` works with the key and the webhook secret is in the preview env. The webhook URL itself is registered (`POST /webhooks`) only when the Phase 2 route is deployed: before that every event would get a 404 and be retried, up to 10 attempts in all.

**Phase 1 — a real lesson in Pencil (smallest shippable).** Migration 0017; `src/lib/pencil/*` (client, authz, provision, urls, mock); lesson page + `error.tsx` + `LessonRoom`/`SpaceStage`/`MockSpacePanel`; `/api/lesson/[id]/space`; `endLesson` (completed | no_show; no Pencil call) and `/api/lesson/[id]/status` (every open room unmounts when the lesson is over); parent status view (session card, home, lesson page); `LESSON_FALLBACK_URL` (master Zoom link) + `sessions.fallback_join_url` override + `LESSON_FALLBACK_MODE`; second-device ("use this device for writing") join mode on tablets; `setRecordingOptOut` admin toggle (flag + PATCH + read-back; no-op on recording until Phase 2); Sentry scrubbers, CSP header; delete Daily, the lesson `NotebookPanel`, live coach, `/api/coach/live`, `tests/coach.test.ts`, `jotai`. **Homework is untouched**: the tldraw homework canvas, `use-notebook-sync.ts`, `actions/notebook.ts`, the `tldraw` dependency and the `attach_notebook` trigger keep working until Phase 3 (the "Open my Space board" deep link may ship early since it needs only `ensureSpace` + `mintJoinUrl`, but is not required). Institution recording mode stays **Disabled** (not Host): `disableAlwaysOnRecording` governs always-on recording only, so in Host mode nothing would stop a teacher recording an opted-out child and no Phase 1 job would delete it (whether the setting also blocks a host-started recording is asked). End copy is "Lesson ended." only. *Done when* a teacher and a student hold a lesson from `/lesson/[id]` on production, the clock starts only when the student is present (`participant_join` with the student's id), a teacher-only room visit ends as `no_show` and consumes no credit, End marks the session completed and consumes one credit, a student `UPDATE profiles SET role='admin'` fails (`tests/profile-guard.sql`), demo mode works with no key, Safari + Chrome (third-party cookies blocked) behaviour is documented, the Redirect fallback works on a phone, the shared-device/second-tab case is tested on staging, the student's room leaves the Space within 15 s of the teacher's End (so the call ends), a student who arrives first waits on the board without starting a call, and a "Use this device for writing" iPad shows no call controls. (`endOngoingSession` vs the call was answered by Pencil on 2026-10-16: it ends neither, so End does not call it.)

**Phase 2 — recording + post-session pipeline.** Our institution admin switches on always-on recording at the start of the phase (Settings > Permissions > Recording; the plan must include it) outside lesson hours and at least 3 h before the next lesson (the helpdesk's propagation figure), setting `PENCIL_RECORDING_ENABLED=on` in the same window after a staging lesson confirms recording, and the webhook URL is registered once the route is live (`GET /webhooks` shows it); migration 0018; webhook route, jobs cron (incl. `retention`, `delete_recording`; `apply_space_settings` stays an unused kind in the 0017 check — decision d), `post-session.ts`, `transcript.ts`, `analytics.ts`, `correlate.ts`; coaching UI (two cards), report pre-fill + `session_ai_outputs` + agenda, AI follow-ups, teacher notifications + bell; End copy gains the "about 30 min" line (Lesson room UX). *Done when* a recorded staging lesson yields `transcripts`, `session_metrics (talk_source='pencil_analytics', fractions 0–1)`, `teacher_feedback` with `teacher_id` = the attending teacher and both cards, a pre-filled report visible in the teacher's queue, a `session_ai_outputs` row, follow-ups on `/admin/followups`, and a push; an opted-out lesson yields `skipped_opt_out`, no recording at Pencil (or a deleted one with an audit row); a forged payload with another Space's `sessionId` ends in `state='failed'`; a lesson with the webhook disabled is reconciled by the cron; a `RECORDING_AVAILABLE` processed before its `SESSION_ENDED` waits and is kept, never deleted; a `COACHING_AVAILABLE` delivery stores the report, and a short lesson where both were in the call (5 min each) ends with a stored `pencil_coach_status` such as `meeting_too_short` shown on the card; a teacher-only call's recording is deleted with a `pencil_recording_deletions` row (reason `no_show`); a student who waited for a teacher who never came is not marked a no-show; retention deletes an aged recording only after its transcript is stored.

**Phase 3 — homework in the Space + mobile.** Migration 0019 (incl. the `attach_notebook` trigger drop); `HomeworkWorkspace`, `getHomeworkSpaceLink`, mobile routes/screens, RLS tightening; remove `homework-canvas*`, `use-notebook-sync.ts`, `actions/notebook.ts`, `tldraw`, `transpilePackages`. *Done when* student taps Done from web and mobile, teacher grades from the Space, a student-only Space session shows up on the homework item as activity within one cron run and never changes its status, the two nudges fire (overdue + no activity; activity + not Done), the column guard rejects a student setting `completed` or moving an item to a sibling (`tests/homework-guard.sql` matrix), a teacher of another course gets no Space link.

**Phase 4 — recommended.** Events mirroring (h), recording playback route (`/api/recordings/[sessionId]/download`: `requireRole('teacher','admin')`, teacher must be `sessions.teacher_id`, rate-limited, awaited audit `pencil.recording.download`, returns the short-lived `downloadLink` without storing it, and 410 without calling Pencil when the recording is in `pencil_recording_deletions`), optional "time away from the Space" line from `spaceDurationInBackground` (decision j), tldraw export + migration 0020.

**Phase 5 — parent progress dashboard.** Migration 0021 + RPC, web page and mobile tab; an interim v1 on today's data (no migration) may ship right after Phase 1. Details, metrics, tests and *Done when* in the section "Parent progress dashboard (Phase 5)" below.

**Tests.** Remove `tests/coach.test.ts`. Keep `tests/metrics.test.ts`, `tests/heuristics.test.ts`. Add `tests/pencil-transcript.test.ts` (seconds→ms, lesson-relative, speaker mapping by `taught_by`, unknown userIds, empty/null transcript), `tests/pencil-analytics.test.ts` (talk split and camera as 0–1 fractions compatible with `computeMetrics`, zero durations, presence), `tests/pencil-correlate.test.ts` (window matcher, teacher-only → no_show, student-only → unmatched, already-bound lesson, two lessons same day), `tests/pencil-webhooks.test.ts` (digest-based bearer verify incl. length mismatch, payload discrimination, `deliveryKey`, `jobsFor` for `TRANSCRIPT_AVAILABLE`/`COACHING_AVAILABLE`, an unknown `_type` or `eventType` → `ignored` with 200), `tests/post-session-reducer.test.ts` (transitions are monotonic and idempotent; completion requires both participants; report payload carries the attending teacher's id; opt-out re-check stops every step; every arrival order of `RECORDING_AVAILABLE`, `TRANSCRIPT_AVAILABLE`, `SESSION_ENDED` and `COACHING_AVAILABLE` reaches the same end state and none deletes a matched lesson's recording; each terminal `coaching.status` is stored), `tests/profile-guard.sql` and `tests/homework-guard.sql` notes for manual psql checks. Manual: iframe in Safari (ITP) and Chrome with third-party cookies blocked; mobile Redirect; shared device back-to-back lessons; End → student room unmount → `SESSION_ENDED` arrival time (expect six minutes plus processing); log the first payload of every `_type` to confirm the `SPACE_USER` join/leave strings and the `COACHING_AVAILABLE` shape; note whether `RECORDING_AVAILABLE` lands before `SESSION_ENDED`; student opens the lesson first → no call starts and nothing is recorded, then joins the teacher's call (`startCall` without `skipCallHostCheck`); writing iPad on `mode=whiteboardonly` → no call controls, no echo, analytics list the student once; opt out during a running call → it keeps recording, the recording is deleted with an audit row when it lands, and a restarted call is not recorded; after any DELETE log what `GET /transcriptions/{id}` answers; a Materials file opened from the desktop room → `USER_ENTERED_BACKGROUND` for that user; an iframe reload inside the Space after `ready` still signed in (otherwise add a re-mint on reload); opt-out toggle flips `settings.disableAlwaysOnRecording` and read-back confirms; join refused while unconfirmed; teacher reassignment adds the host; duplicate webhook delivery → one job; forged `sessionId` → failed.

**Rollback.** Delete the old lesson path; do not keep Daily/tldraw behind a flag. Reasons: the two stacks are entangled (single Daily call object constraint, `attach_notebook` trigger, Realtime channel, RLS-blocked `finalizeLesson` writes that never worked in real mode), a dual path doubles the test surface, and the pre-Pencil path was never live for real users. Rollback = revert the squash-merged PR per phase; migrations 0017–0019 are additive (notebooks survive until 0020), so a code revert is sufficient. Operational degrade is the fallback link, not the mock: during a Pencil outage `LESSON_FALLBACK_MODE=on` (or a per-session `fallback_join_url`) lets lessons run on a plain meeting link with Materials and End still working, while the webhook pipeline keeps processing lessons that did run; unsetting the key is never the outage path.

## Parent progress dashboard (Phase 5)

**Owner request:** "a dashboard in app for parents to see these metrics such as time spent on hw etc". **Scope:** one page per child showing lesson attendance and time, homework completion, marks and Space activity, speaking minutes, and ratings from *published* reports, over the last 4 or 12 weeks, overall or per course. **Never shown to families:** `teacher_feedback` (dimension scores, moments, `pencil_coach`), `session_ai_outputs`, report drafts (`published_at is null`), `transcripts`/`pencil_summary`, `pencil_sessions.safeguarding`, other students' rows. "Time in their Space" is labelled as activity, never as time-on-task, and nothing here changes a status.

### Metrics and availability

Weekly buckets are Monday-start weeks in the **viewer's** timezone (`profile.timezone` on web, `deviceTimezone()` on mobile), computed by `date_trunc('week', ts at time zone p_tz)` in SQL and `DateTime.setZone(tz).startOf('week')` in TS so both agree. Windows: `weeks ∈ {4, 12}` (RPC clamps to 1–26); rows are grouped by `(week_start, course_id)` so "all courses" is a sum and "per course" a filter, done in TS.

| Metric (tile / series) | Computation | Phase |
|---|---|---|
| Lessons attended, no-shows, cancelled; attendance rate | `count(*) filter (where status='completed' / 'no_show' / 'cancelled')` over `sessions` with `scheduled_start < now()`; rate = completed ÷ (completed + no_show), cancelled excluded; `lessons_unsettled` = past lessons still `scheduled/confirmed/in_progress` (not yet settled by the pipeline, which settles a forgotten End from Pencil's sessions within about 90 min, or with no Pencil session at all, which `reconcile` (i) leaves to the admin) shown as "n awaiting the teacher's confirmation", never in the rate | today |
| Lesson time (h m) | `sum(coalesce(actual_end − actual_start, scheduled_end − scheduled_start))` for completed lessons; `lesson_min_estimated` counts lessons using the booked slot ("n of m use the booked time") | today (0007); Phase 2 `ingest_session` backfills the clocks |
| Homework set / submitted / on time / verified / self-marked | bucketed by `assigned_at`; submitted = `coalesce(submitted_at, completed_at) is not null` (mobile `markHomework` writes `status='completed'` + `completed_at` with no `submitted_at` until the 0019 guard lands); **verified = `status='completed' and verified_at is not null`** (set by web and mobile `gradeHomework`, never by `markHomework`); self-marked = `status='completed' and verified_at is null` → "n marked done by the family (not yet checked)"; on time = `coalesce(submitted_at, completed_at) <= due_at`, rate over `hw_due_submitted` (submitted items **with** a due date) only | today |
| Marks accuracy | `sum(mark_correct) ÷ sum(correct + incorrect + not_done)` (0–1 fraction, rendered `pct()`-style) | today (0009) |
| Open / overdue / awaiting review (snapshot, not windowed) | `status in ('assigned','incomplete')`, `… and due_at < now()`, `status='submitted'` | today |
| Reports published, average rating | `reports` joined 1:1 to the student's sessions, **`published_at is not null` only**, `avg(rating)` | today |
| Speaking minutes in lessons | `sum(session_metrics.student_speaking_s)` per week (Pencil `callActiveTalkingDuration`) | Phase 2 (0018) |
| Camera on share | `avg(student_camera_pct)` (0–1), shown as a percentage of call time with the camera on (owner decision 7: both speaking minutes and camera share are shown) | Phase 2 |
| Time in their Space | **Not** `sum(homework.space_activity_s)`: decision (i) attributes one student-only Pencil session to *every* open item whose window contains it, so an item sum double-counts, and it would land in the assignment week. Instead one row per `pencil_sessions` row with `state='homework_activity'` in the student's Spaces, `sum(student_active_s)` (time the Space was in view; not `ended_at − started_at`, which includes background time and possibly Pencil's six-minute close) bucketed by `started_at` week. The per-item figure stays on the homework item ("Worked in Space 25 min on Tue"), as the plan already shows it | Phase 3 (0019; see dependency note) |

Every rate whose denominator is 0 is `null` in `rollUp` and renders `—`. Before a metric's phase (`available.*` false, computed **student-wide**, not per window) the tile renders `—` with "Available once lessons run in the new classroom" / "Available once homework moves to the Space"; once available, an empty window shows `0 min` with the normal hint.

### Data access: `supabase/migrations/0021_student_progress.sql`

A SECURITY DEFINER function, not a view: a view would still need parent-readable policies on `session_metrics`, `pencil_*` and homework activity columns, and RLS cannot express "aggregates only". The viewer rule is **self / `is_parent_of` / `is_admin`** — the `teaches_student` branch is deliberately absent: `teaches_student` (0002) is true for any teacher who ever had a session row with the student, and a function returning aggregates over *all* the student's lessons would hand that teacher other teachers' speaking seconds, camera fractions and ratings, which `metrics_read`, `sessions_select` and `reports_read` (0003) restrict to `teacher_id = auth.uid()`. A direct `rpc()` call bypasses any UI, so the branch returns only with its own `s.teacher_id = auth.uid()` / `r.teacher_id = auth.uid()` scoping when the staff view is built. `auth.uid()` is null for the service role, so the admin client is **denied** by design — callers run it as the viewer. Requires 0018 and 0019.

```sql
-- ============================================================================
-- 0021_student_progress.sql — family progress aggregates (Phase 5)
-- ----------------------------------------------------------------------------
-- Per-week, per-course AGGREGATES for one student. Families never gain row
-- access to session_metrics (0003 metrics_read is teacher/admin), pencil_* or
-- transcripts: this function reads them as owner and returns sums/counts only.
-- Reads: sessions, session_metrics (two student columns), reports (published
-- fields only), homework, pencil_sessions (started_at/ended_at/state/student_active_s only),
-- pencil_spaces (student_id/course_id), enrollments, courses. Nothing else.
-- Needs 0018 (which allows state 'homework_activity' and adds student_active_s) + 0019.
-- ============================================================================
create index if not exists homework_student_assigned_idx on public.homework (student_id, assigned_at);
create index if not exists pencil_sessions_space_started_idx on public.pencil_sessions (space_id, started_at) where state = 'homework_activity';

create or replace function public.get_student_progress(
  p_student_id uuid, p_weeks int default 4, p_tz text default 'UTC'
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_weeks int  := least(greatest(coalesce(p_weeks, 4), 1), 26);
  v_tz    text := coalesce(p_tz, 'UTC');
  v_from  timestamptz;
  v_out   jsonb;
begin
  -- Viewer rule: self / parent / admin ONLY. No teaches_student branch (see plan text).
  -- auth.uid() is null for the service role -> denied on purpose: web uses the cookie
  -- client, mobile a bearer-scoped client (never the admin client).
  -- ORDER MATTERS: 42501 before the existence check, so an outsider cannot probe
  -- whether a uuid is a student. Do not "fix" this.
  if auth.uid() is null or not (
       p_student_id = auth.uid() or public.is_admin() or public.is_parent_of(p_student_id)) then
    raise exception 'not allowed to view this student' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_student_id and role = 'student') then
    raise exception 'not a student' using errcode = '22023';
  end if;

  -- Monday-start weeks in the VIEWER's zone (= Luxon startOf('week') in aggregate.ts). Bad zone -> UTC.
  begin perform now() at time zone v_tz; exception when others then v_tz := 'UTC'; end;
  v_from := (date_trunc('week', now() at time zone v_tz) - make_interval(weeks => v_weeks - 1)) at time zone v_tz;

  with lessons as (
    select date_trunc('week', s.scheduled_start at time zone v_tz)::date as week_start, s.course_id,
           count(*) filter (where s.status = 'completed') as lessons_completed,
           count(*) filter (where s.status = 'no_show')   as lessons_no_show,
           count(*) filter (where s.status = 'cancelled') as lessons_cancelled,
           -- past lessons not settled yet (the pipeline settles a forgotten End within ~90 min; no Pencil session -> admin)
           count(*) filter (where s.status in ('scheduled','confirmed','in_progress') and s.scheduled_end < now()) as lessons_unsettled,
           -- real clocks (0007: participant_join + End; Phase 2 backfill) else the booked slot
           coalesce(round(sum(extract(epoch from coalesce(s.actual_end - s.actual_start,
                     s.scheduled_end - s.scheduled_start))) filter (where s.status = 'completed') / 60), 0)::int as lesson_min,
           count(*) filter (where s.status = 'completed' and (s.actual_start is null or s.actual_end is null)) as lesson_min_estimated,
           coalesce(sum(m.student_speaking_s), 0)::int as speaking_s,          -- 0018, Pencil analytics
           count(m.student_speaking_s)                 as analytics_n,
           avg(m.student_camera_pct)                   as camera_pct,          -- 0..1
           count(r.published_at)                       as reports_published,
           coalesce(sum(r.rating) filter (where r.published_at is not null), 0) as rating_sum,
           count(r.rating)        filter (where r.published_at is not null)     as rating_n
    from public.sessions s
    left join public.session_metrics m on m.session_id = s.id
    left join public.reports r on r.session_id = s.id            -- published fields only leave here
    where s.student_id = p_student_id and s.scheduled_start >= v_from and s.scheduled_start < now()
    group by 1, 2
  ), hw as (
    select date_trunc('week', h.assigned_at at time zone v_tz)::date as week_start, h.course_id,
           count(*) as hw_assigned,
           count(*) filter (where coalesce(h.submitted_at, h.completed_at) is not null) as hw_submitted,
           count(*) filter (where coalesce(h.submitted_at, h.completed_at) is not null and h.due_at is not null) as hw_due_submitted,
           count(*) filter (where h.due_at is not null and coalesce(h.submitted_at, h.completed_at) <= h.due_at) as hw_on_time,
           count(*) filter (where h.status = 'completed' and h.verified_at is not null) as hw_verified,
           count(*) filter (where h.status = 'completed' and h.verified_at is null)     as hw_self_marked,  -- mobile markHomework, pre-0019
           coalesce(sum(h.mark_correct), 0) as marks_correct,
           coalesce(sum(coalesce(h.mark_correct,0) + coalesce(h.mark_incorrect,0) + coalesce(h.mark_not_done,0)), 0) as marks_total
    from public.homework h
    where h.student_id = p_student_id and h.assigned_at >= v_from
    group by 1, 2
  ), space as (
    -- 0019 / decision i: ONE row per student-only Pencil session, bucketed by when it
    -- happened. Never sum homework.space_activity_s here (double counts across open items).
    select date_trunc('week', ps.started_at at time zone v_tz)::date as week_start, sp.course_id,
           round(sum(coalesce(ps.student_active_s, 0)) / 60.0)::int as space_min,   -- in-view seconds (0018), not wall clock
           count(*) as space_n
    from public.pencil_sessions ps join public.pencil_spaces sp on sp.id = ps.space_id
    where sp.student_id = p_student_id and ps.state = 'homework_activity'
      and ps.started_at >= v_from and ps.ended_at is not null
    group by 1, 2
  ), keys as (
    select week_start, course_id from lessons
    union select week_start, course_id from hw
    union select week_start, course_id from space
  )
  select jsonb_build_object(
    'student_id', p_student_id, 'tz', v_tz, 'weeks', v_weeks, 'from', (v_from at time zone v_tz)::date,
    'weekly', coalesce((select jsonb_agg(to_jsonb(w) order by w.week_start) from (
        select k.week_start, k.course_id,
               l.lessons_completed, l.lessons_no_show, l.lessons_cancelled, l.lessons_unsettled, l.lesson_min, l.lesson_min_estimated,
               l.speaking_s, l.analytics_n, l.camera_pct, l.reports_published, l.rating_sum, l.rating_n,
               h.hw_assigned, h.hw_submitted, h.hw_due_submitted, h.hw_on_time, h.hw_verified, h.hw_self_marked,
               h.marks_correct, h.marks_total, sp.space_min, sp.space_n
        from keys k
        left join lessons l on l.week_start = k.week_start and l.course_id  is not distinct from k.course_id
        left join hw      h on h.week_start = k.week_start and h.course_id  is not distinct from k.course_id
        left join space  sp on sp.week_start = k.week_start and sp.course_id is not distinct from k.course_id) w), '[]'::jsonb),
    'open_homework', (select jsonb_build_object(
        'to_do',     count(*) filter (where status in ('assigned','incomplete')),
        'overdue',   count(*) filter (where status in ('assigned','incomplete') and due_at < now()),
        'submitted', count(*) filter (where status = 'submitted'))
      from public.homework where student_id = p_student_id),
    'courses', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name)
      from public.courses c where c.id in (
        select course_id from public.enrollments where student_id = p_student_id
        union select course_id from keys)), '[]'::jsonb),
    -- STUDENT-WIDE, not window-bound: a quiet month must not revert a tile to "not yet available"
    'available', jsonb_build_object(
        'analytics', exists (select 1 from public.session_metrics m join public.sessions s on s.id = m.session_id
                             where s.student_id = p_student_id and m.talk_source = 'pencil_analytics'),
        'space_activity', exists (select 1 from public.pencil_sessions ps join public.pencil_spaces sp on sp.id = ps.space_id
                                  where sp.student_id = p_student_id and ps.state = 'homework_activity'))
  ) into v_out;
  return v_out;
end $$;

-- auth.uid() IS NULL is the gate for the admin/service client; service_role keeps EXECUTE via
-- Supabase default privileges on purpose (add `revoke … from service_role` only if the owner
-- wants a grant-level block as well).
revoke all on function public.get_student_progress(uuid, int, text) from public, anon;
grant execute on function public.get_student_progress(uuid, int, text) to authenticated;
notify pgrst, 'reload schema';
```

The TS side is split so demo mode, the Phase-1 interim and the RPC share one roll-up:

```ts
// src/lib/progress/aggregate.ts — pure, no server imports (vitest-able)
export interface WeekRow { week_start: string; course_id: string | null; lessons_completed: number; lessons_no_show: number;
  lessons_cancelled: number; lessons_unsettled: number; lesson_min: number; lesson_min_estimated: number; speaking_s: number | null;
  analytics_n: number; camera_pct: number | null; reports_published: number; rating_sum: number; rating_n: number; hw_assigned: number;
  hw_submitted: number; hw_due_submitted: number; hw_on_time: number; hw_verified: number; hw_self_marked: number;
  marks_correct: number; marks_total: number; space_min: number | null; space_n: number }
export interface StudentProgress { student_id: string; tz: string; weeks: number; from: string; weekly: WeekRow[];
  open_homework: { to_do: number; overdue: number; submitted: number }; courses: { id: string; name: string }[];
  available: { analytics: boolean; space_activity: boolean } }
/** Demo + Phase-1 interim: same buckets as the RPC, from RLS-visible rows. Sensitive inputs are optional and default to null. */
export function bucketWeekly(input: { sessions: Session[]; homework: Homework[]; reports: Report[] }, tz: string, weeks: number): WeekRow[];
/** Totals; rates as fractions 0–1 or NULL when the denominator is 0 (attendance: completed+no_show; on time: hw_due_submitted;
 *  avg_rating: rating_n; accuracy: marks_total); zero-filled series [{week_start, lesson_min, hw_submitted, space_min, speaking_min}]. */
export function rollUp(p: StudentProgress, courseId?: string | null): ProgressSummary;
export function weekLabel(weekStartISODate: string, tz: string): string;  // "13 Oct"
```

`src/lib/data/progress.ts` → `getStudentProgress(profile, studentId, { weeks, courseId })`: demo branch builds `bucketWeekly()` from `buildDemoSessions()`, `demoHomework()`, `demoReports` (plus a few `student_speaking_s`/`actual_*` values and demo `homework_activity` rows so tiles are visible); live branch calls `createSupabaseServerClient()!.rpc("get_student_progress", { p_student_id, p_weeks, p_tz: profile.timezone })`; both pass through `rollUp`. The page additionally checks `studentId ∈ getChildren(profile)` before calling (defence in depth; the RPC is the real gate).

### Where it lives

**Web:** `src/app/(app)/home/progress/page.tsx` (`requireRole("student","parent")`, search params `student`, `weeks=4|12`, `course`), child switcher for parents (same `getChildren` list the booking dialog uses), course segments as links (server component, no client state). `NAV.student`/`NAV.parent` in `src/components/app-shell.tsx` gain `{ href: "/home/progress", label: "Progress", icon: TrendingUp }`; `/home` gets a "This month" strip (lessons, homework verified, Space minutes) linking to it. Admins pass the RPC rule; teachers do not — a staff view (`/teacher/students/[id]/progress`) needs the scoped branch above and is deferred.

**Visuals:** five `StatCard` tiles (Lessons attended with "n no-shows · n awaiting the teacher's confirmation" hint, Lesson time, Homework verified / on time with the self-marked hint, Time in their Space, and an Engagement tile with speaking minutes + camera-on share once Phase 2 data exists) plus Reports (`Stars` from `home/reports/page.tsx`, lifted to `src/components/ui/stars.tsx`). Weekly series as `src/components/progress/weekly-bars.tsx`, a labelled extension of `TrendBars` in `src/components/coaching/score-bars.tsx` (CSS flex bars, x-axis `weekLabel`, `tabular-nums`, `aria-label` per bar, no chart library). **The implementer must load the `dataviz` skill before writing any tile or bar code** (web and mobile), and keep bars single-hue with the current week emphasised, as `TrendBars` does.

**Mobile:** new tab `mobile/app/(tabs)/progress.tsx` (`Tabs.Screen name="progress"` with `href: isStaff ? null : undefined` in `_layout.tsx`, icon `trending-up-outline`), child picker via `getActableChildren`, tiles as RN `Card`s and bars as flex `View`s; `mobile/lib/api.ts` `getProgress(studentId, weeks)` → bearer `GET /api/mobile/progress?student=&weeks=&tz=`; route `src/app/api/mobile/progress/route.ts`: `profileFromBearer` → `actableStudentIds` (lifted from `api/mobile/sessions/route.ts` into `src/lib/mobile/students.ts`) → `supabaseForBearer(token)` (new helper in `src/lib/mobile/auth.ts`: anon key + the caller's JWT so `auth.uid()` resolves inside the RPC) → `rpc("get_student_progress", { p_tz: IANAZone.isValidZone(tz) ? tz : profile.timezone })` → `rollUp` → JSON, so web and mobile render one shape. `rateLimit("progress:<profile id>", 120, 3600)` added to `LIMITS`.

### Privacy wording (`src/lib/progress/copy.ts`, shared by web and mobile)

```ts
export const PROGRESS_COPY = {
  intro: "Lesson attendance and time, homework status and marks, and ratings from published reports. Teacher coaching notes and AI analysis are never shown to families.",
  spaceTime: (first: string) => `Minutes ${first} spent alone in their course Space, with it open on screen, while homework was open. Activity, not finished work — the teacher's check is.`,
  selfMarked: (n: number) => `${n} marked done by the family (not yet checked)`,
  unsettled:  (n: number) => `${n} awaiting the teacher's confirmation`,
  speaking: "From the classroom's call analytics: minutes your child was speaking. Not a measure of understanding.",
  camera: "Share of call time with your child's camera on. Cameras can be off for good reasons; this is context, not a score.",
  lessonTime: "Measured from when both teacher and student were present; lessons without that clock use the booked time.",
  recorded: "Lessons are recorded (audio + board) for the teacher's report and coaching.",   // decision d wording
  notRecorded: "Lessons are not recorded for this student.",                                  // recording_opt_outs
  notYet: { analytics: "Available once lessons run in the new classroom", space: "Available once homework moves to the Space" },
};
```

The recording line is gated twice: `pipelineEnabled` (the Phase 2 always-on switch, the same flag that gates the End copy — institution recording stays Disabled through Phase 1 (not Host — see Rollout), so saying "recorded" earlier would be false) **and** `getRecordingOptOutSet([studentId])` from `src/lib/data/people.ts` (null → line omitted). Before the switch the line is omitted. `RecordingChip` in `session-card.tsx` needs the same `pipelineEnabled` gate (plan-wide fix, noted here).

### File-by-file

| Path | Action | What / why |
|---|---|---|
| `supabase/migrations/0021_student_progress.sql` | new | `get_student_progress` + two indexes (above). |
| `supabase/migrations/0018_pencil_post_session.sql` | modify (Phase 2) | Already allows `pencil_sessions.state='homework_activity'` and adds `student_active_s` — the attribution job and this RPC both need them. |
| `src/lib/progress/aggregate.ts`, `copy.ts` | new | Pure buckets/roll-up/types; shared copy. |
| `src/lib/data/progress.ts` | new | `getStudentProgress` (demo / interim / RPC). |
| `src/app/(app)/home/progress/page.tsx` | new | Page, child + course + weeks switches, privacy block. |
| `src/components/progress/progress-dashboard.tsx`, `weekly-bars.tsx` | new | Tiles + series; `—` states from `available` and null rates. |
| `src/components/ui/stars.tsx` | new | `Stars` lifted from `home/reports/page.tsx` (which imports it). |
| `src/components/app-shell.tsx`, `src/app/(app)/home/page.tsx`, `src/components/session-card.tsx` | modify | Nav item; "This month" strip; `RecordingChip` gate. |
| `src/lib/mobile/auth.ts`, `src/lib/mobile/students.ts` | modify / new | `supabaseForBearer`; shared `actableStudentIds`. |
| `src/app/api/mobile/progress/route.ts` | new | Bearer route (above). |
| `src/lib/rate-limit.ts` | modify | `LIMITS.progress`. |
| `mobile/app/(tabs)/_layout.tsx`, `progress.tsx`, `mobile/lib/api.ts`, `mobile/lib/types.ts` | modify / new | Tab, screen, `getProgress`, `ProgressSummary`. |
| `src/lib/demo/data.ts`, `supabase/seed.sql` | modify | A few `student_speaking_s`, `actual_*` values and `homework_activity` rows so tiles have data. |
| `tests/progress-aggregate.test.ts`, `tests/progress-route.test.ts`, `tests/student-progress.sql` | new | Below. |

### Tests

`tests/progress-aggregate.test.ts` (vitest): a Sunday 23:30 `Asia/Singapore` lesson lands in the earlier week than for `America/New_York`; series is zero-filled to exactly `weeks` entries ending this week; `lesson_min` prefers actual clocks and counts `lesson_min_estimated`; a mobile-style row `{status:'completed', verified_at:null, submitted_at:null, completed_at:X}` counts as submitted and self-marked, **not** verified; a web-graded row (`verified_at` set) counts as verified; a submitted item with no `due_at` is excluded from the on-time rate; zero denominators (`completed+no_show=0`, `hw_due_submitted=0`, `rating_n=0`, `marks_total=0`) yield `null`, never `0` or `NaN`; only `published_at` reports feed `avg_rating`; attendance rate excludes cancelled and unsettled; per-course filter sums match the all-courses total; `available.*` false when all `speaking_s`/`space_min` are null; `rollUp` output keys ⊆ an allowlist (no `feedback`, `coach`, `dimension`, `transcript`, `safeguarding`). `tests/progress-route.test.ts`: 401 without bearer, 403 for a non-actable student, invalid `tz` falls back to the profile's, `weeks=7` → 4. `tests/student-progress.sql` (manual psql notes, like `profile-guard.sql`): with `request.jwt.claims` set per persona — parent c1 → b1 ok, b2 → `42501`; student b1 self ok, b2 denied; teacher a1 (has a session with b1) → `42501`; admin ok; no claims (service role) denied; a JWT with `role='service_role'` and a foreign `sub` → `42501`; a random uuid from a non-parent → `42501` not `22023` (order); two overlapping homework items + one 25-min `homework_activity` session → `space_min = 25` once, in the `started_at` week; `p_weeks=99` clamps to 26; `p_tz='Mars/Olympus'` → `tz:'UTC'`; result keys match the allowlist.

### Rollout

**Phase 5 (after Phase 3):** 0021, RPC path, mobile route + tab. **Interim v1 after Phase 1 (no migration):** the same page fed by `bucketWeekly()` over `sessions`/`homework`/`reports` through the cookie client — all already family-readable under 0003/0004, so no new exposure — with the Phase 2/3 tiles in their `—` state, the self-marked hint active and no recording line; mobile waits for Phase 5. *Done when* a parent sees only their children (switcher and RPC both refuse a sibling's id), a teacher's JWT gets `42501` from the RPC, a 12-week view in `Asia/Singapore` and `America/New_York` buckets the same lesson into the expected weeks, the Space tile reads "spent alone in their course Space, with it open on screen, while homework was open", counts one Pencil session once and never changes a homework status, a family-marked item shows under "not yet checked" rather than "verified", a `curl` with the service-role key or with another family's JWT gets `42501`, the `tests/student-progress.sql` matrix passes, `rollUp` output contains no coaching/AI/transcript keys, the mobile tab renders the same numbers as the web page for the same `tz`, and the `dataviz` skill checklist was applied to tiles and bars.

### Open questions

- Show `avg_rating` only when `rating_n ≥ 3`? Week start Monday (ISO) for every locale?
- Staff view (`/teacher/students/[id]/progress`, `/admin/people`): add the `teaches_student` branch scoped to `s.teacher_id = auth.uid()` / `r.teacher_id = auth.uid()`, with the test "a1 sees only own-lesson aggregates, not a2's ratings/speaking" — in scope later?
- A weekly WhatsApp/push "progress summary" to parents via the existing reminders cron — desired?
- Hard-block the service role at the grant level too (`revoke execute … from service_role`), or keep `auth.uid() is null` as the single documented gate?

## Open questions

**For the product owner**
- Confirm the plan tier (Advanced for AI Coach; Expert for Summaries) **includes always-on cloud recording** (required before our admin can choose Always-on) and that it is acceptable cost-wise: Cloud Recording is billed while a recording is active, and always-on records every call from its start — including a teacher alone in the call that `startCall` starts on arrival, before the student comes (every no-show leaves a recording for step 2 to delete). Space time itself is billed only while two different users are present on per-user-hour plans, and from the participant threshold (2 by default) on group-session plans (support 2026-10-16).
- Teacher and admin links start the call on arrival (`startCall`). Keep that, or have hosts start the call themselves once the student is there (no recorded wait), and give admin observers a link without `startCall` so an early observer does not start a call with the waiting student that the pipeline would read as taught?
- Is opt-out retroactive: on opt-out we delete Pencil recordings and `transcripts.raw` for past lessons; also purge segments, summaries, our feedback and the coach report?
- Recording playback (Phase 4): teacher/admin only, or also parents of recorded students?
- Retention numbers for Pencil recordings (default 90 days) and our raw transcripts (default 180 days).
- Approve Phase 4 Events mirroring and the optional "time away from the Space" line from `spaceDurationInBackground` (decision j); or drop `live_events` entirely.
- Which families to inform about the new default-recording policy before the Phase 2 switch; wording of the in-room "This lesson is recorded" notice.
- Keep Pencil's distraction notifications (teacher alerted when the student leaves the Pencil tab) on? They fire whenever the student opens Materials in Redirect mode, and we expect the same in the desktop room, where each Materials file opens in a new tab (decision j). If on, should Materials open inside the room instead?
- Confirm decision p: Spaces stay owned by the API account (a generic school account visible in every Space's member list) rather than by the tutor, so any teacher — including one who leaves the school — can be removed from a child's Space. Also: should (g) remove a previous teacher who has taught the pair once the student has moved on for good?
- A Pencil safeguarding item on an opted-out child's lesson (possible when a running call was still recording): always raise it as a follow-up for child protection, or store nothing recording-derived?

**For Pencil support** (the 2026-10-16 answers resolved the first round; these follow from them — also in [`vendor-answers-2026-10-16.md`](./vendor-answers-2026-10-16.md))
- `COACHING_AVAILABLE`: what is its `_type`, and which ids does it carry (`sessionId`, `recordingId`, `spaceId`)?
- `SPACE_USER` eventTypes: the tab events are `USER_ENTERED_BACKGROUND`/`USER_ENTERED_FOREGROUND`, your webhook docs print `hideTab`/`unhideTab` — are join and leave `joinSpace`/`leaveSpace` or upper-case forms? The full current list per `_type`, please.
- Does a redelivery keep the first attempt's `timestamp`, and is there a delivery id to deduplicate on?
- If `owner` is passed on create, can the owner later be changed or removed when a student changes tutor?
- With `startCall=true` and no `skipCallHostCheck`, does a participant who arrived first join the host's call automatically, or see a prompt?
- Is the reports `summary` block the same text as `GET /transcriptions/{id}`'s `summary.description`, and what is in `snippets`?
- What makes a participant "inactive" for the six-minute close — does a backgrounded tab or a `mode=whiteboardonly` device keep a session open? Is `sessionEndTime` the last leave or the close six minutes later?
- Is the embed's `participantupdate.count` users, call participants or devices, and does `participant_join` fire for a user's second, whiteboard-only device? Does a whiteboard-only device play call audio?
- Does `disableAlwaysOnRecording=true` also stop a host starting a cloud recording by hand, in Always-on and in Host mode? Does the helpdesk's "up to 3 h" apply to this setting or only to switching the institution mode?
- For a session with several calls, does `coaching.sources[]` list every recording? Can a participant add and rename a board on a whiteboard-only link?
- (Pending from support) what `DELETE /spaces/recordings/{spaceId}/{recordingId}` removes with the recording (transcript, summary, AI Coach, safeguarding) and what is retained, for how long; if we delete minutes after `RECORDING_AVAILABLE`, does Pencil still generate the transcript, summary, AI Coach and safeguarding items and send their webhooks; what `GET /transcriptions` and `/reports` answer afterwards; data region; DPA for minors' recordings.
