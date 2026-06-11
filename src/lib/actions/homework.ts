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

/** Teacher verifies the submitted notebook work (completed) or sends it back. */
export async function verifyHomework(id: string, verified: boolean, note: string | null): Promise<void> {
  if (!isDemoMode) {
    const profile = await getCurrentProfile();
    const supabase = createSupabaseServerClient()!;
    await supabase
      .from("homework")
      .update({
        status: verified ? "completed" : "incomplete",
        verified_by: profile?.id ?? null,
        verified_at: new Date().toISOString(),
        completed_at: verified ? new Date().toISOString() : null,
        review_note: note,
      })
      .eq("id", id);
  }
  revalidatePath("/teacher/homework");
  revalidatePath(`/teacher/homework/${id}`);
  revalidatePath("/home/homework");
}
