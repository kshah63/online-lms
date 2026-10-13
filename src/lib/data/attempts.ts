import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import {
  demoAnswerQuestion,
  demoAssignPractice,
  demoAttemptQuestions,
  demoCourseQuestions,
  demoCreatePracticeSet,
  demoFlaggedAttemptReview,
  demoIntegrityCameraConsent,
  demoLiveAttempts,
  demoLogIntegrityEvent,
  demoLogLessonEvent,
  demoMyAttemptRecord,
  demoMyPractice,
  demoStartAttempt,
  demoStudentSessionAssignments,
  demoSubmitAttempt,
  demoUpsertQuestion,
  demoVoidAttempt,
  modelOf,
} from "@/lib/demo/attempts";
import type { Question, QuestionType, McqOption } from "@/lib/practice/model";
import type {
  AnswerVerdict,
  AssignmentMode,
  AttemptQuestionRow,
  AttemptRecord,
  AttemptReview,
  LiveAttempt,
  PracticeKind,
  PracticeRow,
  SubmitResult,
} from "@/lib/practice/attempts";
import type { Profile } from "@/lib/types";

// ============================================================================
// The practice seam: mv-app's practice_* tables reached through its RPCs only
// (CONTRACTS-stage4 §B), under the caller's own session — there is no service
// role in this app. Every call here has a demo twin in src/lib/demo/attempts.ts
// that applies the same rules in memory. An RPC error is surfaced as a
// sentence, never swallowed; the pages decide what to do with it.
// ============================================================================

const SNAPSHOT_BUCKET = "test-snapshots";
const IMAGE_BUCKET = "practice-images";

/** rpc my_practice(p_days): the viewer's rows (student own, parent household, teacher assigned_by, in-charge room, admin all). */
export async function listMyPractice(viewer: Profile, days = 30): Promise<PracticeRow[]> {
  if (isDemoMode) return demoMyPractice(viewer, days);
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("my_practice", { p_days: days });
  if (error) throw new Error(`my_practice failed: ${error.message}`);
  return ((data ?? []) as PracticeRow[]).map((r) => ({ ...r, integrity_flagged: Boolean(r.integrity_flagged), question_count: Number(r.question_count ?? 0) }));
}

/** The viewer's row for one attempt or assignment, by id (null when it is not in their list). */
export async function findMyPracticeRow(viewer: Profile, id: string, days = 90): Promise<PracticeRow | null> {
  const rows = await listMyPractice(viewer, days);
  return rows.find((r) => r.attempt_id === id) ?? rows.find((r) => r.assignment_id === id) ?? null;
}

/** rpc start_attempt(p_assignment_id): returns the open attempt's id, or a new one. The student only. */
export async function startAttempt(viewer: Profile, assignmentId: string): Promise<string> {
  if (isDemoMode) return demoStartAttempt(viewer, assignmentId);
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("start_attempt", { p_assignment_id: assignmentId });
  if (error) throw new Error(`start_attempt failed: ${error.message}`);
  if (typeof data !== "string" || !data) throw new Error("start_attempt returned no attempt id.");
  return data;
}

const ATTEMPT_COLUMNS = "id, assignment_id, set_id, student_id, session_id, started_at, submitted_at, time_limit_minutes, score, out_of, integrity_flagged, integrity_summary, status";

/** One practice_attempts row under RLS (the student's own, the family's, the assigner's), or null. */
export async function getMyAttempt(viewer: Profile, attemptId: string): Promise<AttemptRecord | null> {
  if (isDemoMode) return demoMyAttemptRecord(viewer, attemptId);
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("practice_attempts").select(ATTEMPT_COLUMNS).eq("id", attemptId).maybeSingle();
  if (error) throw new Error(`practice_attempts failed: ${error.message}`);
  if (!data) return null;
  const r = data as AttemptRecord;
  return { ...r, integrity_flagged: Boolean(r.integrity_flagged) };
}

/** rpc attempt_questions(p_attempt_id): the set's questions with the caller's responses; answers masked while in progress. */
export async function getAttemptQuestions(viewer: Profile, attemptId: string): Promise<AttemptQuestionRow[]> {
  if (isDemoMode) return demoAttemptQuestions(viewer, attemptId);
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("attempt_questions", { p_attempt_id: attemptId });
  if (error) throw new Error(`attempt_questions failed: ${error.message}`);
  const rows = (Array.isArray(data) ? data : []) as AttemptQuestionRow[];
  return rows.sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * Signed URLs for the stems' images (bucket practice-images), under the
 * caller's session. A path the caller may not read comes back without a URL
 * and the question renders without its image rather than failing the attempt.
 */
export async function signQuestionImages(rows: AttemptQuestionRow[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const paths = rows.map((r) => r.image_path).filter((p): p is string => Boolean(p));
  if (isDemoMode || paths.length === 0) return out;
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls(paths, 60 * 60);
  if (error) {
    console.error("practice-images signing failed:", error.message);
    return out;
  }
  for (const d of data ?? []) if (d.signedUrl && d.path) out.set(d.path, d.signedUrl);
  return out;
}

/** rpc answer_question: upserts the response, auto-marks, returns the verdict and never the answer. */
export async function answerQuestion(viewer: Profile, attemptId: string, questionId: string, response: Record<string, unknown>): Promise<AnswerVerdict> {
  if (isDemoMode) return demoAnswerQuestion(viewer, attemptId, questionId, response);
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("answer_question", { p_attempt_id: attemptId, p_question_id: questionId, p_response: response });
  if (error) throw new Error(`answer_question failed: ${error.message}`);
  const v = (data ?? {}) as Partial<AnswerVerdict>;
  return { is_correct: v.is_correct ?? null, marks_awarded: v.marks_awarded ?? null, status: v.status ?? (v.is_correct == null ? "pending_review" : v.is_correct ? "correct" : "incorrect") };
}

/** rpc submit_attempt: totals the attempt and stores the integrity summary. */
export async function submitAttempt(viewer: Profile, attemptId: string, integritySummary: Record<string, unknown> | null): Promise<SubmitResult> {
  if (isDemoMode) return demoSubmitAttempt(viewer, attemptId, integritySummary);
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("submit_attempt", { p_attempt_id: attemptId, p_integrity_summary: integritySummary });
  if (error) throw new Error(`submit_attempt failed: ${error.message}`);
  const r = (data ?? {}) as Partial<SubmitResult>;
  return { score: Number(r.score ?? 0), out_of: Number(r.out_of ?? 0), status: r.status ?? "submitted" };
}

/** rpc log_integrity_event: append only, by the student while in progress. */
export async function logIntegrityEvent(viewer: Profile, attemptId: string, kind: string, detail: string | null, snapshotPath: string | null): Promise<void> {
  if (isDemoMode) return demoLogIntegrityEvent(viewer, attemptId, kind, detail, snapshotPath);
  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.rpc("log_integrity_event", { p_attempt_id: attemptId, p_kind: kind, p_detail: detail, p_snapshot_path: snapshotPath });
  if (error) throw new Error(`log_integrity_event failed: ${error.message}`);
}

/** rpc void_attempt: the assigner, manages_course or admin. */
export async function voidAttempt(viewer: Profile, attemptId: string): Promise<void> {
  if (isDemoMode) return demoVoidAttempt(viewer, attemptId);
  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.rpc("void_attempt", { p_attempt_id: attemptId });
  if (error) throw new Error(`void_attempt failed: ${error.message}`);
}

/** rpc live_attempts(p_session_id): the attempts in a lesson, answers so far, for the host or an observer. */
export async function listLiveAttempts(viewer: Profile, sessionId: string): Promise<LiveAttempt[]> {
  if (isDemoMode) return demoLiveAttempts(viewer, sessionId);
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("live_attempts", { p_session_id: sessionId });
  if (error) throw new Error(`live_attempts failed: ${error.message}`);
  return (Array.isArray(data) ? data : []) as LiveAttempt[];
}

/** rpc flagged_attempt_review(p_attempt_id): the attempt, its integrity timeline and answers. */
export async function getAttemptReview(viewer: Profile, attemptId: string): Promise<AttemptReview> {
  if (isDemoMode) return demoFlaggedAttemptReview(viewer, attemptId);
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("flagged_attempt_review", { p_attempt_id: attemptId });
  if (error) throw new Error(`flagged_attempt_review failed: ${error.message}`);
  const r = (data ?? {}) as Partial<AttemptReview>;
  if (!r.attempt) throw new Error("flagged_attempt_review returned no attempt.");
  return { attempt: r.attempt, events: Array.isArray(r.events) ? r.events : [], answers: Array.isArray(r.answers) ? r.answers : [] };
}

/** Signed URLs for the snapshots in a timeline (bucket test-snapshots), under the reviewer's session. Demo has no files. */
export async function signSnapshots(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(paths)].filter(Boolean);
  if (isDemoMode || unique.length === 0) return out;
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.storage.from(SNAPSHOT_BUCKET).createSignedUrls(unique, 10 * 60);
  if (error) throw new Error(`test-snapshots signing failed: ${error.message}`);
  for (const d of data ?? []) if (d.signedUrl && d.path) out.set(d.path, d.signedUrl);
  return out;
}

/** lesson_consents.integrity_camera for a student, read under RLS (the family's own row, or staff). */
export async function hasIntegrityCameraConsent(viewer: Profile, studentId: string): Promise<boolean> {
  if (isDemoMode) return demoIntegrityCameraConsent(viewer, studentId);
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("lesson_consents")
    .select("student_id")
    .eq("student_id", studentId)
    .eq("kind", "integrity_camera")
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error(`lesson_consents failed: ${error.message}`);
  return Boolean(data);
}

// --- the activity panel's host side --------------------------------------------------------

/** A practice_questions row the host may pick for a quick check (approved on the course, or their own draft). */
export interface BankQuestion {
  id: string;
  status: "draft" | "approved" | "retired";
  question: Question;
}

const QUESTION_COLUMNS = "id, course_id, syllabus_topic_id, type, stem, options, answer, tolerance, unit, accepted, difficulty, marks, worked_solution, image_path, status, created_by";

/** The course's approved questions plus the caller's drafts, under RLS (a host sees approved rows on the course within ±14 days of a session). */
export async function listCourseQuestions(viewer: Profile, courseId: string): Promise<BankQuestion[]> {
  if (isDemoMode) return demoCourseQuestions(viewer, courseId).map((q) => ({ id: q.id, status: q.status, question: modelOf(q) }));
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("practice_questions")
    .select(QUESTION_COLUMNS)
    .eq("course_id", courseId)
    .in("status", ["approved", "draft"])
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`practice_questions failed: ${error.message}`);
  return (data ?? [])
    .map((r) => r as Record<string, unknown>)
    .filter((r) => r.status === "approved" || r.created_by === viewer.id)
    .map((r) => ({ id: String(r.id), status: r.status as BankQuestion["status"], question: bankRowToQuestion(r) }));
}

function bankRowToQuestion(r: Record<string, unknown>): Question {
  const base = {
    id: String(r.id),
    stem: String(r.stem ?? ""),
    image_url: null,
    topic_id: (r.syllabus_topic_id as string | null) ?? null,
    topic_label: null,
    difficulty: (Number(r.difficulty ?? 3) as 1 | 2 | 3 | 4 | 5) || 3,
    marks: Number(r.marks ?? 1) || 1,
    worked_solution: (r.worked_solution as string | null) ?? null,
    source: { kind: "manual" as const },
  };
  const options = Array.isArray(r.options) ? (r.options as McqOption[]) : [];
  switch (r.type as QuestionType) {
    case "mcq":
      return { ...base, type: "mcq", options, answer: String(r.answer ?? "") };
    case "multi_select":
      return { ...base, type: "multi_select", options, answers: Array.isArray(r.answer) ? (r.answer as unknown[]).map(String) : [] };
    case "numeric":
      return { ...base, type: "numeric", answer: Number(r.answer), tolerance: (r.tolerance as number | null) ?? null, unit: (r.unit as string | null) ?? null };
    case "short":
      return { ...base, type: "short", answers: [String(r.answer ?? ""), ...(Array.isArray(r.accepted) ? (r.accepted as unknown[]).map(String) : [])] };
    case "worked":
    default:
      return { ...base, type: "worked", marking_scheme: "", final_answer: null };
  }
}

/** A one-off question the host writes in the room: mcq or numeric, saved as a draft through rpc upsert_question. */
export interface OneOffQuestion {
  type: "mcq" | "numeric";
  stem: string;
  options?: McqOption[];
  answer: string | number;
  unit?: string | null;
  marks: number;
}

export async function createDraftQuestion(viewer: Profile, courseId: string, q: OneOffQuestion): Promise<string> {
  if (isDemoMode) return demoUpsertQuestion(viewer, courseId, { type: q.type, stem: q.stem, options: q.options ?? null, answer: q.answer, unit: q.unit ?? null, marks: q.marks, difficulty: 3 });
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("upsert_question", {
    p_course_id: courseId,
    p_question: { id: null, type: q.type, stem: q.stem, options: q.options ?? null, answer: q.answer, unit: q.unit ?? null, marks: q.marks, difficulty: 3, source: { kind: "manual" } },
  });
  if (error) throw new Error(`upsert_question failed: ${error.message}`);
  if (typeof data !== "string" || !data) throw new Error("upsert_question returned no id.");
  return data;
}

/** rpc create_practice_set(kind quick_check, p_session_id) for the host. */
export async function createQuickCheckSet(viewer: Profile, input: { courseId: string; sessionId: string; title: string; questionIds: string[] }): Promise<string> {
  if (isDemoMode) return demoCreatePracticeSet(viewer, { course_id: input.courseId, kind: "quick_check", title: input.title, question_ids: input.questionIds, session_id: input.sessionId });
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("create_practice_set", {
    p_course_id: input.courseId,
    p_kind: "quick_check" satisfies PracticeKind,
    p_title: input.title,
    p_question_ids: input.questionIds,
    p_topic_id: null,
    p_time_limit_minutes: null,
    p_integrity_settings: {},
    p_session_id: input.sessionId,
  });
  if (error) throw new Error(`create_practice_set failed: ${error.message}`);
  if (typeof data !== "string" || !data) throw new Error("create_practice_set returned no id.");
  return data;
}

/** rpc assign_practice(in_session) for the host: the session's student only. */
export async function assignInSession(viewer: Profile, input: { setId: string; studentId: string; sessionId: string }): Promise<number> {
  if (isDemoMode) return demoAssignPractice(viewer, { set_id: input.setId, student_ids: [input.studentId], mode: "in_session", session_id: input.sessionId });
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("assign_practice", {
    p_set_id: input.setId,
    p_student_ids: [input.studentId],
    p_mode: "in_session" satisfies AssignmentMode,
    p_session_id: input.sessionId,
    p_due_at: null,
  });
  if (error) throw new Error(`assign_practice failed: ${error.message}`);
  return Number(data ?? 0);
}

/** The student's own practice_assignments rows for a session (RLS: the student), newest first. */
export async function listMySessionAssignments(viewer: Profile, sessionId: string): Promise<{ id: string; set_id: string; created_at: string }[]> {
  if (isDemoMode) return demoStudentSessionAssignments(viewer, sessionId).map((a) => ({ id: a.id, set_id: a.set_id, created_at: a.created_at }));
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("practice_assignments")
    .select("id, set_id, created_at")
    .eq("session_id", sessionId)
    .eq("student_id", viewer.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`practice_assignments failed: ${error.message}`);
  return (data ?? []) as { id: string; set_id: string; created_at: string }[];
}

/** The oral check: rpc log_lesson_event kind quick_check_result {name, score, out_of, otr}. */
export async function recordQuickCheckResult(viewer: Profile, sessionId: string, payload: { name: string; score: number; out_of: number; otr: number | null }): Promise<void> {
  if (isDemoMode) return demoLogLessonEvent(viewer, sessionId, "quick_check_result", payload);
  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.rpc("log_lesson_event", { p_session_id: sessionId, p_kind: "quick_check_result", p_payload: payload });
  if (error) throw new Error(`log_lesson_event failed: ${error.message}`);
}
