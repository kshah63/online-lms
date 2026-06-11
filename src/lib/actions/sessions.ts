"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import type { ActionResult } from "@/lib/actions/types";

/** Admin: schedule a one-off or recurring weekly session. */
export async function scheduleSession(formData: FormData): Promise<ActionResult> {
  const course_id = String(formData.get("course_id") ?? "");
  const student_id = String(formData.get("student_id") ?? "");
  const teacher_id = String(formData.get("teacher_id") ?? "") || null;
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const tz = String(formData.get("timezone") ?? "UTC");
  const duration = Number(formData.get("duration") ?? 60);
  const weeks = Math.max(1, Math.min(12, Number(formData.get("weeks") ?? 1)));
  const agenda = String(formData.get("agenda") ?? "") || null;

  if (!course_id || !student_id || !date || !time) {
    return { ok: false, message: "Course, student, date and time are required." };
  }

  const series_id = weeks > 1 ? randomUUID() : null;
  const rows = Array.from({ length: weeks }).map((_, i) => {
    const startLocal = DateTime.fromISO(`${date}T${time}`, { zone: tz }).plus({ weeks: i });
    const start = startLocal.toUTC().toISO()!;
    const end = startLocal.plus({ minutes: duration }).toUTC().toISO()!;
    return {
      course_id,
      student_id,
      teacher_id,
      scheduled_start: start,
      scheduled_end: end,
      agenda,
      status: teacher_id ? "confirmed" : "scheduled",
      series_id,
    };
  });

  if (isDemoMode) {
    revalidatePath("/admin");
    revalidatePath("/admin/sessions");
    return {
      ok: true,
      message: `Demo mode: ${weeks > 1 ? `${weeks} sessions` : "session"} not persisted. Connect Supabase to save.`,
    };
  }

  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.from("sessions").insert(rows);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin");
  revalidatePath("/admin/sessions");
  return { ok: true, message: weeks > 1 ? `Scheduled ${weeks} weekly sessions.` : "Session scheduled." };
}

/** Admin: assign (or reassign) a teacher to a session. Bound directly to a form. */
export async function assignTeacher(formData: FormData): Promise<void> {
  const session_id = String(formData.get("session_id") ?? "");
  const teacher_id = String(formData.get("teacher_id") ?? "");
  if (!session_id || !teacher_id) return;

  if (!isDemoMode) {
    const supabase = createSupabaseServerClient()!;
    await supabase.from("sessions").update({ teacher_id, status: "confirmed" }).eq("id", session_id);
  }

  revalidatePath("/admin");
  revalidatePath("/admin/sessions");
}

/** Admin: cancel a session. */
export async function cancelSession(formData: FormData): Promise<ActionResult> {
  const session_id = String(formData.get("session_id") ?? "");
  const reason = String(formData.get("reason") ?? "") || null;
  if (!session_id) return { ok: false, message: "Missing session." };

  if (isDemoMode) {
    revalidatePath("/admin/sessions");
    return { ok: true, message: "Demo mode: cancellation not persisted." };
  }

  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase
    .from("sessions")
    .update({ status: "cancelled", cancel_reason: reason })
    .eq("id", session_id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin");
  revalidatePath("/admin/sessions");
  return { ok: true, message: "Session cancelled." };
}
