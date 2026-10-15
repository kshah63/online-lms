"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import { getSessionById } from "@/lib/data/sessions";
import { logAudit } from "@/lib/audit";
import { captureError } from "@/lib/observability";
import { endOngoingSession, PencilError, pencilLive } from "@/lib/pencil/client";
import { canEndLesson } from "@/lib/pencil/authz";
import { getSpaceForPair, syncHosts } from "@/lib/pencil/provision";
import { lessonFallbackForced } from "@/lib/pencil/urls";
import type { ActionResult } from "@/lib/actions/types";
import type { Profile } from "@/lib/types";

/** Admin: schedule a one-off or recurring weekly session. */
export async function scheduleSession(formData: FormData): Promise<ActionResult> {
  const course_id = String(formData.get("course_id") ?? "");
  const student_id = String(formData.get("student_id") ?? "");
  const teacher_id = String(formData.get("teacher_id") ?? "") || null;
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const tz = String(formData.get("timezone") ?? "UTC");
  const duration = Number(formData.get("duration") ?? 60);
  const weeks = Math.max(1, Math.min(12, Number(formData.get("weeks") ?? 1)));
  const agenda = String(formData.get("agenda") ?? "") || null;

  if (!course_id || !student_id || !date || !time) {
    return { ok: false, message: "Course, student, date and time are required." };
  }

  const series_id = weeks > 1 ? randomUUID() : null;
  const rows = Array.from({ length: weeks }).map((_, i) => {
    const startLocal = DateTime.fromISO(`${date}T${time}`, { zone: tz }).plus({ weeks: i });
    const start = startLocal.toUTC().toISO()!;
    const end = startLocal.plus({ minutes: duration }).toUTC().toISO()!;
    return {
      course_id,
      student_id,
      teacher_id,
      scheduled_start: start,
      scheduled_end: end,
      agenda,
      status: teacher_id ? "confirmed" : "scheduled",
      series_id,
    };
  });

  if (isDemoMode) {
    revalidatePath("/admin");
    revalidatePath("/admin/sessions");
    return {
      ok: true,
      message: `Demo mode: ${weeks > 1 ? `${weeks} sessions` : "session"} not persisted. Connect Supabase to save.`,
    };
  }

  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.from("sessions").insert(rows);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin");
  revalidatePath("/admin/sessions");
  return { ok: true, message: weeks > 1 ? `Scheduled ${weeks} weekly sessions.` : "Session scheduled." };
}

/**
 * Start the real session clock when teacher + student are both in the room.
 * Idempotent — only sets actual_start the first time. Returns the start ISO so
 * the client timer counts from the same instant on every device.
 */
export async function startSessionClock(sessionId: string): Promise<{ actual_start: string }> {
  const now = new Date().toISOString();
  if (isDemoMode) return { actual_start: now };

  const supabase = createSupabaseServerClient()!;
  // Set only if not already started; mark the lesson in progress.
  const { data } = await supabase
    .from("sessions")
    .update({ actual_start: now, status: "in_progress" })
    .eq("id", sessionId)
    .is("actual_start", null)
    .select("actual_start")
    .maybeSingle();

  if (data?.actual_start) return { actual_start: data.actual_start };

  // Already started — return the existing value.
  const { data: existing } = await supabase
    .from("sessions")
    .select("actual_start")
    .eq("id", sessionId)
    .maybeSingle();
  return { actual_start: existing?.actual_start ?? now };
}

export type LessonOutcome = "completed" | "no_show";

export interface EndLessonResult extends ActionResult {
  outcome?: LessonOutcome;
  /** UTC ISO written to sessions.actual_end (for the client clock). */
  actual_end?: string;
}

/**
 * End the lesson (plan decision b). Caller must be the assigned teacher or an
 * admin. Writes `status=outcome, actual_end=now()` with `.neq('status',
 * 'completed')` and aborts when no row comes back, THEN — best-effort, one
 * attempt, 5 s — `POST /spaces/{id}/endOngoingSession` so one Pencil session ==
 * one lesson, recording the `endedSessionId` as a hint in pencil_sessions and
 * sessions.pencil_session_id. Audits lesson.end | lesson.no_show.
 *
 * `opts.usedFallback` (the room ran on the Zoom link) or LESSON_FALLBACK_MODE
 * marks `analysis_status='no_recording'` so the post-session pipeline doesn't wait.
 */
export async function endLesson(
  sessionId: string,
  outcome: LessonOutcome,
  opts: { usedFallback?: boolean } = {},
): Promise<EndLessonResult> {
  if (outcome !== "completed" && outcome !== "no_show") return { ok: false, message: "Invalid outcome." };

  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "You are not signed in." };

  const session = await getSessionById(sessionId);
  if (!session) return { ok: false, message: "Session not found." };
  if (!canEndLesson(profile, session)) {
    return { ok: false, message: "Only the assigned teacher or an admin can end this lesson." };
  }
  if (session.status === "cancelled") return { ok: false, message: "This lesson was cancelled." };

  const now = new Date().toISOString();
  const noRecording = Boolean(opts.usedFallback) || lessonFallbackForced();
  const message = outcome === "completed" ? "Lesson ended." : "Marked as no-show.";

  if (isDemoMode) {
    revalidateLesson(sessionId);
    return { ok: true, message, outcome, actual_end: now };
  }

  // Cookie client: RLS re-checks the teacher/admin right; the filter re-applies
  // the same rule so a stale page can never end someone else's lesson.
  const supabase = createSupabaseServerClient()!;
  let update = supabase
    .from("sessions")
    .update({ status: outcome, actual_end: now, ...(noRecording ? { analysis_status: "no_recording" } : {}) })
    .eq("id", sessionId)
    .neq("status", "completed");
  if (profile.role === "teacher") update = update.eq("teacher_id", profile.id);
  const { data: updated, error } = await update.select("id");
  if (error) return { ok: false, message: error.message };
  if (!updated || updated.length === 0) return { ok: false, message: "This lesson was already ended." };

  // Best-effort Pencil end — never blocks the outcome we just wrote.
  await endPencilSession(sessionId, session.student_id, session.course_id, now);

  await logAudit(profile, outcome === "completed" ? "lesson.end" : "lesson.no_show", { type: "session", id: sessionId }, {
    outcome,
    no_recording: noRecording,
  });
  revalidateLesson(sessionId);
  return { ok: true, message, outcome, actual_end: now };
}

/** Admin: assign (or reassign) a teacher to a session. Bound directly to a form. */
export async function assignTeacher(formData: FormData): Promise<void> {
  const session_id = String(formData.get("session_id") ?? "");
  const teacher_id = String(formData.get("teacher_id") ?? "");
  if (!session_id || !teacher_id) return;

  if (!isDemoMode) {
    // RLS already limits session updates to admins; the host sync below uses the
    // service role, so the role is checked explicitly here as well.
    const profile = await getCurrentProfile();
    if (!profile || profile.role !== "admin") return;

    const supabase = createSupabaseServerClient()!;
    const { data: current, error: readError } = await supabase
      .from("sessions")
      .select("id,status,student_id,course_id")
      .eq("id", session_id)
      .maybeSingle();
    if (readError || !current) return;
    if (current.status === "in_progress" || current.status === "completed") {
      // Plan (g): cancel and rebook instead; the pipeline derives taught_by from attendees.
      console.warn(`assignTeacher refused: session ${session_id} is ${current.status}`);
      return;
    }

    const { error } = await supabase
      .from("sessions")
      .update({ teacher_id, status: "confirmed" })
      .eq("id", session_id)
      .neq("status", "in_progress")
      .neq("status", "completed");
    if (error) {
      captureError(error, { where: "assignTeacher", session_id });
      return;
    }

    // Additive host sync, fire-and-forget: the join route also syncs lazily.
    void syncSpaceHostForAssignment(profile, current.student_id, current.course_id, teacher_id);
  }

  revalidatePath("/admin");
  revalidatePath("/admin/sessions");
}

/** Admin: cancel a session. */
export async function cancelSession(formData: FormData): Promise<ActionResult> {
  const session_id = String(formData.get("session_id") ?? "");
  const reason = String(formData.get("reason") ?? "") || null;
  if (!session_id) return { ok: false, message: "Missing session." };

  if (isDemoMode) {
    revalidatePath("/admin/sessions");
    return { ok: true, message: "Demo mode: cancellation not persisted." };
  }

  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase
    .from("sessions")
    .update({ status: "cancelled", cancel_reason: reason })
    .eq("id", session_id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin");
  revalidatePath("/admin/sessions");
  return { ok: true, message: "Session cancelled." };
}

// ---------------------------------------------------------------------------
// helpers (not exported — a "use server" module only exports actions)
// ---------------------------------------------------------------------------

function revalidateLesson(sessionId: string) {
  revalidatePath(`/lesson/${sessionId}`);
  revalidatePath("/teacher");
  revalidatePath("/home");
  revalidatePath("/admin");
  revalidatePath("/admin/sessions");
}

/**
 * `POST /spaces/{spaceId}/endOngoingSession` once (JOIN_FETCH: 5 s, no retry)
 * and record the ended Pencil session as a hint for the Phase 2 pipeline.
 * Any failure is logged and swallowed — the lesson is already ended in our DB.
 */
async function endPencilSession(sessionId: string, studentId: string, courseId: string, endedAt: string): Promise<void> {
  if (!pencilLive) return;
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  try {
    const space = await getSpaceForPair(admin, studentId, courseId);
    if (!space || space.status === "mock" || !space.pencil_space_id) return;

    const { endedSessionId } = await endOngoingSession(space.pencil_space_id);

    const { error: upsertError } = await admin.from("pencil_sessions").upsert(
      {
        pencil_session_id: endedSessionId,
        pencil_space_id: space.pencil_space_id,
        space_id: space.id,
        hint_session_id: sessionId,
        state: "ended",
        ended_at: endedAt,
      },
      { onConflict: "pencil_session_id" },
    );
    if (upsertError) throw upsertError;

    const { error: linkError } = await admin
      .from("sessions")
      .update({ pencil_session_id: endedSessionId })
      .eq("id", sessionId);
    if (linkError) throw linkError;
  } catch (err) {
    // A 4xx here usually means "no ongoing session" (no-show, or the call ended
    // >5 min ago) — expected, so keep it out of Sentry.
    if (err instanceof PencilError && err.status >= 400 && err.status < 500) {
      console.warn(`endOngoingSession for ${sessionId}: ${err.message}`);
      return;
    }
    captureError(err, { where: "endLesson endOngoingSession", session_id: sessionId });
  }
}

/**
 * After an assignment, make the new teacher a host of the (student, course)
 * Space — additive only (plan g). Skipped when the Space hasn't been
 * provisioned yet (ensureSpace adds the assigned teacher at first join).
 */
async function syncSpaceHostForAssignment(actor: Profile, studentId: string, courseId: string, teacherId: string): Promise<void> {
  try {
    if (!pencilLive) return;
    const admin = createSupabaseAdminClient();
    if (!admin) return;
    const space = await getSpaceForPair(admin, studentId, courseId);
    if (!space || space.status === "mock" || !space.pencil_space_id) return;
    await syncHosts(admin, space, [teacherId], { actor });
  } catch (err) {
    captureError(err, { where: "assignTeacher syncHosts", student_id: studentId, course_id: courseId, teacher_id: teacherId });
  }
}
