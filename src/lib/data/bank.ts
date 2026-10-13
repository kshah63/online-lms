import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { demoCourseMaterials, demoCourses } from "@/lib/demo/data";
import { demoCourseStudents, demoPracticeSets, demoQuestions } from "@/lib/demo/bank";
import { demoManagedCourses } from "@/lib/permissions-bank";
import { BANK_QUESTION_COLUMNS, PRACTICE_SET_COLUMNS, type BankQuestion, type CourseStudent, type PracticeSetRow } from "@/lib/bank/types";
import { displayName, type Course, type Profile } from "@/lib/types";

// ============================================================================
// The question bank's reads. practice_questions and practice_sets come back
// under RLS (manages_course or admin sees every status; nobody else reaches
// this page); the courses a viewer manages mirror manages_course's rule from
// the rows the authenticated role may read (department_members for one's own
// seats, routing_rules and courses for everyone). Every write is an RPC in
// src/lib/actions/bank.ts.
// ============================================================================

const QUESTION_LIMIT = 500;

/** The courses the viewer manages: every course for an admin, their in-charge departments' courses otherwise. */
export async function listManagedCourses(viewer: Profile): Promise<Course[]> {
  if (isDemoMode) return demoManagedCourses(viewer);

  const supabase = createSupabaseServerClient()!;
  if (viewer.role === "admin") {
    const { data, error } = await supabase.from("courses").select("id, name, department_id, group_name").order("name");
    if (error) throw new Error(`courses failed: ${error.message}`);
    return (data ?? []) as Course[];
  }
  if (viewer.role !== "staff" && viewer.role !== "support") return [];

  const seats = await supabase.from("department_members").select("department_id").eq("user_id", viewer.id).eq("is_incharge", true);
  if (seats.error) throw new Error(`department_members failed: ${seats.error.message}`);
  const departments = [...new Set((seats.data ?? []).map((r) => String((r as { department_id: string }).department_id)))];
  if (departments.length === 0) return [];

  const [own, routed] = await Promise.all([
    supabase.from("courses").select("id, name, department_id, group_name").in("department_id", departments),
    supabase.from("routing_rules").select("course_id").in("department_id", departments).eq("is_active", true),
  ]);
  if (own.error) throw new Error(`courses failed: ${own.error.message}`);
  if (routed.error) throw new Error(`routing_rules failed: ${routed.error.message}`);

  const have = new Set((own.data ?? []).map((c) => String((c as Course).id)));
  const extra = [...new Set((routed.data ?? []).map((r) => String((r as { course_id: string }).course_id)))].filter((id) => !have.has(id));
  let more: Course[] = [];
  if (extra.length) {
    const { data, error } = await supabase.from("courses").select("id, name, department_id, group_name").in("id", extra);
    if (error) throw new Error(`courses failed: ${error.message}`);
    more = (data ?? []) as Course[];
  }
  return [...((own.data ?? []) as Course[]), ...more].sort((a, b) => a.name.localeCompare(b.name));
}

/** One course by id (the catalogue is readable by every signed-in user). */
export async function getCourse(courseId: string): Promise<Course | null> {
  if (isDemoMode) return demoCourses.find((c) => c.id === courseId) ?? null;
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("courses").select("id, name, department_id, group_name").eq("id", courseId).maybeSingle();
  if (error) throw new Error(`courses failed: ${error.message}`);
  return (data as Course | null) ?? null;
}

/** The course's questions in every status, newest first; says when the list stops. */
export async function listQuestions(courseId: string): Promise<{ rows: BankQuestion[]; total: number }> {
  if (isDemoMode) {
    const rows = demoQuestions.filter((q) => q.course_id === courseId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return { rows, total: rows.length };
  }
  const supabase = createSupabaseServerClient()!;
  const { data, error, count } = await supabase
    .from("practice_questions")
    .select(BANK_QUESTION_COLUMNS, { count: "exact" })
    .eq("course_id", courseId)
    .order("created_at", { ascending: false })
    .limit(QUESTION_LIMIT);
  if (error) throw new Error(`practice_questions failed: ${error.message}`);
  const rows = ((data ?? []) as unknown as BankQuestion[]).map(normaliseQuestion);
  return { rows, total: count ?? rows.length };
}

/** One question the viewer may read, or null. */
export async function getQuestion(id: string): Promise<BankQuestion | null> {
  if (isDemoMode) return demoQuestions.find((q) => q.id === id) ?? null;
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("practice_questions").select(BANK_QUESTION_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`practice_questions failed: ${error.message}`);
  return data ? normaliseQuestion(data as unknown as BankQuestion) : null;
}

function normaliseQuestion(row: BankQuestion): BankQuestion {
  return {
    ...row,
    difficulty: (Math.min(5, Math.max(1, Number(row.difficulty) || 3)) as BankQuestion["difficulty"]),
    marks: Number(row.marks) || 1,
    tolerance: row.tolerance == null ? null : Number(row.tolerance),
    accepted: Array.isArray(row.accepted) ? row.accepted.map(String) : null,
    source: row.source && typeof row.source === "object" ? row.source : { kind: "manual" },
  };
}

/** The course's practice and test sets (quick checks belong to lessons), newest first, with item counts. */
export async function listPracticeSets(courseId: string): Promise<PracticeSetRow[]> {
  if (isDemoMode) return demoPracticeSets.filter((s) => s.course_id === courseId);
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("practice_sets")
    .select(`${PRACTICE_SET_COLUMNS}, practice_set_items(count)`)
    .eq("course_id", courseId)
    .in("kind", ["practice", "test"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`practice_sets failed: ${error.message}`);
  return ((data ?? []) as unknown as (PracticeSetRow & { practice_set_items?: { count: number }[] })[]).map((s) => ({
    id: s.id,
    course_id: s.course_id,
    kind: s.kind,
    title: s.title,
    syllabus_topic_id: s.syllabus_topic_id,
    time_limit_minutes: s.time_limit_minutes,
    integrity_settings: s.integrity_settings ?? {},
    status: s.status,
    created_at: s.created_at,
    question_count: s.practice_set_items?.[0]?.count ?? 0,
  }));
}

/** The students enrolled on the course (student_courses, then the profile columns the office may read), by name. */
export async function listCourseStudents(courseId: string): Promise<CourseStudent[]> {
  if (isDemoMode) return demoCourseStudents(courseId);
  const supabase = createSupabaseServerClient()!;
  const enrolled = await supabase.from("student_courses").select("student_id").eq("course_id", courseId).limit(500);
  if (enrolled.error) throw new Error(`student_courses failed: ${enrolled.error.message}`);
  const ids = [...new Set((enrolled.data ?? []).map((r) => String((r as { student_id: string }).student_id)))];
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("profiles").select("id, full_name, preferred_name, grade_level").in("id", ids).is("deactivated_at", null);
  if (error) throw new Error(`profiles failed: ${error.message}`);
  return ((data ?? []) as { id: string; full_name: string; preferred_name: string | null; grade_level: string | null }[])
    .map((p) => ({ id: p.id, name: displayName(p), grade_level: p.grade_level }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The materials portal's course for an mv-app course (lesson_course_materials), or null when an admin has not mapped it. */
export async function getMaterialsCourseId(courseId: string): Promise<string | null> {
  if (isDemoMode) return demoCourseMaterials[courseId] ?? null;
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("lesson_course_materials").select("materials_course_id").eq("course_id", courseId).maybeSingle();
  if (error) throw new Error(`lesson_course_materials failed: ${error.message}`);
  return (data?.materials_course_id as string | null) ?? null;
}

/** A one-hour signed URL for a practice-images object under the viewer's session (the bucket policy decides). */
export async function signedImageUrl(imagePath: string | null): Promise<string | null> {
  if (!imagePath) return null;
  if (isDemoMode) return null;
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.storage.from("practice-images").createSignedUrl(imagePath, 3600);
  if (error) throw new Error(`practice-images failed: ${error.message}`);
  return data?.signedUrl ?? null;
}
