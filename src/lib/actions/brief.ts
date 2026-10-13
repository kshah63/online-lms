"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import type { ActionResult } from "@/lib/actions/types";
import { label, type TopicStatus } from "@/lib/syllabus/progress";

const STATUSES: readonly TopicStatus[] = ["not_started", "in_progress", "covered", "secure", "needs_work"];

/**
 * Mark where a student stands on a syllabus topic, through rpc
 * set_topic_status. Who may (the assigned teacher of a session for the
 * student on the topic's course within seven days, the course's in-charge,
 * an admin) is the database's rule; its refusal is shown as it came.
 */
export async function markTopicStatus(input: { sessionId: string; studentId: string; topicId: string; status: string; note: string }): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Not signed in." };
  if (!STATUSES.includes(input.status as TopicStatus)) return { ok: false, message: "Pick one of the five statuses." };
  const note = input.note.trim() || null;

  if (isDemoMode) {
    return { ok: true, message: `Demo mode: the topic would be marked ${label(input.status as TopicStatus)} through set_topic_status${note ? ` with the note "${note}"` : ""}.` };
  }

  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.rpc("set_topic_status", { p_student_id: input.studentId, p_topic_id: input.topicId, p_status: input.status, p_note: note });
  if (error) return { ok: false, message: error.message };

  revalidatePath(`/teacher/brief/${input.sessionId}`);
  return { ok: true, message: `Marked ${label(input.status as TopicStatus)}.` };
}
