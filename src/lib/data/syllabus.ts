import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { demoCourseTopics } from "@/lib/demo/data";
import { demoSyllabusTopics } from "@/lib/demo/syllabus";
import { orderTopics } from "@/lib/bank/syllabus-order";
import { SYLLABUS_TOPIC_COLUMNS, type SyllabusTopic } from "@/lib/bank/types";

// ============================================================================
// syllabus_topics, read under RLS (labels are not sensitive: any signed-in
// account may select them). Distinct from course_topics, the booking form's
// option list the syllabus is seeded from. Writes are RPCs in
// src/lib/actions/syllabus.ts.
// ============================================================================

/** The course's syllabus topics, active ones first in sort order. */
export async function listSyllabusTopics(courseId: string): Promise<SyllabusTopic[]> {
  if (isDemoMode) return orderTopics(demoSyllabusTopics.filter((t) => t.course_id === courseId));
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("syllabus_topics").select(SYLLABUS_TOPIC_COLUMNS).eq("course_id", courseId).limit(500);
  if (error) throw new Error(`syllabus_topics failed: ${error.message}`);
  return orderTopics(((data ?? []) as SyllabusTopic[]).map((t) => ({ ...t, sort_order: Number(t.sort_order) || 0, is_active: Boolean(t.is_active) })));
}

/** The active topics as a pick list. */
export async function listTopicOptions(courseId: string): Promise<{ id: string; label: string }[]> {
  return (await listSyllabusTopics(courseId)).filter((t) => t.is_active).map((t) => ({ id: t.id, label: t.label }));
}

/** How many active course_topics the seed would read, so the editor can say what seeding does. */
export async function countCourseTopics(courseId: string): Promise<number> {
  if (isDemoMode) return demoCourseTopics.filter((t) => t.course_id === courseId).length;
  const supabase = createSupabaseServerClient()!;
  const { count, error } = await supabase.from("course_topics").select("id", { count: "exact", head: true }).eq("course_id", courseId).eq("is_active", true);
  if (error) throw new Error(`course_topics failed: ${error.message}`);
  return count ?? 0;
}
