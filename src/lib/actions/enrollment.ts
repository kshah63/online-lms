"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import { getChildren } from "@/lib/data/people";
import { logAudit } from "@/lib/audit";
import type { ActionResult } from "@/lib/actions/types";

/** Student/parent requests enrollment in a course (admin approves). */
export async function requestEnrollment(formData: FormData): Promise<ActionResult> {
  const student_id = String(formData.get("student_id") ?? "");
  const course_id = String(formData.get("course_id") ?? "");
  if (!student_id || !course_id) return { ok: false, message: "Pick a student and course." };

  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Not signed in." };
  const kids = await getChildren(profile); // self for student, children for parent
  if (!kids.some((k) => k.id === student_id)) {
    return { ok: false, message: "You can only request courses for your own account." };
  }

  if (isDemoMode) {
    revalidatePath("/home");
    return { ok: true, message: "Demo mode: request not persisted." };
  }
  const supabase = createSupabaseServerClient()!;

  // Avoid duplicate pending requests.
  const { data: existing } = await supabase
    .from("enrollment_requests")
    .select("id")
    .eq("student_id", student_id)
    .eq("course_id", course_id)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) return { ok: true, message: "There's already a pending request for this course." };

  const { error } = await supabase.from("enrollment_requests").insert({
    student_id,
    course_id,
    requested_by: profile.id,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/home");
  revalidatePath("/admin/courses");
  return { ok: true, message: "Requested — an admin will review it." };
}

/** Admin approves or denies a request. Approving creates the enrollment. */
export async function decideEnrollment(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? ""); // 'approved' | 'denied'
  if (isDemoMode || !id || !["approved", "denied"].includes(decision)) {
    revalidatePath("/admin/courses");
    return;
  }

  const profile = await getCurrentProfile();
  const supabase = createSupabaseServerClient()!;

  const { data: req } = await supabase
    .from("enrollment_requests")
    .select("student_id, course_id")
    .eq("id", id)
    .maybeSingle();

  if (req && decision === "approved") {
    await supabase.from("enrollments").upsert({ student_id: req.student_id, course_id: req.course_id });
  }
  await supabase
    .from("enrollment_requests")
    .update({ status: decision, decided_by: profile?.id ?? null, decided_at: new Date().toISOString() })
    .eq("id", id);
  await logAudit(profile, `enrollment.${decision}`, { type: "enrollment_request", id }, {
    student_id: req?.student_id,
    course_id: req?.course_id,
  });

  revalidatePath("/admin/courses");
  revalidatePath("/home");
}
