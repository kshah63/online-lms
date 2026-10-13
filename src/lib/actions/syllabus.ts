"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import { listSyllabusTopics } from "@/lib/data/syllabus";
import { demoSeedSyllabus } from "@/lib/demo/syllabus";
import { canManageCourse } from "@/lib/permissions-bank";
import type { SyllabusTopic, SyllabusTopicInput } from "@/lib/bank/types";
import type { ActionResult } from "@/lib/actions/types";

// ============================================================================
// The syllabus editor's writes: seed_syllabus_from_course_topics and
// upsert_syllabus_topic, both manages_course in the database. A reorder is
// two upserts with the sort_orders swapped (src/lib/bank/syllabus-order.ts).
// ============================================================================

async function guard(courseId: string): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (!profile) return "Not signed in.";
  if (!(await canManageCourse(profile, courseId))) return "You do not manage this course.";
  return null;
}

/** Seed one syllabus topic per course topic not yet seeded; returns what was added. */
export async function seedSyllabusAction(courseId: string): Promise<ActionResult & { added: number; rows?: SyllabusTopic[] }> {
  const refused = await guard(courseId);
  if (refused) return { ok: false, message: refused, added: 0 };

  if (isDemoMode) {
    const rows = demoSeedSyllabus(courseId, await listSyllabusTopics(courseId));
    return { ok: true, message: `Demo mode: seed_syllabus_from_course_topics would add ${rows.length} topic${rows.length === 1 ? "" : "s"}.`, added: rows.length, rows };
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("seed_syllabus_from_course_topics", { p_course_id: courseId });
  if (error) return { ok: false, message: error.message, added: 0 };
  const added = typeof data === "number" ? data : 0;
  revalidatePath(`/syllabus/${courseId}`);
  return { ok: true, message: added === 0 ? "Every course topic is already in the syllabus." : `Added ${added} topic${added === 1 ? "" : "s"} from the course's topic list.`, added };
}

/** upsert_syllabus_topic for one or more topics, in order; returns each id (a new one for an insert). */
export async function upsertSyllabusTopicsAction(courseId: string, inputs: SyllabusTopicInput[]): Promise<ActionResult & { ids: string[] }> {
  const refused = await guard(courseId);
  if (refused) return { ok: false, message: refused, ids: [] };
  const cleaned = inputs.map((t) => ({ ...t, label: t.label.trim() }));
  if (cleaned.some((t) => !t.label)) return { ok: false, message: "A topic needs a label.", ids: [] };

  if (isDemoMode) {
    return { ok: true, message: `Demo mode: upsert_syllabus_topic would save ${cleaned.length === 1 ? `"${cleaned[0]!.label}"` : `${cleaned.length} topics`}.`, ids: cleaned.map((t) => t.id ?? randomUUID()) };
  }

  const supabase = createSupabaseServerClient()!;
  const ids: string[] = [];
  for (const t of cleaned) {
    const { data, error } = await supabase.rpc("upsert_syllabus_topic", {
      p_course_id: courseId,
      p_id: t.id,
      p_label: t.label,
      p_parent_id: t.parent_id,
      p_sort_order: t.sort_order,
      p_is_active: t.is_active,
    });
    if (error) return { ok: false, message: error.message, ids };
    ids.push(typeof data === "string" ? data : (t.id ?? ""));
  }
  revalidatePath(`/syllabus/${courseId}`);
  return { ok: true, message: cleaned.length === 1 ? "Saved." : "Order saved.", ids };
}
