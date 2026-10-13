"use server";

import { revalidatePath } from "next/cache";
import { isDemoMode } from "@/lib/env";

// ============================================================================
// Follow-up writes, behind the data layer. online-lms's followups table is
// retired; a lesson's follow-ups are mv-app's lesson_followups, decided by the
// in-charge through approve_followup / dismiss_followup (which raise
// message_tasks and student_notes in the app). TODO(next stage): call those
// RPCs here, or drop this page for the app's queue. Until then the live paths
// refuse loudly rather than pretend.
// ============================================================================

function notPortedYet(): never {
  throw new Error("Follow-ups are approved in the MathVision app until the next integration stage.");
}

/** TODO(next stage): rpc approve_followup(p_followup_id). */
export async function resolveFollowup(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!isDemoMode && id) notPortedYet();
  revalidatePath("/admin/followups");
}

/** TODO(next stage): rpc dismiss_followup(p_followup_id). */
export async function snoozeFollowup(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!isDemoMode && id) notPortedYet();
  revalidatePath("/admin/followups");
}

/** Follow-ups are proposed from the lesson transcript by lesson-finalize; there is nothing to scan for here any more. */
export async function generateFollowups(): Promise<void> {
  if (!isDemoMode) notPortedYet();
  revalidatePath("/admin/followups");
}
