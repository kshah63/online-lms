"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";

/** Persist the tldraw page created for this homework the first time it's opened. */
export async function setHomeworkPage(id: string, pageId: string): Promise<void> {
  if (isDemoMode) return;
  const supabase = createSupabaseServerClient()!;
  await supabase.from("homework").update({ notebook_page_id: pageId }).eq("id", id).is("notebook_page_id", null);
}

/** Student submits their work on the notebook for review. */
export async function submitHomework(id: string): Promise<void> {
  if (!isDemoMode) {
    const supabase = createSupabaseServerClient()!;
    await supabase
      .from("homework")
      .update({ status: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", id);
  }
  revalidatePath("/home/homework");
  revalidatePath("/home");
  revalidatePath(`/home/homework/${id}`);
}

export interface HomeworkGrade {
  verified: boolean;
  correct?: number | null;
  incorrect?: number | null;
  notDone?: number | null;
  feedback?: string | null;
}

/** Teacher grades the submitted work: marks (quantifiable) + comment, and
 * verifies complete or sends it back. */
export async function gradeHomework(id: string, grade: HomeworkGrade): Promise<void> {
  if (!isDemoMode) {
    const profile = await getCurrentProfile();
    const supabase = createSupabaseServerClient()!;
    const now = new Date().toISOString();
    await supabase
      .from("homework")
      .update({
        status: grade.verified ? "completed" : "incomplete",
        verified_by: profile?.id ?? null,
        verified_at: now,
        completed_at: grade.verified ? now : null,
        mark_correct: grade.correct ?? null,
        mark_incorrect: grade.incorrect ?? null,
        mark_not_done: grade.notDone ?? null,
        feedback: grade.feedback ?? null,
        review_note: grade.verified ? null : grade.feedback ?? null,
      })
      .eq("id", id);
  }
  revalidatePath("/teacher/homework");
  revalidatePath(`/hw/${id}`);
  revalidatePath("/home/homework");
  revalidatePath("/home");
}
