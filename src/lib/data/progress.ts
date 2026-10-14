import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { listMyOnlineLessons } from "@/lib/data/lessons";
import { buildDemoChildProgress, demoMayReadProgress, demoProgressCourses, demoSearchStudents } from "@/lib/demo/progress";
import { progressFromRpc, type ProgressPageData } from "@/lib/syllabus/from-rpc";
import { displayName, type Profile } from "@/lib/types";

// ============================================================================
// The progress dashboard's data. One RPC answers it: child_progress(
// p_student_id, p_course_id) gathers the signals under its own gate (the
// child, the household, the room's in-charge, the teacher with a
// session on that course within a fortnight, support, an admin) and the room derives
// the statuses with src/lib/syllabus/from-rpc.ts. A refusal comes back as the
// database's sentence, never as an empty dashboard.
// ============================================================================

export interface ProgressCourse {
  id: string;
  name: string;
}

/**
 * The courses a student's online bookings are on, for the course picker.
 * my_online_lessons carries the subject name but not the course id, so this
 * reads session_requests.course_id under RLS (the household's own rows, a
 * room's rows for its in-charge, every row for an admin) and names them from
 * courses, which any signed-in account may read.
 */
export async function getProgressCourses(viewer: Profile, studentId: string): Promise<ProgressCourse[]> {
  if (isDemoMode) return demoProgressCourses(viewer, studentId);

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("session_requests").select("course_id").eq("student_id", studentId).eq("mode", "online").not("course_id", "is", null);
  if (error) throw new Error(`session_requests failed: ${error.message}`);
  const ids = [...new Set((data ?? []).map((r) => String((r as { course_id: string }).course_id)))];
  if (ids.length === 0) return [];

  const courses = await supabase.from("courses").select("id, name").in("id", ids).order("name");
  if (courses.error) throw new Error(`courses failed: ${courses.error.message}`);
  return (courses.data ?? []).map((c) => ({ id: String((c as { id: string }).id), name: String((c as { name: string }).name) }));
}

/** rpc child_progress for one student and course, mapped onto the dashboard. Throws the database's refusal as a sentence. */
export async function getProgressView(viewer: Profile, studentId: string, courseId: string): Promise<ProgressPageData> {
  if (isDemoMode) {
    if (!demoMayReadProgress(viewer, studentId, courseId)) throw new Error("this child's progress is not yours to read");
    return progressFromRpc(buildDemoChildProgress(studentId, courseId));
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("child_progress", { p_student_id: studentId, p_course_id: courseId });
  if (error) throw new Error(`child_progress failed: ${error.message}`);
  return progressFromRpc(data);
}

/** For the office: the students whose online lessons the viewer observes this fortnight (my_online_lessons observer rows), each a door to their progress. */
export async function getStudentsInMyRooms(viewer: Profile): Promise<{ id: string; name: string; subjects: string[] }[]> {
  const rows = (await listMyOnlineLessons(viewer, 14)).filter((l) => l.seat === "observer" && l.student_id);
  const byStudent = new Map<string, { id: string; name: string; subjects: string[] }>();
  for (const l of rows) {
    const entry = byStudent.get(l.student_id!) ?? { id: l.student_id!, name: l.student_name, subjects: [] };
    if (l.subject && !entry.subjects.includes(l.subject)) entry.subjects.push(l.subject);
    byStudent.set(l.student_id!, entry);
  }
  return [...byStudent.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface StudentMatch {
  id: string;
  name: string;
  grade_level: string | null;
}

/** How many matches a search lists before saying where it stopped. */
export const STUDENT_SEARCH_LIMIT = 20;

/**
 * Search-then-pick for the desk: the students whose full or preferred name
 * holds the text, among the profiles RLS lets the viewer read, by name. The
 * result is a real profile with an id, never a name somebody spelled, and
 * `total` is the real count so the screen can say when the list stops.
 */
export async function searchStudents(q: string): Promise<{ students: StudentMatch[]; total: number }> {
  // Letters, digits, spaces, hyphens and apostrophes are all a name holds; anything else
  // would be a PostgREST filter character (a comma or bracket ends the `or` clause).
  const needle = q.replace(/[^\p{L}\p{N}\s'-]/gu, "").trim();
  if (!needle) return { students: [], total: 0 };

  if (isDemoMode) {
    const all = demoSearchStudents(needle);
    return { students: all.slice(0, STUDENT_SEARCH_LIMIT), total: all.length };
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error, count } = await supabase
    .from("profiles")
    .select("id, full_name, preferred_name, grade_level", { count: "exact" })
    .eq("role", "student")
    .is("deactivated_at", null)
    .or(`full_name.ilike.%${needle}%,preferred_name.ilike.%${needle}%`)
    .order("full_name")
    .limit(STUDENT_SEARCH_LIMIT);
  if (error) throw new Error(`profiles search failed: ${error.message}`);
  const students = ((data ?? []) as { id: string; full_name: string; preferred_name: string | null; grade_level: string | null }[]).map((r) => ({
    id: r.id,
    name: displayName(r),
    grade_level: r.grade_level,
  }));
  return { students, total: count ?? students.length };
}
