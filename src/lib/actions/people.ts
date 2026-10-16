"use server";

import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";
import { requireRole } from "@/lib/data/auth";
import { logAudit } from "@/lib/audit";
import { captureError } from "@/lib/observability";
import { raiseAdminFollowup } from "@/lib/followups";
import { PencilError } from "@/lib/pencil/client";
import { applyRecordingPolicy } from "@/lib/pencil/provision";
import type { PencilSpace } from "@/lib/types";

// ============================================================================
// Recording policy is OPT-OUT (plan decision d). The flag is ours
// (`recording_opt_outs`, presence = "do not record"); Pencil is told via
// `PATCH /spaces/{id}/settings/ {disableAlwaysOnRecording}` on every Space of
// the student, each confirmed by a `GET /spaces/{id}` read-back. In Phase 1
// this only flips the Space setting + our flag — institution always-on
// recording is switched on at the start of Phase 2 — but the join hard stop
// (`recordingPolicyBlocksJoin`) already applies, so an unconfirmed Space blocks
// the student's next join until a later join re-applies and confirms.
//
// Timing (Pencil support, 2026-10-16): the Space setting takes effect from the
// NEXT call and does not stop a recording that is already running. So the
// lesson at risk is one whose call may be running right now: about to start,
// on, overrunning, or just ended (End does not hang up Pencil's call, so a
// Space tab can still be in it).
// ============================================================================

export interface RecordingOptOutResult {
  ok: boolean;
  message: string;
  /** The flag as it stands after the call. */
  optedOut: boolean;
  /** Non-blocking caveats the admin must act on (also raised as follow-ups). */
  warnings: string[];
}

/**
 * A lesson's call may be running now when its slot is within these bounds
 * (teachers open the room early, and lessons overrun), when it is still in
 * progress however late, or when it ended this recently.
 */
const CALL_MAY_BE_RUNNING = { leadMinutes: 15, overrunMinutes: 30, endedMinutes: 30 };

/** Reasons carry this prefix so the same follow-up is never raised twice while open. */
const FOLLOWUP_PREFIX = "[Recording policy]";

interface UpcomingLesson {
  id: string;
  scheduled_start: string;
  course: { name: string } | null;
}

/**
 * Admin only. Set or clear a student's recording opt-out, push the policy to
 * every Space the student has (read-back confirmed), warn + raise an admin
 * follow-up when a Space could not be confirmed or a lesson's call may be
 * running now (it keeps recording until it ends), and audit
 * 'student.recording_opt_out'.
 */
export async function setRecordingOptOut(
  studentId: string,
  optOut: boolean,
  note?: string | null,
): Promise<RecordingOptOutResult> {
  const actor = await requireRole("admin");
  const fail = (message: string): RecordingOptOutResult => ({ ok: false, message, optedOut: !optOut, warnings: [] });

  if (!studentId) return fail("Missing student.");

  if (isDemoMode) {
    return {
      ok: true,
      message: optOut
        ? "Demo mode — opt-out not persisted. Lessons would no longer be recorded."
        : "Demo mode — not persisted. Lessons would be recorded again.",
      optedOut: optOut,
      warnings: [],
    };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return fail("Recording policy needs SUPABASE_SERVICE_ROLE_KEY configured.");

  // The service role bypasses RLS: re-check the target is really a student.
  const { data: student, error: studentError } = await admin
    .from("profiles")
    .select("id, role, display_name")
    .eq("id", studentId)
    .maybeSingle();
  if (studentError) return fail(studentError.message);
  if (!student || student.role !== "student") return fail("That profile is not a student.");
  const firstName = String(student.display_name ?? "").trim().split(/\s+/)[0] || "the student";

  // 1. Our flag — independent of Pencil, written only here.
  if (optOut) {
    const { error } = await admin
      .from("recording_opt_outs")
      .upsert(
        { student_id: studentId, set_by: actor.id, set_at: new Date().toISOString(), note: note?.trim() || null },
        { onConflict: "student_id" },
      );
    if (error) return fail(error.message);
  } else {
    const { error } = await admin.from("recording_opt_outs").delete().eq("student_id", studentId);
    if (error) return fail(error.message);
  }

  const warnings: string[] = [];

  // 2. Push the policy to every Space of the student, confirmed by read-back.
  //    A mock Space (no key / seed row) confirms immediately without network.
  const { data: spaceRows, error: spacesError } = await admin
    .from("pencil_spaces")
    .select("*")
    .eq("student_id", studentId);
  if (spacesError) {
    captureError(spacesError, { where: "setRecordingOptOut load spaces", student_id: studentId });
    warnings.push("Could not load the student's Spaces — the policy will be re-applied on their next join.");
  }
  const spaces = (spaceRows ?? []) as PencilSpace[];
  const confirmed: string[] = [];
  const unconfirmed: string[] = [];
  for (const space of spaces) {
    try {
      const res = await applyRecordingPolicy(admin, space, optOut, { actor });
      (res.confirmed ? confirmed : unconfirmed).push(space.id);
    } catch (err) {
      unconfirmed.push(space.id);
      captureError(err, {
        where: "setRecordingOptOut applyRecordingPolicy",
        space_id: space.id,
        transient: err instanceof PencilError ? err.transient : undefined,
      });
    }
  }

  // 3. A lesson whose call may be running now: the setting reaches only the next call.
  const now = DateTime.utc();
  const select = "id, scheduled_start, course:courses(name)";
  const [inSlot, running, justEnded] = await Promise.all([
    admin
      .from("sessions")
      .select(select)
      .eq("student_id", studentId)
      .in("status", ["scheduled", "confirmed", "in_progress"])
      .gte("scheduled_end", now.minus({ minutes: CALL_MAY_BE_RUNNING.overrunMinutes }).toISO())
      .lte("scheduled_start", now.plus({ minutes: CALL_MAY_BE_RUNNING.leadMinutes }).toISO())
      .limit(5),
    admin.from("sessions").select(select).eq("student_id", studentId).eq("status", "in_progress").limit(5),
    admin
      .from("sessions")
      .select(select)
      .eq("student_id", studentId)
      .in("status", ["completed", "no_show"])
      .gte("actual_end", now.minus({ minutes: CALL_MAY_BE_RUNNING.endedMinutes }).toISO())
      .limit(5),
  ]);
  const byId = new Map<string, UpcomingLesson>();
  for (const rows of [inSlot.data, running.data, justEnded.data]) {
    for (const row of (rows ?? []) as unknown as UpcomingLesson[]) byId.set(row.id, row);
  }
  const live = Array.from(byId.values()).sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));

  if (unconfirmed.length > 0) {
    const what = optOut ? "'do not record'" : "'record again'";
    warnings.push(
      optOut
        ? `Pencil did not confirm ${what} on ${unconfirmed.length} of ${spaces.length} Space(s). ${firstName} cannot join those Spaces until the setting is confirmed (it is re-applied on the next join attempt).`
        : `Pencil did not confirm ${what} on ${unconfirmed.length} of ${spaces.length} Space(s) — recordings may still be off there.`,
    );
    await raiseAdminFollowup(admin, {
      studentId,
      reason: `${FOLLOWUP_PREFIX} ${optOut ? "Opt-out" : "Recording resume"} for ${firstName} was NOT confirmed by Pencil on ${unconfirmed.length} Space(s). Open the Space settings in Pencil and verify "Disable always-on recording" is ${optOut ? "ON" : "OFF"}${optOut ? "; joins are blocked until confirmed" : ""}.`,
    });
  }

  if (optOut && live.length > 0) {
    const current = live[0]!;
    const course = current.course?.name ?? "a lesson";
    warnings.push(
      `${firstName} may be in a call for ${course} now (scheduled ${DateTime.fromISO(current.scheduled_start, { zone: "utc" }).toRelative()}). The change applies from the next call: if that call is being recorded, it keeps recording until it ends. Ask the teacher to end the call in the Space and start a new one; the recording is deleted when Pencil delivers it.`,
    );
    await raiseAdminFollowup(admin, {
      studentId,
      sessionId: current.id,
      reason: `${FOLLOWUP_PREFIX} ${firstName} was opted out of recording while ${course} may have been in a call. Pencil applies the setting from the next call only, so if that call was being recorded it kept recording until the teacher ended it. Check any such recording is deleted when Pencil delivers it, and tell the family.`,
    });
  }

  await logAudit(actor, "student.recording_opt_out", { type: "profile", id: studentId }, {
    opt_out: optOut,
    spaces: spaces.length,
    confirmed: confirmed.length,
    unconfirmed: unconfirmed.length,
    lessons_in_progress: live.length,
  });

  revalidatePath("/admin/people");
  revalidatePath("/admin/followups");

  return {
    ok: true,
    message: optOut
      ? `${firstName}'s lessons will no longer be recorded${spaces.length ? ` (${confirmed.length}/${spaces.length} Space(s) confirmed)` : ""}.`
      : `${firstName}'s lessons will be recorded again${spaces.length ? ` (${confirmed.length}/${spaces.length} Space(s) confirmed)` : ""}.`,
    optedOut: optOut,
    warnings,
  };
}
