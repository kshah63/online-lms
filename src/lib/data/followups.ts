import { DateTime } from "luxon";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { demoParentStudent, demoProfiles } from "@/lib/demo/data";
import type { FollowupView } from "@/lib/types";

// ---------------------------------------------------------------------------
// Demo follow-ups — one of each meaningful type, all on students whose parents
// have a phone so the WhatsApp action is exercised.
// ---------------------------------------------------------------------------
function parentOf(studentId: string) {
  const parentId = Object.entries(demoParentStudent).find(([, kids]) => kids.includes(studentId))?.[0];
  const parent = parentId ? demoProfiles.find((p) => p.id === parentId) : null;
  return parent ? { id: parent.id, display_name: parent.display_name, phone: parent.phone } : null;
}

function studentLite(studentId: string) {
  const s = demoProfiles.find((p) => p.id === studentId)!;
  return { id: s.id, display_name: s.display_name, timezone: s.timezone, avatar_url: s.avatar_url, phone: s.phone };
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

/** Open + snoozed follow-ups for the admin dashboard, with student + parent. */
export async function getOpenFollowups(): Promise<FollowupView[]> {
  if (isDemoMode) {
    const order = { high: 0, normal: 1, low: 2 } as const;
    return demoFollowups().sort((a, b) => order[a.priority] - order[b.priority]);
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("followups")
    .select(`*, student:profiles!student_id(id,display_name,timezone,avatar_url,phone)`)
    .in("status", ["open", "snoozed"])
    .order("priority")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as unknown as FollowupView[];
  // Resolve parents in one query.
  const studentIds = [...new Set(rows.map((r) => r.student_id))];
  if (studentIds.length) {
    const { data: links } = await supabase
      .from("parent_student")
      .select(`student_id, parent:profiles!parent_id(id,display_name,phone)`)
      .in("student_id", studentIds);
    const byStudent = new Map<string, FollowupView["parent"]>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (links ?? []).forEach((l: any) => byStudent.set(l.student_id, l.parent));
    rows.forEach((r) => (r.parent = byStudent.get(r.student_id) ?? null));
  }
  return rows;
}
