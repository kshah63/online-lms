import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import {
  demoBalances,
  demoConsents,
  demoCourses,
  demoEnrollments,
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

/** All enrollments as (course_id, student) pairs — for the admin courses page. */
export async function listEnrollments(): Promise<{ course_id: string; student: Pick<Profile, "id" | "display_name"> }[]> {
  if (isDemoMode) {
    const out: { course_id: string; student: Pick<Profile, "id" | "display_name"> }[] = [];
    for (const [studentId, courseIds] of Object.entries(demoEnrollments)) {
      const s = demoProfiles.find((p) => p.id === studentId);
      if (!s) continue;
      for (const course_id of courseIds) out.push({ course_id, student: { id: s.id, display_name: s.display_name } });
    }
    return out;
  }
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("enrollments")
    .select("course_id, student:profiles!enrollments_student_id_fkey(id,display_name)");
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({ course_id: r.course_id, student: r.student }));
}

export interface AccountRequest {
  id: string;
  role: "teacher" | "student" | "parent";
  display_name: string;
  email: string;
  phone: string | null;
  timezone: string;
  message: string | null;
  created_at: string;
}

/** Pending account requests for the admin to approve/reject. */
export async function getPendingAccountRequests(): Promise<AccountRequest[]> {
  if (isDemoMode) {
    return [
      {
        id: "ar-demo-1",
        role: "student",
        display_name: "Noah Williams",
        email: "noah@example.com",
        phone: "+447700900111",
        timezone: "Europe/London",
        message: "Looking for weekly A-Level Physics help.",
        created_at: new Date().toISOString(),
      },
    ];
  }
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("account_requests")
    .select("id, role, display_name, email, phone, timezone, message, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AccountRequest[];
}

export interface EnrollmentRequestView {
  id: string;
  created_at: string;
  student: { id: string; display_name: string };
  course: { id: string; name: string };
}

/** Pending enrollment requests for the admin to approve/deny. */
export async function getPendingEnrollmentRequests(): Promise<EnrollmentRequestView[]> {
  if (isDemoMode) {
    // One illustrative pending request: Lena → SAT Math Prep.
    return [
      {
        id: "er-demo-1",
        created_at: new Date().toISOString(),
        student: { id: "00000000-0000-0000-0000-0000000000b3", display_name: "Lena Park" },
        course: { id: "10000000-0000-0000-0000-000000000002", name: "SAT Math Prep" },
      },
    ];
  }
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("enrollment_requests")
    .select(
      "id, created_at, student:profiles!enrollment_requests_student_id_fkey(id,display_name), course:courses(id,name)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({ id: r.id, created_at: r.created_at, student: r.student, course: r.course }));
}

/** Courses a student is enrolled in (what they can book a lesson for). */
export async function getEnrolledCourses(studentId: string): Promise<Course[]> {
  if (isDemoMode) {
    const ids = (demoEnrollments[studentId] ?? []);
    return demoCourses.filter((c) => ids.includes(c.id));
  }
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("enrollments")
    .select("course:courses(*)")
    .eq("student_id", studentId);
  if (error) throw error;
  return ((data ?? []) as unknown as { course: Course }[]).map((r) => r.course).filter(Boolean);
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
