import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureError } from "@/lib/observability";

// ============================================================================
// Admin follow-ups raised by server code (the Pencil join hard stop, the
// recording opt-out toggle). One helper so the dedupe rule lives in one place.
//
// The dedicated `parent_contact` / pipeline follow-up types arrive with
// migration 0018 (Phase 2); until then the existing 'report_flag' type is
// used with a clear, prefixed reason ("[Recording policy] …"), which
// /admin/followups recognises.
// ============================================================================

export interface AdminFollowupInput {
  studentId: string;
  sessionId?: string | null;
  reason: string;
  priority?: "low" | "normal" | "high";
}

/**
 * Raise an admin follow-up unless an open or snoozed one with the same student,
 * type and reason already exists. `admin` is the service-role client (the
 * caller has already authorized the action). Best effort: a failure is
 * reported to Sentry and swallowed — the action that raised it has already
 * done (or refused) its real work and must not turn into a 500 over this.
 */
export async function raiseAdminFollowup(
  admin: SupabaseClient,
  input: AdminFollowupInput,
  where = "raiseAdminFollowup",
): Promise<void> {
  try {
    const { data: existing, error: readError } = await admin
      .from("followups")
      .select("id")
      .eq("student_id", input.studentId)
      .eq("type", "report_flag")
      .eq("reason", input.reason)
      .in("status", ["open", "snoozed"])
      .limit(1)
      .maybeSingle();
    if (readError) throw readError;
    if (existing) return;
    const { error } = await admin.from("followups").insert({
      student_id: input.studentId,
      session_id: input.sessionId ?? null,
      type: "report_flag",
      // Explicit, not the column default: the dedupe query above filters on it.
      status: "open",
      priority: input.priority ?? "high",
      reason: input.reason,
    });
    if (error) throw error;
  } catch (err) {
    captureError(err, { where, student_id: input.studentId, session_id: input.sessionId ?? undefined });
  }
}
