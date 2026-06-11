import { DateTime } from "luxon";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { demoCourses, demoParentStudent, demoProfiles, demoTeacherCourse } from "@/lib/demo/data";
import type { Homework, Profile } from "@/lib/types";

export interface HomeworkView extends Homework {
  course_name: string;
  student_name: string;
}

const IGCSE = demoCourses[0];
const SAT = demoCourses[1];
const nb = (short: string, courseId: string) => `nb-${short}-${courseId}`;

// ---------------------------------------------------------------------------
// Demo homework — linked to the student's running notebook, in a mix of states.
// ---------------------------------------------------------------------------
function demoHomework(): HomeworkView[] {
  const now = DateTime.utc();
  const aarav = "00000000-0000-0000-0000-0000000000b1";
  const sofia = "00000000-0000-0000-0000-0000000000b2";

  const item = (over: Partial<HomeworkView> & { id: string; student_id: string; description: string }): HomeworkView => ({
    session_id: null,
    course_id: IGCSE.id,
    assigned_at: now.minus({ days: 5 }).toISO()!,
    due_at: now.plus({ days: 3 }).toISO()!,
    status: "assigned",
    completed_at: null,
    marked_by: null,
    notebook_id: null,
    notebook_page_id: null,
    submitted_at: null,
    verified_by: null,
    verified_at: null,
    review_note: null,
    updated_at: now.toISO()!,
    course_name: IGCSE.name,
    student_name: demoProfiles.find((p) => p.id === over.student_id)?.display_name ?? "Student",
    ...over,
  });

  return [
    item({
      id: "hw-1",
      student_id: aarav,
      description: "Exercise 4B questions 1–8 (completing the square).",
      course_id: IGCSE.id,
      course_name: IGCSE.name,
      notebook_id: nb("b1", IGCSE.id),
      notebook_page_id: "page:hw1",
      status: "completed",
      due_at: now.minus({ days: 1 }).toISO(),
      submitted_at: now.minus({ days: 2 }).toISO(),
      completed_at: now.minus({ days: 1 }).toISO(),
      verified_at: now.minus({ days: 1 }).toISO(),
    }),
    item({
      id: "hw-2",
      student_id: aarav,
      description: "Quadratic formula worksheet — questions 1–6. Show your working on the notebook.",
      course_id: IGCSE.id,
      course_name: IGCSE.name,
      notebook_id: nb("b1", IGCSE.id),
      due_at: now.plus({ days: 3 }).toISO(),
      status: "assigned",
    }),
    item({
      id: "hw-3",
      student_id: sofia,
      description: "Function transformations practice set.",
      course_id: SAT.id,
      course_name: SAT.name,
      notebook_id: nb("b2", SAT.id),
      notebook_page_id: "page:hw3",
      status: "submitted",
      due_at: now.minus({ days: 2 }).toISO(),
      submitted_at: now.minus({ days: 1 }).toISO(),
    }),
  ];
}

function childIds(profile: Profile): string[] {
  if (profile.role === "student") return [profile.id];
  if (profile.role === "parent") return demoParentStudent[profile.id] ?? [];
  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(r: any): HomeworkView {
  return { ...r, course_name: r.course?.name ?? "", student_name: r.student?.display_name ?? "" };
}

const SELECT = `*, course:courses(name), student:profiles!homework_student_id_fkey(display_name)`;

/** Homework for a student (own) or parent (children). */
export async function getHomeworkForProfile(profile: Profile): Promise<HomeworkView[]> {
  if (isDemoMode) {
    const ids = childIds(profile);
    return demoHomework()
      .filter((h) => ids.includes(h.student_id))
      .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
  }
  const supabase = createSupabaseServerClient()!;
  let q = supabase.from("homework").select(SELECT).order("due_at", { ascending: true });
  if (profile.role === "student") q = q.eq("student_id", profile.id);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function getHomework(id: string): Promise<HomeworkView | null> {
  if (isDemoMode) return demoHomework().find((h) => h.id === id) ?? null;
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("homework").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

/** Submitted homework awaiting a teacher's review (their students only). */
export async function getSubmittedForTeacher(teacher: Profile): Promise<HomeworkView[]> {
  if (isDemoMode) {
    const courses = demoTeacherCourse[teacher.id] ?? [];
    return demoHomework().filter((h) => h.status === "submitted" && h.course_id && courses.includes(h.course_id));
  }
  const supabase = createSupabaseServerClient()!; // RLS scopes to the teacher's students
  const { data, error } = await supabase
    .from("homework")
    .select(SELECT)
    .eq("status", "submitted")
    .order("submitted_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/** Overdue = past due and not yet submitted/completed (ball is in the student's court). */
export async function getOverdueHomework(): Promise<HomeworkView[]> {
  const nowISO = new Date().toISOString();
  if (isDemoMode) {
    return demoHomework().filter(
      (h) => (h.status === "assigned" || h.status === "incomplete") && (h.due_at ?? "") < nowISO,
    );
  }
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("homework")
    .select(SELECT)
    .in("status", ["assigned", "incomplete"])
    .lt("due_at", nowISO);
  if (error) throw error;
  return (data ?? []).map(mapRow);
}
