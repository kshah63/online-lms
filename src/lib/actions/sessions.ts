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
import { pencilLive } from "@/lib/pencil/client";
import { canEndLesson } from "@/lib/pencil/authz";
import { getSpaceForPair, removeHosts, syncHosts } from "@/lib/pencil/provision";
import { lessonFallbackForced } from "@/lib/pencil/urls";
import type { ActionResult } from "@/lib/actions/types";
import type { Profile, SessionStatus } from "@/lib/types";

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
export async function startSessionClock(sessionId: string): Promise<{ actual_start: string | null }> {
  const now = new Date().toISOString();
  if (isDemoMode) return { actual_start: now };

  const supabase = createSupabaseServerClient()!;
  // Set only if not already started and still live: a room that has not yet
  // seen the End (other rooms learn it by polling) must not turn a no-show or
  // a completed lesson back into one in progress.
  const { data } = await supabase
    .from("sessions")
    .update({ actual_start: now, status: "in_progress" })
    .eq("id", sessionId)
    .is("actual_start", null)
    .in("status", LIVE_STATUSES)
    .select("actual_start")
    .maybeSingle();

  if (data?.actual_start) return { actual_start: data.actual_start };

  // Already started — return the existing value. Never started and no longer
  // live (ended in another room) → null, so the client starts no clock.
  const { data: existing } = await supabase
    .from("sessions")
    .select("actual_start, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (existing?.actual_start) return { actual_start: existing.actual_start };
  if (existing && !LIVE_STATUSES.includes(existing.status as SessionStatus)) return { actual_start: null };
  return { actual_start: now };
}

export type LessonOutcome = "completed" | "no_show";

export interface EndLessonResult extends ActionResult {
  outcome?: LessonOutcome;
  /** UTC ISO written to sessions.actual_end (for the client clock). */
  actual_end?: string;
}

/** Statuses a lesson can still be ended from (anything else is over or cancelled). */
const LIVE_STATUSES: SessionStatus[] = ["scheduled", "confirmed", "in_progress"];

/**
 * End the lesson (plan decision b). Caller must be the assigned teacher or an
 * admin. Writes `status=outcome, actual_end=now()` only while the lesson is
 * still live (`status in scheduled|confirmed|in_progress` — a no-show or a
 * completed lesson can never be ended twice, re-audited or flipped into a
 * credit-consuming 'completed') and aborts when no row comes back. Audits
 * lesson.end | lesson.no_show.
 *
 * Pencil is not called. `POST /spaces/{id}/endOngoingSession` ends only the
 * analytics session — not the call, not the recording — and opens a new one
 * at once for anyone still in the Space (Pencil support, 2026-10-16). What
 * ends the call is everyone leaving: this room unmounts its Space now, every
 * other open room sees the new status through /api/lesson/[id]/status and
 * unmounts too, and Pencil closes the session
 * six minutes after the last participant leaves or becomes inactive. A Space
 * tab whose lesson page is gone stays in the call until it is closed. The
 * Phase 2 pipeline correlates that session from webhooks and the time window
 * (plan decision b), not from a hint written here.
 *
 * `opts.usedFallback` (the room ran on the Zoom link) or LESSON_FALLBACK_MODE
 * marks `analysis_status='no_recording'` so the post-session pipeline doesn't
 * wait (decision n: End in fallback writes status and actual_end only).
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
  if (!LIVE_STATUSES.includes(session.status)) return { ok: false, message: "This lesson was already ended." };

  const now = new Date().toISOString();
  const noRecording = Boolean(opts.usedFallback) || lessonFallbackForced();
  const message = outcome === "completed" ? "Lesson ended." : "Marked as no-show.";

  if (isDemoMode) {
    revalidateLesson(sessionId);
    return { ok: true, message, outcome, actual_end: now };
  }

  // Cookie client: RLS re-checks the teacher/admin right; the filter re-applies
  // the same rule so a stale page can never end someone else's lesson.
  // analysis_status: only 'none' → 'no_recording' (the DB guard allows a
  // teacher exactly that transition; anything else belongs to the pipeline).
  const markNoRecording = noRecording && session.analysis_status === "none";
  const supabase = createSupabaseServerClient()!;
  let update = supabase
    .from("sessions")
    .update({ status: outcome, actual_end: now, ...(markNoRecording ? { analysis_status: "no_recording" } : {}) })
    .eq("id", sessionId)
    .in("status", LIVE_STATUSES);
  if (profile.role === "teacher") update = update.eq("teacher_id", profile.id);
  const { data: updated, error } = await update.select("id");
  if (error) return { ok: false, message: error.message };
  if (!updated || updated.length === 0) return { ok: false, message: "This lesson was already ended." };

  await logAudit(profile, outcome === "completed" ? "lesson.end" : "lesson.no_show", { type: "session", id: sessionId }, {
    outcome,
    no_recording: noRecording,
  });
  revalidateLesson(sessionId);
  return { ok: true, message, outcome, actual_end: now };
}

/** Statuses a teacher can still be (re)assigned in. */
const ASSIGNABLE_STATUSES: SessionStatus[] = ["scheduled", "confirmed"];

/**
 * Admin: assign (or reassign) a teacher to a session (plan decision g).
 * Refused once the lesson has started or is over (cancel and rebook instead:
 * the pipeline derives who taught from Pencil's attendees). After the update
 * the (student, course) Space seats follow the assignment: the new teacher is
 * added as a host, and the previous teacher is REMOVED only when they have no
 * other non-cancelled lesson (completed ones count) and no open homework for
 * that pair — a teacher who never taught the pair cannot keep opening the
 * child's Space from Pencil's own UI; one who has taught it keeps the seat. The
 * Pencil part never fails the action; a problem comes back as a warning.
 */
export interface AssignTeacherResult extends ActionResult {
  /** The assignment was saved but Pencil's hosts could not be updated. */
  warning?: string;
}

export async function assignTeacher(formData: FormData): Promise<AssignTeacherResult> {
  const session_id = String(formData.get("session_id") ?? "");
  const teacher_id = String(formData.get("teacher_id") ?? "");
  if (!session_id || !teacher_id) return { ok: false, message: "Pick a teacher." };

  if (isDemoMode) {
    revalidatePath("/admin");
    revalidatePath("/admin/sessions");
    return { ok: true, message: "Demo mode: assignment not persisted." };
  }

  // RLS already limits session updates to admins; the host sync below uses the
  // service role, so the role is checked explicitly here as well.
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, message: "Only an admin can assign teachers." };

  const supabase = createSupabaseServerClient()!;
  const { data: current, error: readError } = await supabase
    .from("sessions")
    .select("id,status,student_id,course_id,teacher_id")
    .eq("id", session_id)
    .maybeSingle();
  if (readError) return { ok: false, message: readError.message };
  if (!current) return { ok: false, message: "Session not found." };
  if (!ASSIGNABLE_STATUSES.includes(current.status as SessionStatus)) {
    return {
      ok: false,
      message:
        current.status === "in_progress" || current.status === "completed"
          ? "This lesson has already started — cancel and rebook it instead of reassigning."
          : "This lesson is over; it can't be reassigned.",
    };
  }
  const previousTeacherId = (current.teacher_id as string | null) ?? null;
  if (previousTeacherId === teacher_id) return { ok: true, message: "Already assigned." };

  const { data: teacher } = await supabase.from("profiles").select("id,role").eq("id", teacher_id).maybeSingle();
  if (!teacher || (teacher.role !== "teacher" && teacher.role !== "admin")) {
    return { ok: false, message: "That profile is not a teacher." };
  }

  const { data: updated, error } = await supabase
    .from("sessions")
    .update({ teacher_id, status: "confirmed" })
    .eq("id", session_id)
    .in("status", ASSIGNABLE_STATUSES)
    .select("id");
  if (error) {
    captureError(error, { where: "assignTeacher", session_id });
    return { ok: false, message: error.message };
  }
  if (!updated || updated.length === 0) return { ok: false, message: "The lesson changed meanwhile — reload and try again." };

  await logAudit(profile, "session.assign_teacher", { type: "session", id: session_id }, {
    from: previousTeacherId,
    to: teacher_id,
  });

  const warning = await syncSpaceHostsForAssignment(profile, {
    studentId: current.student_id as string,
    courseId: current.course_id as string,
    teacherId: teacher_id,
    previousTeacherId,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/sessions");
  return { ok: true, message: previousTeacherId ? "Teacher reassigned." : "Teacher assigned.", ...(warning ? { warning } : {}) };
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
 * After an assignment: make the new teacher a host of the (student, course)
 * Space (additive, plan g) and take the previous teacher's seat away when they
 * have nothing left with this pair. Skipped when the Space hasn't been
 * provisioned yet (ensureSpace seats the assigned teacher at first join).
 * Never throws; returns a warning for the admin when Pencil could not be updated.
 */
async function syncSpaceHostsForAssignment(
  actor: Profile,
  pair: { studentId: string; courseId: string; teacherId: string; previousTeacherId: string | null },
): Promise<string | null> {
  const { studentId, courseId, teacherId, previousTeacherId } = pair;
  try {
    if (!pencilLive) return null;
    const admin = createSupabaseAdminClient();
    if (!admin) return null;
    let space = await getSpaceForPair(admin, studentId, courseId);
    if (!space || space.status === "mock" || !space.pencil_space_id) return null;

    space = await syncHosts(admin, space, [teacherId], { actor });
    if (
      previousTeacherId &&
      previousTeacherId !== teacherId &&
      space.host_profile_ids.includes(previousTeacherId) &&
      (await mayLoseSeat(admin, previousTeacherId, studentId, courseId))
    ) {
      await removeHosts(admin, space, [previousTeacherId], { actor });
    }
    return null;
  } catch (err) {
    captureError(err, { where: "assignTeacher host sync", student_id: studentId, course_id: courseId, teacher_id: teacherId });
    return "Saved, but the classroom's hosts could not be updated in Pencil. The new teacher is added when they open the lesson; check the previous teacher's access in Pencil.";
  }
}

/**
 * May `profileId` lose their host seat in the (student, course) Space? Only a
 * teacher with no remaining non-cancelled lesson and no open (assigned /
 * submitted) homework from their lessons for that pair. Admins keep theirs.
 * Query errors throw, so the seat is KEPT and the admin is warned.
 */
async function mayLoseSeat(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  profileId: string,
  studentId: string,
  courseId: string,
): Promise<boolean> {
  const { data: person, error: personError } = await admin.from("profiles").select("id,role").eq("id", profileId).maybeSingle();
  if (personError) throw personError;
  if (person && person.role === "admin") return false;

  const { data: theirs, error: sessionsError } = await admin
    .from("sessions")
    .select("id,status")
    .eq("teacher_id", profileId)
    .eq("student_id", studentId)
    .eq("course_id", courseId);
  if (sessionsError) throw sessionsError;
  const rows = (theirs ?? []) as { id: string; status: SessionStatus }[];
  if (rows.some((r) => r.status !== "cancelled")) return false;
  if (rows.length === 0) return true;

  const { count, error: homeworkError } = await admin
    .from("homework")
    .select("id", { count: "exact", head: true })
    .in(
      "session_id",
      rows.map((r) => r.id),
    )
    .in("status", ["assigned", "submitted"]);
  if (homeworkError) throw homeworkError;
  return (count ?? 0) === 0;
}
