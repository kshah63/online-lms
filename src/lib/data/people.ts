import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import {
  demoBalances,
  demoConsents,
  demoCourses,
  demoParentStudent,
  demoProfiles,
  demoReports,
  demoTeacherCourse,
} from "@/lib/demo/data";
import type { Consent, Course, Profile, Report } from "@/lib/types";

export async function listTeachers(): Promise<Profile[]> {
  if (isDemoMode) return demoProfiles.filter((p) => p.role === "teacher");
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("profiles").select("*").eq("role", "teacher").order("display_name");
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function listStudents(): Promise<Profile[]> {
  if (isDemoMode) return demoProfiles.filter((p) => p.role === "student");
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("profiles").select("*").eq("role", "student").order("display_name");
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function listParents(): Promise<Profile[]> {
  if (isDemoMode) return demoProfiles.filter((p) => p.role === "parent");
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("profiles").select("*").eq("role", "parent").order("display_name");
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function listCourses(): Promise<Course[]> {
  if (isDemoMode) return demoCourses;
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("courses").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as Course[];
}

/** Teachers eligible for a course (teacher_course mapping). */
export async function teachersForCourse(courseId: string): Promise<Profile[]> {
  if (isDemoMode) {
    const ids = Object.entries(demoTeacherCourse)
      .filter(([, courses]) => courses.includes(courseId))
      .map(([teacherId]) => teacherId);
    return demoProfiles.filter((p) => ids.includes(p.id));
  }
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("teacher_course")
    .select("teacher:profiles!teacher_course_teacher_id_fkey(*)")
    .eq("course_id", courseId);
  if (error) throw error;
  return ((data ?? []) as unknown as { teacher: Profile }[]).map((r) => r.teacher);
}

/** Children of a parent (their own profile for a student). */
export async function getChildren(profile: Profile): Promise<Profile[]> {
  if (profile.role === "student") return [profile];
  if (profile.role !== "parent") return [];

  if (isDemoMode) {
    const ids = demoParentStudent[profile.id] ?? [];
    return demoProfiles.filter((p) => ids.includes(p.id));
  }
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("parent_student")
    .select("student:profiles!parent_student_student_id_fkey(*)")
    .eq("parent_id", profile.id);
  if (error) throw error;
  return ((data ?? []) as unknown as { student: Profile }[]).map((r) => r.student);
}

export async function getReportForSession(sessionId: string): Promise<Report | null> {
  if (isDemoMode) return demoReports.find((r) => r.session_id === sessionId) ?? null;
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("reports").select("*").eq("session_id", sessionId).maybeSingle();
  if (error) throw error;
  return (data as Report) ?? null;
}

export async function getConsents(studentId: string): Promise<Consent[]> {
  if (isDemoMode) return demoConsents.filter((c) => c.profile_id === studentId);
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("consents").select("*").eq("profile_id", studentId);
  if (error) {
    // Fail closed (no consents → recording stays disabled) rather than
    // crashing the lesson page.
    console.error("getConsents failed:", error.message);
    return [];
  }
  return (data ?? []) as Consent[];
}

export async function getBalance(studentId: string): Promise<number> {
  if (isDemoMode) return demoBalances.find((b) => b.student_id === studentId)?.balance ?? 0;
  const supabase = createSupabaseServerClient()!;
  const { data } = await supabase.from("credit_balances").select("balance").eq("student_id", studentId).maybeSingle();
  return (data?.balance as number) ?? 0;
}
