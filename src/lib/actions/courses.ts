"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import { logAudit } from "@/lib/audit";
import type { ActionResult } from "@/lib/actions/types";

function revalidateCourses() {
  revalidatePath("/admin/courses");
  revalidatePath("/admin/sessions");
  revalidatePath("/home");
}

/** Admin: create a course. */
export async function createCourse(formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim() || null;
  const materials = String(formData.get("materials_course_id") ?? "").trim() || null;
  if (!name) return { ok: false, message: "Course name is required." };

  if (isDemoMode) {
    revalidateCourses();
    return { ok: true, message: "Demo mode: course not persisted." };
  }
  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.from("courses").insert({ name, subject, materials_course_id: materials });
  if (error) return { ok: false, message: error.message };

  await logAudit(await getCurrentProfile(), "course.create", { type: "course" }, { name, subject });
  revalidateCourses();
  return { ok: true, message: "Course added." };
}

/** Admin: enroll a student in a course. */
export async function enrollStudent(formData: FormData): Promise<ActionResult> {
  const student_id = String(formData.get("student_id") ?? "");
  const course_id = String(formData.get("course_id") ?? "");
  if (!student_id || !course_id) return { ok: false, message: "Pick a student." };

  if (isDemoMode) {
    revalidateCourses();
    return { ok: true, message: "Demo mode: enrollment not persisted." };
  }
  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.from("enrollments").upsert({ student_id, course_id });
  if (error) return { ok: false, message: error.message };

  await logAudit(await getCurrentProfile(), "enrollment.add", { type: "enrollment" }, { student_id, course_id });
  revalidateCourses();
  return { ok: true, message: "Student enrolled." };
}

/** Admin: remove a student from a course. Bound directly to a form. */
export async function unenrollStudent(formData: FormData): Promise<void> {
  const student_id = String(formData.get("student_id") ?? "");
  const course_id = String(formData.get("course_id") ?? "");
  if (!isDemoMode && student_id && course_id) {
    const supabase = createSupabaseServerClient()!;
    await supabase.from("enrollments").delete().eq("student_id", student_id).eq("course_id", course_id);
    await logAudit(await getCurrentProfile(), "enrollment.remove", { type: "enrollment" }, { student_id, course_id });
  }
  revalidateCourses();
}
