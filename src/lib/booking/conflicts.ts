import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// Double-booking prevention. The server actions check here first (friendly
// error), and migration 0014's exclusion constraint guarantees it in Postgres
// even if two bookings race — catch code 23P01 as the backstop.
// ============================================================================

/** Statuses that occupy the student's calendar. */
export const ACTIVE_STATUSES = ["scheduled", "confirmed", "in_progress"] as const;

/** Half-open interval overlap: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅.
 * Back-to-back lessons (one ends exactly when the next starts) do NOT clash. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd; // ISO-8601 UTC strings compare lexically
}

export interface ConflictSession {
  id: string;
  scheduled_start: string;
  scheduled_end: string;
}

/** The student's first active session overlapping [startISO, endISO), if any. */
export async function findStudentConflict(
  client: SupabaseClient,
  studentId: string,
  startISO: string,
  endISO: string,
  excludeSessionId?: string,
): Promise<ConflictSession | null> {
  let query = client
    .from("sessions")
    .select("id, scheduled_start, scheduled_end")
    .eq("student_id", studentId)
    .in("status", [...ACTIVE_STATUSES])
    .lt("scheduled_start", endISO)
    .gt("scheduled_end", startISO)
    .limit(1);
  if (excludeSessionId) query = query.neq("id", excludeSessionId);

  const { data } = await query;
  return (data?.[0] as ConflictSession) ?? null;
}

/** True when a Postgres error is the 0014 exclusion-constraint violation. */
export function isOverlapViolation(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "23P01" || (error?.message ?? "").includes("sessions_no_student_overlap");
}

export const CONFLICT_MESSAGE =
  "That student already has a lesson booked in this time slot — pick a different time.";
