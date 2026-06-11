"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import type { HomeworkStatus } from "@/lib/types";

/** Student/parent marks homework done (or teacher records it incomplete). */
export async function setHomeworkStatus(id: string, status: HomeworkStatus): Promise<void> {
  if (isDemoMode) {
    revalidatePath("/home/homework");
    revalidatePath("/home");
    return;
  }
  const profile = await getCurrentProfile();
  const supabase = createSupabaseServerClient()!;
  await supabase
    .from("homework")
    .update({
      status,
      completed_at: status === "completed" ? new Date().toISOString() : null,
      marked_by: profile?.id ?? null,
    })
    .eq("id", id);
  revalidatePath("/home/homework");
  revalidatePath("/home");
}
