import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { demoFollowups, demoInchargeDepartments } from "@/lib/demo/data";
import { getDisplayNames } from "@/lib/data/family";
import { listMyOnlineLessons } from "@/lib/data/lessons";
import { LESSON_FOLLOWUP_COLUMNS, type LessonFollowup, type Profile } from "@/lib/types";

// ============================================================================
// Follow-ups, read-only. lesson_followups rows are proposed from the transcript
// by lesson-finalize and decided in the centre app (approve_followup raises
// the message, task or note there). The room lists them so the office can see
// what is waiting; it never decides one. RLS: the assigned teacher reads their
// own, is_incharge_of(department_id) and admin read their rooms'.
// ============================================================================

export interface FollowupView extends LessonFollowup {
  student_name: string;
  /** The lesson's subject and start when it is within the viewer's lessons window. */
  lesson: { subject: string | null; effective_start: string } | null;
}

export const FOLLOWUPS_LIMIT = 200;

/** Every follow-up the viewer may read, newest first, with the student's name and the lesson when known. */
export async function listFollowups(viewer: Profile): Promise<{ rows: FollowupView[]; hitLimit: boolean }> {
  const rows = await readFollowups(viewer);
  const [names, lessons] = await Promise.all([
    getDisplayNames(rows.map((r) => r.student_id)),
    listMyOnlineLessons(viewer, 30),
  ]);
  const bySession = new Map(lessons.map((l) => [l.session_id, l]));
  return {
    rows: rows.map((r) => {
      const lesson = bySession.get(r.session_id);
      return {
        ...r,
        student_name: names.get(r.student_id) ?? "Student",
        lesson: lesson ? { subject: lesson.subject, effective_start: lesson.effective_start } : null,
      };
    }),
    hitLimit: rows.length === FOLLOWUPS_LIMIT,
  };
}

async function readFollowups(viewer: Profile): Promise<LessonFollowup[]> {
  if (isDemoMode) {
    // Mirror the policy: admin reads all, an in-charge their departments, support none.
    const mine = (f: LessonFollowup) =>
      viewer.role === "admin" ||
      (viewer.role === "staff" && f.department_id != null && (demoInchargeDepartments[viewer.id] ?? []).includes(f.department_id));
    return demoFollowups.filter(mine).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("lesson_followups")
    .select(LESSON_FOLLOWUP_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(FOLLOWUPS_LIMIT);
  if (error) throw new Error(`lesson_followups failed: ${error.message}`);
  return (data ?? []) as LessonFollowup[];
}
