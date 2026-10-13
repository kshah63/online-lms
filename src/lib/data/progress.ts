import { isDemoMode } from "@/lib/env";
import { sampleProgressView } from "@/lib/syllabus/samples";
import type { ProgressView } from "@/lib/syllabus/view";

/**
 * The progress dashboard's data. In demo mode this is sample data run through
 * the real model. TODO(next stage): rpc child_progress(p_student_id, p_course_id)
 * replaces this; until then the live path returns nothing.
 */
export async function getProgressView(studentId: string, courseId: string | null): Promise<ProgressView | null> {
  if (isDemoMode) return sampleProgressView();
  void studentId;
  void courseId;
  return null;
}
