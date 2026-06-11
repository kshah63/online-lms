import { supabase } from "./supabase";
import type {
  SessionRow,
  ReportRow,
  HomeworkRow,
  FollowupRow,
  CourseRow,
  ChildRow,
} from "./types";

// All reads are RLS-scoped to the signed-in user, so the same query returns the
// right rows for a student, parent, teacher or admin.

export async function getUpcomingSessions(): Promise<SessionRow[]> {
  const since = new Date(Date.now() - 60 * 60_000).toISOString(); // include in-progress
  const { data, error } = await supabase
    .from("sessions")
    .select(
      "id, scheduled_start, scheduled_end, status, agenda, course:courses(name,subject), student:profiles!sessions_student_id_fkey(display_name), teacher:profiles!sessions_teacher_id_fkey(display_name)",
    )
    .in("status", ["scheduled", "confirmed", "in_progress"])
    .gte("scheduled_start", since)
    .order("scheduled_start", { ascending: true })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as SessionRow[];
}

export async function getReports(): Promise<ReportRow[]> {
  const { data, error } = await supabase
    .from("reports")
    .select(
      "id, session_id, topics_covered, how_student_did, strengths, areas_to_work, homework, rating, published_at, created_at, session:sessions(scheduled_start, course:courses(name), student:profiles!sessions_student_id_fkey(display_name))",
    )
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as ReportRow[];
}

export async function getReport(id: string): Promise<ReportRow | null> {
  const { data, error } = await supabase
    .from("reports")
    .select(
      "id, session_id, topics_covered, how_student_did, strengths, areas_to_work, homework, rating, published_at, created_at, session:sessions(scheduled_start, course:courses(name), student:profiles!sessions_student_id_fkey(display_name))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as ReportRow) ?? null;
}

export async function getHomework(): Promise<HomeworkRow[]> {
  const { data, error } = await supabase
    .from("homework")
    .select(
      "id, description, status, due_at, submitted_at, completed_at, mark_correct, mark_incorrect, mark_not_done, feedback, student_id, course:courses(name), student:profiles!homework_student_id_fkey(display_name)",
    )
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(80);
  if (error) throw error;
  return (data ?? []) as unknown as HomeworkRow[];
}

export async function getHomeworkItem(id: string): Promise<HomeworkRow | null> {
  const { data, error } = await supabase
    .from("homework")
    .select(
      "id, description, status, due_at, submitted_at, completed_at, mark_correct, mark_incorrect, mark_not_done, feedback, student_id, course:courses(name), student:profiles!homework_student_id_fkey(display_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as HomeworkRow) ?? null;
}

export interface GradeInput {
  verified: boolean;
  correct: number | null;
  incorrect: number | null;
  notDone: number | null;
  feedback: string | null;
}

/** Teacher grades homework (RLS allows teacher-of-student to update). */
export async function gradeHomework(id: string, g: GradeInput): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("homework")
    .update({
      status: g.verified ? "completed" : "incomplete",
      verified_at: now,
      completed_at: g.verified ? now : null,
      mark_correct: g.correct,
      mark_incorrect: g.incorrect,
      mark_not_done: g.notDone,
      feedback: g.feedback,
    })
    .eq("id", id);
  if (error) throw error;
}

/** Student/parent marks homework done or not (RLS allows the subject + parent). */
export async function markHomework(id: string, done: boolean): Promise<void> {
  const { error } = await supabase
    .from("homework")
    .update({
      status: done ? "completed" : "assigned",
      completed_at: done ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function getOpenFollowups(): Promise<FollowupRow[]> {
  const { data, error } = await supabase
    .from("followups")
    .select("id, type, priority, status, reason, created_at, student:profiles!followups_student_id_fkey(display_name)")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as FollowupRow[];
}

/** Children to act for: self (student) or linked children (parent). */
export async function getActableChildren(profileId: string, role: string): Promise<ChildRow[]> {
  if (role === "student") {
    const { data } = await supabase.from("profiles").select("id, display_name").eq("id", profileId).maybeSingle();
    return data ? [data as ChildRow] : [];
  }
  if (role === "parent") {
    const { data } = await supabase
      .from("parent_student")
      .select("student:profiles!parent_student_student_id_fkey(id, display_name)")
      .eq("parent_id", profileId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((r: any) => r.student).filter(Boolean) as ChildRow[];
  }
  return [];
}

export async function getEnrolledCourses(studentId: string): Promise<CourseRow[]> {
  const { data, error } = await supabase
    .from("enrollments")
    .select("course:courses(id, name, subject)")
    .eq("student_id", studentId);
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => r.course).filter(Boolean) as CourseRow[];
}

/** Student/parent requests enrollment in a course (RLS allows the subject/parent). */
export async function requestEnrollment(studentId: string, courseId: string, requestedBy: string): Promise<void> {
  const { error } = await supabase
    .from("enrollment_requests")
    .insert({ student_id: studentId, course_id: courseId, requested_by: requestedBy });
  if (error) throw error;
}

export async function getAllCourses(): Promise<CourseRow[]> {
  const { data, error } = await supabase.from("courses").select("id, name, subject").order("name");
  if (error) throw error;
  return (data ?? []) as CourseRow[];
}
