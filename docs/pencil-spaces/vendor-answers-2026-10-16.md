# Pencil support answers (received 2026-10-16)

Pencil support's reply to the "For Pencil support" questions in [`integration-plan.md`](./integration-plan.md), in the order asked. The answers are Pencil's, lightly reformatted; each one is followed by what it means for us. [`api-notes.md`](./api-notes.md) folds the facts in, and the plan's "Pencil support answers" section lists what changed.

One answer is still pending: what else `DELETE` removes with a recording (7). Follow-up questions are at the end.

## 1. Transcript webhook

> The eventType is `TRANSCRIPT_AVAILABLE`, under `_type: "SPACE_RECORDING"`. The payload is `{ _type, eventType, spaceId, recordingId, timestamp }`. Webhooks tell you that something is ready, they don't contain the content itself. Use the `recordingId` to fetch the transcript with `GET /transcriptions/{recordingId}`.

**For us:** `jobsFor` maps `TRANSCRIPT_AVAILABLE` to `ingest_transcript` by name. The old rule ("any `SPACE_RECORDING` that is not `RECORDING_AVAILABLE` is the transcript") is retired. An unknown `eventType` is ledgered as `ignored`.

## 2. Retries and ordering

> If your endpoint doesn't return a 2xx within 15 seconds, we retry with exponential backoff (starting at 30 seconds and growing to 10 minutes between attempts), for up to 10 delivery attempts in total. Ordering is not guaranteed, especially when a delivery fails and is retried.

**For us:** with doubling capped at 10 minutes, the nine gaps are 30 s, 1, 2, 4, 8, 10, 10, 10 and 10 min. A delivery is therefore abandoned about 55 minutes after the first attempt, so an outage longer than that loses events and only `reconcile` recovers them. The route answers 2xx for everything it stored or chose to ignore, and 5xx only when it could not store the delivery. No job may assume an order. With the timings in (3) and (4), `RECORDING_AVAILABLE` (minutes after the call) is likely to arrive *before* `SESSION_ENDED` (six minutes after everyone leaves, plus processing) even with no retries at all.

## 3. Timings and the reports endpoint

> Timings scale with recording length. For a one-hour session, as a guide:
> - Recording available: within a few minutes of the call ending
> - Transcript: ~10 mins
> - Summary and AI Coach report: ~15 mins
>
> `GET /analytics/sessions/{id}/reports` returns `200` while processing, not `404`. Each block (`coaching`, `summary`, `safeguarding`, `snippets`) reflects its own state:
> - `coaching` is `null` until AI Coach processing starts for that session. It is also `null` if AI Coach doesn't apply to the session, for example if it isn't enabled.
> - Once processing starts, `coaching` is an object with a `status` field: `pending` while running, then `completed`, or one of `failed`, `meeting_too_short`, `meeting_irrelevant`, `no_transcript` or `disabled`.
>
> We recommend using the `COACHING_AVAILABLE` webhook as your trigger, and checking `coaching.status` if you poll. The webhook is only sent when a report completes with insights, so the status field is how you'll see the other outcomes.

**For us:** the coach report is triggered by `COACHING_AVAILABLE`, with a status poll as the fallback. Every terminal `coaching.status` is stored and shown. A `coaching` that stays `null` long after the transcript means AI Coach does not apply. These timings replace the helpdesk's "~1 h" for recordings and "~30 min" for insights.

## 4. `POST /spaces/{spaceId}/endOngoingSession`

> It only ends the analytics session. It closes the current session and immediately starts a new one for anyone still in the Space. It does not end the call, disconnect participants, or stop or split the cloud recording.
>
> We end the session six minutes after the last participant leaves or becomes inactive, so I don't think you would need to explicitly call this endpoint.

**For us:** "End lesson" no longer calls it. Calling it while the student was still connected split off a short student-only session, which decision (i) would have counted as homework activity. Ending the call is now everyone leaving: every open lesson room polls the lesson's status and unmounts its Space once the lesson is over. A session closes six minutes after the last person leaves; our notes said five.

## 5. Student alone in a Space, and starting a call

> - **Recording:** always-on recording only starts when a call starts. A student alone on the whiteboard with no call is not recorded.
> - **Billing on per-user-hour plans:** Space time is billed only when at least two different users are in the Space, so time alone isn't billed. Joining from several devices under the same account doesn't add to usage.
> - **Billing on group-session plans:** billing starts at your plan's participant threshold, which is 2 users by default.
> - **Who can start a call:** by default only hosts can. Standalone mode only hides navigation (leave, invite, copy link); it doesn't change who can start a call.
> - **Letting a participant start a call alone:** add `startCall=true&skipCallHostCheck=true` to the Space URL. Note that if always-on recording is enabled, that call will be recorded, and Cloud Recording is billed while recording is active.
>
> More info: https://helpdesk.pencilspaces.com/en/articles/12163955-how-is-my-billing-usage-calculated

**For us:** lesson links drop `skipCallHostCheck`. A student who arrives first would otherwise start a call alone, recorded and billed under always-on recording. Homework time alone in the Space is neither recorded nor billed. A participant cannot start a call there, so the "homework call is recorded" worry is closed.

## 6. Always-on recording settings

> - **Enabling it:** institution admins can enable it themselves in Settings > Permissions > Recording by choosing "Always-on recording", as long as your plan includes always-on cloud recording.
> - **`disableAlwaysOnRecording`:** you set this per Space with `PATCH /spaces/{spaceId}/settings`. It does not stop a recording that is already running. It takes effect from the next call.
> - **Reading the effective state:** there isn't a single endpoint for this today. The Space's `settings` object shows `disableAlwaysOnRecording`. A recording in progress isn't listed until it finishes; `RECORDING_AVAILABLE` is the signal that one was made.
>
> More info: https://helpdesk.pencilspaces.com/en/articles/12641384-how-to-enable-always-on-cloud-recording

**For us:** an opt-out reaches the next call. The only lesson at risk is one whose call is running now, whose recording must be deleted when it lands. The per-Space "up to 3 h" window and the pre-lesson `apply_space_settings` re-PATCH are dropped. The helpdesk's 3 h figure is about switching the institution mode on, not about this setting. We switch always-on on ourselves at the start of Phase 2.

## 7. Deleting a recording

> `DELETE /spaces/recordings/{spaceId}/{recordingId}` removes the recording for your users: it no longer appears in recording lists or playback, and the transcript endpoint stops returning it.
>
> I'm checking with our team on exactly what gets deleted alongside it (the transcript, summary, AI Coach and safeguarding items) and what we retain afterwards, and will get back to you on this one.

**For us:** pending. After a delete, `GET /transcriptions/{recordingId}` stops answering. So the transcript is copied into our DB before any retention delete, and a transcript job that finds the recording deleted ends as `no_recording` instead of retrying. Pencil-side retention stays a go-live prerequisite under (k).

## 8. Live nudges, idle and tab-switch alerts

> There are no live AI coaching prompts during a session; AI Coach is post-session only. One in-session feature does notify the host live:
> - **Distraction notifications:** an alert when a participant switches away from the Pencil tab. These are hidden in Spaces with 5 or more participants. They can be turned off in Settings > AI Assist > In Session.
>
> The distraction alerts themselves aren't exposed through the API or webhooks, but the underlying signals are:
> - **Tab switching:** `SPACE_USER` webhooks with eventType `USER_ENTERED_BACKGROUND` and `USER_ENTERED_FOREGROUND`
> - **Session analytics:** a per-user `spaceDurationInBackground` (visible to admins/hosts)

**For us:** decision (j) stands. The tab events are named `USER_ENTERED_BACKGROUND` / `USER_ENTERED_FOREGROUND`; the spec printed `hideTab` / `unhideTab`. In Redirect mode the Space is in its own tab and Materials is in ours, so a student opening Materials raises a distraction alert to the teacher and counts as background time. The owner decides whether to keep the alerts on (plan, open questions).

## 9. Second device (iPad)

> - **Call participants:** counted from who joins the call. A student who opens the Space on an iPad to write, without joining the call, is not counted as a second call participant.
> - **Attendance and billing:** counted per user, so the same student on two devices counts once.
> - **Recording:** a whiteboard-only device doesn't start or stop always-on recording.
>
> Tip: add `mode=whiteboardonly` to the iPad's Space URL to hide the call controls and join prompts on that device.

**For us:** the "Use this device for writing" link is `standalone=true&mode=whiteboardonly`. The "tap Not Now, keep the speaker off" rules are gone. Homework links use the same mode.

## 10. Boards API

> Not today. There's no public boards API, and no deep link to a specific board (a Space opens on the user's last-viewed board, otherwise the first). Boards can be exported as an image from inside the Space. This is already part of our roadmap.

**For us:** decision (i) stands as designed: `board_hint` naming, Done in our app, Space activity as a signal.

## 11. Generic admin account for the API key

> Yes. The API key belongs to an institution admin account, and a dedicated, generic admin account is a good choice.
>
> When you create Spaces with `POST /spaces/create`, pass `owner` (for example the tutor) along with `hosts` and `participants`. The API account then won't be added to the Space and won't appear in the Space UI. Our docs currently say the API user is always added as a host; that only applies when `owner` isn't set.
>
> Keep "Grant admins access to all Spaces" switched on (the default) so the API account can manage Spaces it isn't a member of. The key is tied to that account's login, so revoking or regenerating it signs the account out everywhere.

**For us:** we keep not passing `owner` (plan decision p). Our notes record a Space owner as permanent. A tutor-owner could not be removed when the student moves to another teacher, which decision (g) requires. A generic owner account would show in the Space just as the API account does now. With no `owner`, the API account is the owner and a host, which can never be removed, so every teacher stays an ordinary, removable host. "Grant admins access to all Spaces" stays on regardless. Whether an owner can be changed is a follow-up question.

## 12. Iframe embedding

> The Space page doesn't set a `frame-ancestors` policy or `X-Frame-Options`, so you can embed it from your domain with nothing to configure on our side. For a smooth experience:
> - Serve the parent page over HTTPS.
> - Include the iframe `allow` attributes from our iframe guide (camera, microphone, display-capture, fullscreen, clipboard, autoplay, picture-in-picture).
> - Sign users in with token login: create or authorize the user via `/user/createAPIUser` and `/user/authorize`, then load `...?loginMethod=token&loginType=api&token={token}`. Tokens are valid for one hour. Generate a fresh one for each page load, since browser storage partitioning can stop a login from carrying over into the iframe.
>
> Iframe integration guide: https://api.pencilspaces.com/guide/%EF%B8%8F-integrating-via-iframe

**For us:** this confirms decision (f) as built. `SpaceStage` mints a fresh URL on every mount, Retry and new-tab open, and never caches one. The paths are `/users/...` in the spec. Safari and Chrome with third-party cookies blocked still need the empirical test in Phase 1's done-when.

## Follow-up questions for Pencil

1. **`COACHING_AVAILABLE` payload:** what is its `_type`, and which ids does it carry (`sessionId`, `recordingId`, `spaceId`)?
2. **`SPACE_USER` eventType strings:** you name the tab events `USER_ENTERED_BACKGROUND` / `USER_ENTERED_FOREGROUND`, while the spec prints `hideTab` / `unhideTab`. Are join and leave `joinSpace` / `leaveSpace`, or upper-case forms? Could you send the full current list for every `_type`?
3. **Retries:** does a redelivery carry the same `timestamp` as the first attempt, and is there a delivery id we can deduplicate on?
4. **Owner:** if we pass `owner`, can it later be changed, or the owner removed with `updateUsers`, when a student moves to a different tutor?
5. **Call start without `skipCallHostCheck`:** with `startCall=true` alone, does a participant who arrives first join the call automatically once the host starts it, or see a join prompt?
6. **Reports `summary` block:** is it the same text as `GET /transcriptions/{recordingId}`'s `summary.description`? What does `snippets` contain?
7. **Deletion (your pending item):** what is removed with a recording, and what is retained, and for how long?
