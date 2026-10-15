import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";
import {
  buildDemoSessions,
  demoConsents,
  demoCourses,
  demoEnrollments,
  demoParentStudent,
  demoProfiles,
  demoRecordingOptOuts,
  demoReports,
  demoTeacherCourse,
} from "@/lib/demo/data";
import type { Consent, Course, Profile, RecordingOptOut, Report } from "@/lib/types";

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

/**
 * Historical consent rows. Since the Pencil Spaces room (0017) NOTHING is gated
 * on these: recording is opt-out (`recording_opt_outs`, see below) and teacher
 * AI evaluation is mandatory. Kept for history/reporting only.
 */
export async function getConsents(studentId: string): Promise<Consent[]> {
  if (isDemoMode) return demoConsents.filter((c) => c.profile_id === studentId);
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("consents").select("*").eq("profile_id", studentId);
  if (error) {
    console.error("getConsents failed:", error.message);
    return [];
  }
  return (data ?? []) as Consent[];
}

// ---------------------------------------------------------------------------
// Pencil Spaces (0017) — recording policy + Pencil identity.
//
// `recording_opt_outs` and `pencil_users` are SERVICE-ONLY tables (admin-read
// RLS), so these helpers go through the service-role client. They are read
// helpers only; the single writer is `setRecordingOptOut` in
// src/lib/actions/people.ts. For a single student on the lesson path use
// `isRecordingOptedOut` / `getPencilUser` from src/lib/pencil/provision.ts.
// ---------------------------------------------------------------------------

/** Every recording opt-out (admin people page). Empty when the service role isn't configured. */
export async function listRecordingOptOuts(): Promise<RecordingOptOut[]> {
  if (isDemoMode) return demoRecordingOptOuts;
  const admin = createSupabaseAdminClient();
  if (!admin) return [];
  const { data, error } = await admin.from("recording_opt_outs").select("*").order("set_at", { ascending: false });
  if (error) {
    console.error("listRecordingOptOuts failed:", error.message);
    return [];
  }
  return (data ?? []) as RecordingOptOut[];
}

/**
 * Which of `studentIds` are opted out of recording — for the "Recorded /
 * Not recorded" indicator on session cards. Callers pass only students the
 * viewer may see (their own id / their children). Returns NULL when the flag
 * can't be read (no service-role key, query error) so the UI shows nothing
 * rather than a wrong "Recorded".
 */
export async function getRecordingOptOutSet(studentIds: readonly string[]): Promise<Set<string> | null> {
  const ids = Array.from(new Set(studentIds));
  if (ids.length === 0) return new Set();
  if (isDemoMode) {
    return new Set(demoRecordingOptOuts.filter((o) => ids.includes(o.student_id)).map((o) => o.student_id));
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.from("recording_opt_outs").select("student_id").in("student_id", ids);
  if (error) {
    console.error("getRecordingOptOutSet failed:", error.message);
    return null;
  }
  return new Set(((data ?? []) as { student_id: string }[]).map((r) => r.student_id));
}

/**
 * Profiles that already have a Pencil API user (a `pencil_users` row) — the
 * "Pencil linked" badge. Users are provisioned lazily on first join, so a
 * missing badge is normal for someone who hasn't had a lesson yet. Demo mode:
 * everyone who has been in a live or completed demo lesson.
 */
export async function listPencilLinkedProfileIds(): Promise<Set<string>> {
  if (isDemoMode) {
    const linked = new Set<string>();
    for (const s of buildDemoSessions()) {
      if (s.status !== "in_progress" && s.status !== "completed") continue;
      linked.add(s.student_id);
      if (s.teacher_id) linked.add(s.teacher_id);
    }
    return linked;
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return new Set();
  const { data, error } = await admin.from("pencil_users").select("profile_id");
  if (error) {
    console.error("listPencilLinkedProfileIds failed:", error.message);
    return new Set();
  }
  return new Set(((data ?? []) as { profile_id: string }[]).map((r) => r.profile_id));
}

