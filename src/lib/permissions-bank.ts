import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { demoCourses, demoInchargeDepartments } from "@/lib/demo/data";
import type { Course, Profile, Role } from "@/lib/types";

// ============================================================================
// Who may run a course's question bank and syllabus: rpc manages_course in the
// database (an admin, or an in-charge of the course's department or of one a
// routing rule sends it to). The room asks the database per course and never
// widens the answer; the demo mirrors the rule on the demo rows.
// ============================================================================

/** The roles manages_course can ever say yes to. A teacher, a family or an ambassador never reaches the bank. */
export function mayManageCourses(role: Role): boolean {
  return role === "admin" || role === "staff" || role === "support";
}

/** manages_course, as the demo answers it: admin, or an in-charge of the course's department. */
export function demoManagesCourse(viewer: Profile, course: Pick<Course, "department_id">): boolean {
  if (viewer.role === "admin") return true;
  if (!mayManageCourses(viewer.role)) return false;
  return (demoInchargeDepartments[viewer.id] ?? []).some((d) => d === course.department_id);
}

/** The demo courses the viewer manages. */
export function demoManagedCourses(viewer: Profile): Course[] {
  return demoCourses.filter((c) => demoManagesCourse(viewer, c));
}

/** rpc manages_course(p_course_id) for the signed-in viewer. */
export async function canManageCourse(viewer: Profile, courseId: string): Promise<boolean> {
  if (!mayManageCourses(viewer.role)) return false;
  if (isDemoMode) {
    const course = demoCourses.find((c) => c.id === courseId);
    return course ? demoManagesCourse(viewer, course) : false;
  }
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("manages_course", { p_course_id: courseId });
  if (error) throw new Error(`manages_course failed: ${error.message}`);
  return data === true;
}
