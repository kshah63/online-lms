import { isDemoMode } from "@/lib/env";
import { sampleProgressView } from "@/lib/syllabus/samples";
import type { ProgressView } from "@/lib/syllabus/view";
import { firstName, type Profile } from "@/lib/types";

/**
 * The progress dashboard's data. In demo mode this is sample data run through
 * the real model, labelled with the chosen child. TODO(mv-app): rpc
 * child_progress(p_student_id, p_course_id) replaces this; until it lands the
 * live path returns nothing and the page shows its empty state.
 */
export async function getProgressView(
  student: Pick<Profile, "id" | "full_name" | "preferred_name">,
  courseId: string | null,
): Promise<ProgressView | null> {
  if (isDemoMode) {
    const view = sampleProgressView();
    return { ...view, student: { id: student.id, first_name: firstName(student) } };
  }
  void courseId;
  return null;
}
