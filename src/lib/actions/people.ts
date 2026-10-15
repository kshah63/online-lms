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
// ============================================================================

export interface RecordingOptOutResult {
  ok: boolean;
  message: string;
  /** The flag as it stands after the call. */
  optedOut: boolean;
  /** Non-blocking caveats the admin must act on (also raised as follow-ups). */
  warnings: string[];
}

/** Pencil propagates settings to Spaces with recent calls in up to 3 h (helpdesk). */
const PROPAGATION_WINDOW_HOURS = 3;

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
 * follow-up when a Space could not be confirmed or a lesson starts within the
 * propagation window, and audit 'student.recording_opt_out'.
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

  // 3. Lessons inside the propagation window.
  const now = DateTime.utc();
  const { data: soonRows } = await admin
    .from("sessions")
    .select("id, scheduled_start, course:courses(name)")
    .eq("student_id", studentId)
    .in("status", ["scheduled", "confirmed", "in_progress"])
    .gte("scheduled_end", now.toISO())
    .lte("scheduled_start", now.plus({ hours: PROPAGATION_WINDOW_HOURS }).toISO())
    .order("scheduled_start")
    .limit(5);
  const soon = ((soonRows ?? []) as unknown as UpcomingLesson[]);

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

  if (optOut && soon.length > 0) {
    const next = soon[0]!;
    const course = next.course?.name ?? "a lesson";
    warnings.push(
      `${firstName} has ${course} starting ${DateTime.fromISO(next.scheduled_start, { zone: "utc" }).toRelative()} — Pencil can take up to ${PROPAGATION_WINDOW_HOURS} h to apply the change to a Space with recent calls. Check the Space before the lesson or tell the teacher not to record.`,
    );
    await raiseAdminFollowup(admin, {
      studentId,
      sessionId: next.id,
      reason: `${FOLLOWUP_PREFIX} ${firstName} was opted out of recording with ${course} inside the ${PROPAGATION_WINDOW_HOURS} h propagation window. Verify the lesson is not recorded (Space setting / recording chip) and delete any recording that was made.`,
    });
  }

  await logAudit(actor, "student.recording_opt_out", { type: "profile", id: studentId }, {
    opt_out: optOut,
    spaces: spaces.length,
    confirmed: confirmed.length,
    unconfirmed: unconfirmed.length,
    lessons_within_window: soon.length,
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
