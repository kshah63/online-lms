import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentProfile } from "@/lib/data/auth";
import { getSessionById } from "@/lib/data/sessions";
import { getChildren } from "@/lib/data/people";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";
import { logAudit } from "@/lib/audit";
import { captureError } from "@/lib/observability";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { PencilError, pencilLive } from "@/lib/pencil/client";
import { canEnterSpace, canJoinLesson } from "@/lib/pencil/authz";
import {
  applyRecordingPolicy,
  ensurePencilUser,
  ensureSpace,
  getPencilUser,
  isRecordingOptedOut,
  recordingPolicyBlocksJoin,
  syncHosts,
} from "@/lib/pencil/provision";
import { isHttpsUrl, isZoomUrl, lessonFallbackForced, mintJoinUrl } from "@/lib/pencil/urls";
import { mockSpaceJoin } from "@/lib/pencil/mock";
import type { JoinMode, JoinPurpose } from "@/lib/pencil/types";
import type { SpaceJoinResponse } from "@/components/lesson/space-stage";
import type { Session, SessionView } from "@/lib/types";

/**
 * POST /api/lesson/[sessionId]/space — mint a Pencil join URL for the viewer.
 *
 * Body: `{ purpose?: 'lesson' | 'board', mode?: 'iframe' | 'redirect' }`.
 *  - purpose 'lesson' = the call (startCall, embed events); 'board' = a second
 *    device used only for writing (standalone, no call).
 *  - mode is what the client will do with the URL (iframe.src or a new tab);
 *    it is echoed back and audited, nothing more.
 *
 * Re-applies the lesson access rule (canJoinLesson — the same rule as the
 * page), then `canEnterSpace`: parents get the status card and never a Pencil
 * user. Provisioning (user / Space / hosts / recording policy) only runs when
 * rows are missing or stale; a warm join is exactly one Pencil call
 * (`authorize`, 5 s, no retry). The returned `url` is a credential valid for
 * 3600 s: it is returned as JSON only — never rendered, logged or persisted.
 */
export async function POST(req: Request, { params }: { params: { sessionId: string } }) {
  const profile = await getCurrentProfile();
  if (!profile) return json({ error: "Unauthorized" }, 401);

  const session = await getSessionById(params.sessionId);
  if (!session) return json({ error: "Not found" }, 404);

  const childIds = (await getChildren(profile)).map((c) => c.id);
  if (!canJoinLesson(profile, session, childIds)) return json({ error: "Forbidden" }, 403);
  if (!canEnterSpace(profile, session, childIds)) {
    return json({ error: "Parents follow the lesson from the status card and have no seat in the room." }, 403);
  }

  const fallbackUrl = fallbackUrlFor(session);
  if (session.status === "completed" || session.status === "cancelled" || session.status === "no_show") {
    return json({ configured: false, reason: "ended", fallbackUrl, error: "This lesson is over." }, 409);
  }

  const body = await parseBody(req);
  const purpose: JoinPurpose = body.purpose === "board" ? "board" : "lesson";
  const mode: JoinMode = body.mode === "redirect" ? "redirect" : "iframe";

  // Outage switch: every lesson runs on the master Zoom link; End still works.
  if (lessonFallbackForced()) {
    return json({ configured: false, reason: "forced", fallback: true, fallbackUrl });
  }

  // No key, or demo mode: the sample room. No credential is minted, so the
  // client may call this freely; `studentPencilUserId` feeds "Simulate student joins".
  if (!pencilLive) {
    const admin = createSupabaseAdminClient();
    let optedOut: boolean | undefined;
    if (!isDemoMode && admin) {
      // Supabase is on but Pencil isn't — the opt-out flag is still ours to show.
      optedOut = await isRecordingOptedOut(admin, session.student_id).catch(() => undefined);
    }
    const mock = mockSpaceJoin({
      studentId: session.student_id,
      courseId: session.course_id,
      teacherId: session.teacher_id,
      courseName: session.course.name,
      studentName: session.student.display_name,
      optedOut,
      reason: isDemoMode ? "demo" : "unconfigured",
      fallbackJoinUrl: fallbackUrl,
    });
    return json({ ...mock, fallbackUrl });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    captureError(new Error("SUPABASE_SERVICE_ROLE_KEY is missing — Pencil routes need the service role"), {
      where: "lesson space route",
    });
    return json({ configured: false, reason: "service_role_missing", fallbackUrl }, 503);
  }

  const allowed = await rateLimit(`pencil:join:${profile.id}`, LIMITS.pencilJoin.limit, LIMITS.pencilJoin.windowSeconds);
  if (!allowed) {
    return json(
      { configured: false, reason: "rate_limited", fallbackUrl, error: "Too many join attempts — wait a few minutes and try again." },
      429,
    );
  }

  try {
    const optedOut = await isRecordingOptedOut(admin, session.student_id);

    // Cold pair: up to ~5 sequential Pencil calls (users, GET spaces, create). Warm: 0.
    let space = await ensureSpace(admin, {
      studentId: session.student_id,
      courseId: session.course_id,
      teacherId: session.teacher_id,
      actor: profile,
    });

    // Stale hosts (reassignment landed before the Space existed, or sync was skipped).
    if (session.teacher_id && !space.host_profile_ids.includes(session.teacher_id)) {
      space = await syncHosts(admin, space, [session.teacher_id], { actor: profile });
    }

    // Opt-out not yet confirmed on the Space: PATCH + read-back now, before anyone enters.
    if (optedOut && !space.recording_disabled) {
      ({ space } = await applyRecordingPolicy(admin, space, true, { actor: profile }));
    }
    if (recordingPolicyBlocksJoin(optedOut, space)) {
      await raiseRecordingPolicyFollowup(admin, session);
      await logAudit(profile, "pencil.join.blocked", { type: "session", id: session.id }, {
        spaceId: space.pencil_space_id,
        reason: "recording_policy",
      });
      return json({ configured: false, blocked: "recording_policy", reason: "recording_policy", fallbackUrl: null }, 409);
    }

    const viewer = await ensurePencilUser(admin, profile, { actor: profile });
    const studentUser = await getPencilUser(admin, session.student_id);
    const minted = await mintJoinUrl(viewer.pencil_user_id, space, purpose);

    if (session.space_id !== space.id) {
      const { error } = await admin.from("sessions").update({ space_id: space.id }).eq("id", session.id);
      if (error) captureError(error, { where: "lesson space route: sessions.space_id", session_id: session.id });
    }

    // Never the url.
    await logAudit(profile, "pencil.join", { type: "session", id: session.id }, {
      spaceId: space.pencil_space_id,
      purpose,
      mode,
    });

    return json({
      configured: true,
      url: minted.url,
      mode,
      purpose,
      expiresInSeconds: minted.expiresInSeconds,
      spaceId: space.pencil_space_id,
      studentPencilUserId: studentUser?.pencil_user_id ?? null,
      recordingOn: !optedOut,
      optedOut,
      fallbackUrl,
    });
  } catch (err) {
    if (err instanceof PencilError) {
      // Message carries status + Pencil's code only (never the url or the key).
      captureError(err, { where: "lesson space route", session_id: session.id, status: err.status, code: err.error_code });
      return json({ configured: false, reason: "pencil_error", transient: err.transient, fallbackUrl }, 502);
    }
    captureError(err, { where: "lesson space route", session_id: session.id });
    return json({ configured: false, reason: "error", transient: true, fallbackUrl }, 500);
  }
}

// ---------------------------------------------------------------------------

function json(body: SpaceJoinResponse, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function parseBody(req: Request): Promise<{ purpose?: unknown; mode?: unknown }> {
  try {
    const parsed: unknown = await req.json();
    return parsed && typeof parsed === "object" ? (parsed as { purpose?: unknown; mode?: unknown }) : {};
  } catch {
    return {};
  }
}

/**
 * Where to send people when Pencil can't be used (owner decision): the admin's
 * per-lesson override, else ONE master Zoom link for the whole school
 * (`LESSON_FALLBACK_URL`, https + a zoom.us host), else null — the UI then
 * shows "No backup link — contact admin". There is no per-teacher link.
 */
function fallbackUrlFor(session: Pick<Session, "fallback_join_url">): string | null {
  if (isHttpsUrl(session.fallback_join_url)) return session.fallback_join_url;
  const master = (process.env.LESSON_FALLBACK_URL ?? "").trim();
  return isZoomUrl(master) ? master : null;
}

/**
 * Admin follow-up for the recording-policy hard stop. Uses the existing
 * `report_flag` type with a prefixed reason (dedicated types arrive with 0018)
 * and never duplicates an open/snoozed item. Best-effort: the join is already
 * refused; a follow-up failure must not turn into a 500.
 */
async function raiseRecordingPolicyFollowup(admin: SupabaseClient, session: SessionView): Promise<void> {
  const reason = "Recording policy not applied: opted-out student could not join — re-apply the opt-out on their Space";
  try {
    const { data: existing } = await admin
      .from("followups")
      .select("id")
      .eq("student_id", session.student_id)
      .eq("type", "report_flag")
      .eq("reason", reason)
      .in("status", ["open", "snoozed"])
      .limit(1)
      .maybeSingle();
    if (existing) return;
    const { error } = await admin.from("followups").insert({
      student_id: session.student_id,
      session_id: session.id,
      type: "report_flag",
      priority: "high",
      reason,
    });
    if (error) throw error;
  } catch (err) {
    captureError(err, { where: "lesson space route: recording policy follow-up", session_id: session.id });
  }
}
