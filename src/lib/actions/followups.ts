"use server";

import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import { getOverdueHomework } from "@/lib/data/homework";

export async function resolveFollowup(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "") || null;
  if (!isDemoMode && id) {
    const profile = await getCurrentProfile();
    const supabase = createSupabaseServerClient()!;
    await supabase
      .from("followups")
      .update({ status: "done", resolved_by: profile?.id ?? null, resolved_at: new Date().toISOString(), resolution_note: note })
      .eq("id", id);
  }
  revalidatePath("/admin/followups");
}

export async function snoozeFollowup(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const days = Number(formData.get("days") ?? 7);
  if (!isDemoMode && id) {
    const supabase = createSupabaseServerClient()!;
    await supabase
      .from("followups")
      .update({ status: "snoozed", snoozed_until: DateTime.utc().plus({ days }).toISO() })
      .eq("id", id);
  }
  revalidatePath("/admin/followups");
}

/**
 * Scan for action items: no-shows, overdue homework, and attendance gaps
 * (no completed lesson in 21 days and nothing upcoming). Idempotent — skips a
 * student/type that already has an open item.
 */
export async function generateFollowups(): Promise<void> {
  if (isDemoMode) {
    revalidatePath("/admin/followups");
    return;
  }
  const supabase = createSupabaseServerClient()!;
  const nowISO = new Date().toISOString();

  const { data: open } = await supabase
    .from("followups")
    .select("student_id,type,session_id")
    .in("status", ["open", "snoozed"]);
  const hasType = (student: string, type: string) =>
    (open ?? []).some((o) => o.student_id === student && o.type === type);
  const hasSession = (session: string) => (open ?? []).some((o) => o.session_id === session);

  // No-shows in the last 30 days.
  const cutoff30 = DateTime.utc().minus({ days: 30 }).toISO();
  const { data: noShows } = await supabase
    .from("sessions")
    .select("id,student_id,scheduled_start,course:courses(name)")
    .eq("status", "no_show")
    .gte("scheduled_start", cutoff30);
  for (const s of noShows ?? []) {
    if (!hasSession(s.id)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const course = (s as any).course?.name ?? "a lesson";
      await supabase.from("followups").insert({
        student_id: s.student_id,
        session_id: s.id,
        type: "no_show",
        priority: "high",
        reason: `Missed ${course} — hasn't rebooked.`,
      });
    }
  }

  // Overdue homework.
  for (const h of await getOverdueHomework()) {
    if (!hasType(h.student_id, "homework_overdue")) {
      await supabase.from("followups").insert({
        student_id: h.student_id,
        type: "homework_overdue",
        priority: "normal",
        reason: `${h.course_name} homework is overdue: "${h.description}".`,
      });
    }
  }

  // Attendance gaps.
  const { data: students } = await supabase.from("profiles").select("id").eq("role", "student");
  const gapCutoff = DateTime.utc().minus({ days: 21 }).toISO();
  for (const st of students ?? []) {
    if (hasType(st.id, "attendance_gap")) continue;
    const { data: lastDone } = await supabase
      .from("sessions")
      .select("scheduled_start")
      .eq("student_id", st.id)
      .eq("status", "completed")
      .order("scheduled_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: upcoming } = await supabase
      .from("sessions")
      .select("id")
      .eq("student_id", st.id)
      .gte("scheduled_start", nowISO)
      .in("status", ["scheduled", "confirmed"])
      .limit(1)
      .maybeSingle();
    if (lastDone && lastDone.scheduled_start < gapCutoff! && !upcoming) {
      await supabase.from("followups").insert({
        student_id: st.id,
        type: "attendance_gap",
        priority: "normal",
        reason: "No completed lesson in over 3 weeks and nothing booked.",
      });
    }
  }

  revalidatePath("/admin/followups");
}
