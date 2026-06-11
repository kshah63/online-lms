import { DateTime } from "luxon";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { demoCourses, demoParentStudent, demoProfiles } from "@/lib/demo/data";
import type { Homework, Profile } from "@/lib/types";

export interface HomeworkView extends Homework {
  course_name: string;
  student_name: string;
}

// ---------------------------------------------------------------------------
// Demo homework, anchored to "now" so overdue/upcoming states stay realistic.
// ---------------------------------------------------------------------------
function demoHomework(): HomeworkView[] {
  const now = DateTime.utc();
  const aarav = "00000000-0000-0000-0000-0000000000b1";
  const sofia = "00000000-0000-0000-0000-0000000000b2";
  const igcse = demoCourses[0];
  const sat = demoCourses[1];

  const mk = (
    id: string,
    studentId: string,
    courseName: string,
    courseId: string,
    description: string,
    dueDays: number,
    status: Homework["status"],
  ): HomeworkView => ({
    id,
    session_id: null,
    student_id: studentId,
    course_id: courseId,
    description,
    assigned_at: now.minus({ days: dueDays + 5 }).toISO()!,
    due_at: now.plus({ days: dueDays }).toISO()!,
    status,
    completed_at: status === "completed" ? now.minus({ days: 1 }).toISO() : null,
    marked_by: status === "completed" ? studentId : null,
    updated_at: now.toISO()!,
    course_name: courseName,
    student_name: demoProfiles.find((p) => p.id === studentId)?.display_name ?? "Student",
  });

  return [
    mk("hw-1", aarav, igcse.name, igcse.id, "Exercise 4B questions 1–8 (completing the square).", -3, "completed"),
    mk("hw-2", aarav, igcse.name, igcse.id, "Quadratic formula worksheet — questions 1–6.", 3, "assigned"),
    mk("hw-3", sofia, sat.name, sat.id, "Function transformations practice set.", -2, "assigned"),
  ];
}

function childIds(profile: Profile): string[] {
  if (profile.role === "student") return [profile.id];
  if (profile.role === "parent") return demoParentStudent[profile.id] ?? [];
  return [];
}

/** Homework for a student (their own) or a parent (across their children). */
export async function getHomeworkForProfile(profile: Profile): Promise<HomeworkView[]> {
  if (isDemoMode) {
    const ids = childIds(profile);
    return demoHomework()
      .filter((h) => ids.includes(h.student_id))
      .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
  }

  const supabase = createSupabaseServerClient()!;
  let q = supabase
    .from("homework")
    .select(`*, course:courses(name), student:profiles!student_id(display_name)`)
    .order("due_at", { ascending: true });
  if (profile.role === "student") q = q.eq("student_id", profile.id);
  const { data, error } = await q;
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    ...r,
    course_name: r.course?.name ?? "",
    student_name: r.student?.display_name ?? "",
  }));
}

/** Overdue homework across all students (admin / follow-up generation). */
export async function getOverdueHomework(): Promise<HomeworkView[]> {
  const nowISO = new Date().toISOString();
  if (isDemoMode) {
    return demoHomework().filter((h) => h.status !== "completed" && (h.due_at ?? "") < nowISO);
  }
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("homework")
    .select(`*, course:courses(name), student:profiles!student_id(display_name)`)
    .neq("status", "completed")
    .lt("due_at", nowISO);
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    ...r,
    course_name: r.course?.name ?? "",
    student_name: r.student?.display_name ?? "",
  }));
}
