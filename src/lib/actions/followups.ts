"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import type { ActionResult } from "@/lib/actions/types";

// ============================================================================
// Deciding a follow-up, through mv-app's two doors: approve_followup and
// dismiss_followup. Every rule is the database's (decides_followup: the
// assigned teacher, the room's in-charge, an admin; a teacher's yes only marks
// the row approved for the in-charge to send; an in-charge's yes creates the
// message as themselves, the standing note, or the task) and a refusal is
// shown to the person as it came. The room adds no rule of its own.
// ============================================================================

export async function approveFollowupAction(input: { id: string; text?: string }): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Not signed in." };
  const text = input.text?.trim() || null;

  if (isDemoMode) {
    return { ok: true, message: `Demo mode: approve_followup would ${profile.role === "teacher" ? "mark this approved for the in-charge to send" : "send it now, as you"}${text ? ` with the wording "${text}"` : ""}.` };
  }

  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.rpc("approve_followup", { p_id: input.id, p_text: text, p_assignee: null });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/followups");
  return { ok: true, message: profile.role === "teacher" ? "Approved — the in-charge will send it." : "Done." };
}

export async function dismissFollowupAction(input: { id: string }): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Not signed in." };

  if (isDemoMode) return { ok: true, message: "Demo mode: dismiss_followup would mark this dismissed." };

  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.rpc("dismiss_followup", { p_id: input.id });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin/followups");
  return { ok: true, message: "Dismissed." };
}
