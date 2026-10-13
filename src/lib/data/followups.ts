import { DateTime } from "luxon";
import { isDemoMode } from "@/lib/env";
import { demoProfiles } from "@/lib/demo/data";
import { displayName, type FollowupView } from "@/lib/types";

// ============================================================================
// Follow-ups, behind the data layer. online-lms's followups table is retired:
// the lesson's follow-ups are mv-app's lesson_followups (proposed from the
// transcript, approved by the in-charge in the app, which raises message_tasks
// and student_notes). TODO(next stage): read lesson_followups here, or drop this
// page in favour of the app's queue. The live path returns nothing until then.
// ============================================================================

function parentOf(studentId: string) {
  const student = demoProfiles.find((p) => p.id === studentId);
  const parent = student?.family_id
    ? demoProfiles.find((p) => p.role === "parent" && p.family_id === student.family_id)
    : null;
  return parent ? { id: parent.id, name: displayName(parent) } : null;
}

function studentLite(studentId: string) {
  const s = demoProfiles.find((p) => p.id === studentId)!;
  return { id: s.id, name: displayName(s), avatar_url: s.avatar_url };
}

function demoFollowups(): FollowupView[] {
  const now = DateTime.utc();
  const aarav = "00000000-0000-0000-0000-0000000000b1";
  const sofia = "00000000-0000-0000-0000-0000000000b2";

  const base = (
    id: string,
    studentId: string,
    type: FollowupView["type"],
    priority: FollowupView["priority"],
    reason: string,
    ageDays: number,
  ): FollowupView => ({
    id,
    student_id: studentId,
    session_id: null,
    type,
    priority,
    reason,
    status: "open",
    due_at: null,
    snoozed_until: null,
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
    created_at: now.minus({ days: ageDays }).toISO()!,
    student: studentLite(studentId),
    parent: parentOf(studentId),
  });

  return [
    base("fu-1", aarav, "no_show", "high", "Missed the Trigonometry lesson and hasn't rebooked.", 1),
    base("fu-2", sofia, "attendance_gap", "normal", "No lesson booked in 18 days — last attended 18 Jun.", 3),
    base("fu-3", sofia, "homework_overdue", "normal", "Function transformations homework is 2 days overdue.", 2),
    base("fu-4", aarav, "report_flag", "normal", "Teacher flagged persistent sign errors — suggest extra practice.", 0),
  ];
}

/** Open + snoozed follow-ups for the office, with student + parent. */
export async function getOpenFollowups(): Promise<FollowupView[]> {
  if (isDemoMode) {
    const order = { high: 0, normal: 1, low: 2 } as const;
    return demoFollowups().sort((a, b) => order[a.priority] - order[b.priority]);
  }
  // TODO(next stage): lesson_followups with status proposed for the in-charge's departments (RLS: is_incharge_of, admin).
  return [];
}
