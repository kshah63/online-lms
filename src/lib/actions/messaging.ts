"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import { demoParentStudent, demoProfiles } from "@/lib/demo/data";
import { sendWhatsApp, whatsappConfigured } from "@/lib/messaging/whatsapp";
import type { ActionResult } from "@/lib/actions/types";

/** Resolve the parent (id, phone) for a student. */
async function parentForStudent(studentId: string): Promise<{ id: string; phone: string | null } | null> {
  if (isDemoMode) {
    const parentId = Object.entries(demoParentStudent).find(([, kids]) => kids.includes(studentId))?.[0];
    const parent = parentId ? demoProfiles.find((p) => p.id === parentId) : null;
    return parent ? { id: parent.id, phone: parent.phone } : null;
  }
  const supabase = createSupabaseServerClient()!;
  const { data } = await supabase
    .from("parent_student")
    .select(`parent:profiles!parent_student_parent_id_fkey(id,phone)`)
    .eq("student_id", studentId)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any)?.parent ?? null;
}

/** Send a WhatsApp message to a student's parent and log it. */
export async function sendParentMessage(input: {
  studentId: string;
  body: string;
  followupId?: string;
}): Promise<ActionResult> {
  const parent = await parentForStudent(input.studentId);
  if (!parent?.phone) {
    return { ok: false, message: "No phone number on file for this parent." };
  }

  const result = await sendWhatsApp(parent.phone, input.body);

  if (!isDemoMode) {
    const profile = await getCurrentProfile();
    const supabase = createSupabaseServerClient()!;
    await supabase.from("outbound_messages").insert({
      channel: "whatsapp",
      to_profile: parent.id,
      to_phone: parent.phone,
      body: input.body,
      status: result.status,
      provider_ref: result.ref,
      followup_id: input.followupId ?? null,
      sent_by: profile?.id ?? null,
    });
  }

  revalidatePath("/admin/followups");
  const verb = result.status === "sent" ? "Sent" : result.status === "simulated" ? "Simulated (no provider configured)" : "Failed to send";
  return {
    ok: result.status !== "failed",
    message: `${verb} WhatsApp to parent${whatsappConfigured ? "" : " — demo"}.`,
  };
}
