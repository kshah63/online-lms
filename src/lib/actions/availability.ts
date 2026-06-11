"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import type { ActionResult } from "@/lib/actions/types";

export async function addAvailability(formData: FormData): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "teacher") return { ok: false, message: "Not allowed." };

  const weekday = Number(formData.get("weekday"));
  const start_time = String(formData.get("start_time") ?? "");
  const end_time = String(formData.get("end_time") ?? "");
  if (Number.isNaN(weekday) || !start_time || !end_time) {
    return { ok: false, message: "Pick a day and time range." };
  }
  if (end_time <= start_time) return { ok: false, message: "End time must be after start time." };

  if (isDemoMode) {
    revalidatePath("/teacher/availability");
    return { ok: true, message: "Demo mode: availability not persisted." };
  }

  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.from("teacher_availability").insert({
    teacher_id: profile.id,
    weekday,
    start_time,
    end_time,
    timezone: profile.timezone,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/teacher/availability");
  return { ok: true, message: "Availability added." };
}

export async function removeAvailability(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!isDemoMode) {
    const supabase = createSupabaseServerClient()!;
    await supabase.from("teacher_availability").delete().eq("id", id);
  }
  revalidatePath("/teacher/availability");
}
