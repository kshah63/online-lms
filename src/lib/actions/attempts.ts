"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/data/auth";
import { getLessonRoomState } from "@/lib/data/lessons";
import {
  answerQuestion,
  assignInSession,
  createDraftQuestion,
  createQuickCheckSet,
  findMyPracticeRow,
  getAttemptQuestions,
  listCourseQuestions,
  listLiveAttempts,
  listMySessionAssignments,
  listMyPractice,
  logIntegrityEvent,
  recordQuickCheckResult,
  signQuestionImages,
  startAttempt,
  submitAttempt,
  voidAttempt,
  type BankQuestion,
  type OneOffQuestion,
} from "@/lib/data/attempts";
import { attemptPath, responsePayload, type AnswerVerdict, type AttemptQuestionRow, type LiveAttempt, type PracticeKind, type PracticeRow, type SubmitResult } from "@/lib/practice/attempts";
import type { Response } from "@/lib/practice/model";
import type { ActionResult } from "@/lib/actions/types";
import type { Profile } from "@/lib/types";

// ============================================================================
// The room's writes to practice, through mv-app's RPCs only (src/lib/data/
// attempts.ts). Every action resolves the signed-in profile first; the
// database then applies its own rules, and a refusal is returned as the
// sentence it came with.
// ============================================================================

async function me(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("You are not signed in.");
  return profile;
}

/** The Start / Continue button on /home/practice: rpc start_attempt, then the runner for the set's kind. */
export async function openAssignmentAction(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignment_id") ?? "");
  const kind = String(formData.get("kind") ?? "practice") as PracticeKind;
  const viewer = await me();
  if (kind === "test") {
    // The pre-flight page starts the attempt itself, so the timer only runs once the student has read the rules.
    redirect(`/test/${assignmentId}`);
  }
  const attemptId = await startAttempt(viewer, assignmentId);
  redirect(attemptPath(kind, attemptId));
}

/** rpc start_attempt for a client caller (the activity panel, the test pre-flight). */
export async function startAttemptAction(assignmentId: string): Promise<{ attemptId: string }> {
  const viewer = await me();
  return { attemptId: await startAttempt(viewer, assignmentId) };
}

/** The pre-flight's Begin: start the attempt and land on it. */
export async function beginTestAction(formData: FormData): Promise<void> {
  const assignmentId = String(formData.get("assignment_id") ?? "");
  const viewer = await me();
  const attemptId = await startAttempt(viewer, assignmentId);
  redirect(`/test/${attemptId}`);
}

export interface LoadedAttempt {
  row: PracticeRow | null;
  questions: AttemptQuestionRow[];
  imageUrls: Record<string, string>;
}

/** rpc attempt_questions plus the viewer's my_practice row, for a client that reloads after submitting. */
export async function loadAttemptAction(attemptId: string): Promise<LoadedAttempt> {
  const viewer = await me();
  const [row, questions] = await Promise.all([findMyPracticeRow(viewer, attemptId), getAttemptQuestions(viewer, attemptId)]);
  const signed = await signQuestionImages(questions);
  return { row, questions, imageUrls: Object.fromEntries(signed) };
}

/** rpc answer_question: saves one response and returns the verdict (never the answer). */
export async function answerQuestionAction(attemptId: string, questionId: string, response: Response): Promise<AnswerVerdict> {
  const viewer = await me();
  return answerQuestion(viewer, attemptId, questionId, responsePayload(response));
}

/** rpc submit_attempt with the integrity summary (null for practice). */
export async function submitAttemptAction(attemptId: string, integritySummary: Record<string, unknown> | null): Promise<SubmitResult> {
  const viewer = await me();
  const result = await submitAttempt(viewer, attemptId, integritySummary);
  revalidatePath("/home/practice");
  return result;
}

/** rpc log_integrity_event: one row per engine event, snapshot or pause. */
export async function logIntegrityEventAction(attemptId: string, kind: string, detail: string | null = null, snapshotPath: string | null = null): Promise<void> {
  const viewer = await me();
  await logIntegrityEvent(viewer, attemptId, kind, detail, snapshotPath);
}

/** rpc void_attempt, from the review page's confirmation. */
export async function voidAttemptAction(attemptId: string): Promise<ActionResult> {
  try {
    const viewer = await me();
    await voidAttempt(viewer, attemptId);
    revalidatePath(`/tests/${attemptId}`);
    revalidatePath("/home/practice");
    return { ok: true, message: "The attempt has been voided." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The attempt could not be voided." };
  }
}

// --- the activity panel ---------------------------------------------------------------

export interface ActivityContext {
  courseId: string;
  studentId: string;
  studentName: string;
  questions: BankQuestion[];
}

/** What the host needs to compose a quick check: the session's course and student (lesson_room_state) and the course's questions. */
export async function activityContextAction(sessionId: string): Promise<ActivityContext> {
  const viewer = await me();
  const state = await getLessonRoomState(viewer, sessionId);
  if (!state || state.seat !== "host") throw new Error("Only the host can send a quick check in this lesson.");
  if (!state.course_id || !state.student_id) throw new Error("This lesson has no course or student to send a quick check to.");
  const questions = await listCourseQuestions(viewer, state.course_id);
  return { courseId: state.course_id, studentId: state.student_id, studentName: state.student_name, questions };
}

/** A one-off mcq or numeric question written in the room, saved as a draft on the course (rpc upsert_question). */
export async function addOneOffQuestionAction(sessionId: string, q: OneOffQuestion): Promise<BankQuestion> {
  const viewer = await me();
  const state = await getLessonRoomState(viewer, sessionId);
  if (!state || state.seat !== "host" || !state.course_id) throw new Error("Only the host can write a question for this lesson.");
  const id = await createDraftQuestion(viewer, state.course_id, q);
  const base = { id, stem: q.stem, image_url: null, topic_id: null, topic_label: null, difficulty: 3 as const, marks: q.marks, worked_solution: null, source: { kind: "manual" as const } };
  const question = q.type === "mcq" ? { ...base, type: "mcq" as const, options: q.options ?? [], answer: String(q.answer) } : { ...base, type: "numeric" as const, answer: Number(q.answer), unit: q.unit ?? null };
  return { id, status: "draft", question };
}

/** The host sends a quick check: create_practice_set(quick_check, p_session_id) then assign_practice(in_session) to the session's student. */
export async function pushQuickCheckAction(input: { sessionId: string; title: string; questionIds: string[] }): Promise<{ setId: string; assignmentId: string | null }> {
  const viewer = await me();
  const state = await getLessonRoomState(viewer, input.sessionId);
  if (!state || state.seat !== "host" || !state.course_id || !state.student_id) throw new Error("Only the host can send a quick check in this lesson.");
  const setId = await createQuickCheckSet(viewer, { courseId: state.course_id, sessionId: input.sessionId, title: input.title, questionIds: input.questionIds });
  const n = await assignInSession(viewer, { setId, studentId: state.student_id, sessionId: input.sessionId });
  if (n === 0) throw new Error("The student already has this quick check open.");
  const rows = await listMyPractice(viewer, 1);
  const assignment = rows.find((r) => r.set_id === setId && r.student_id === state.student_id) ?? null;
  return { setId, assignmentId: assignment?.assignment_id ?? null };
}

/** rpc live_attempts(p_session_id) for the host's live view (refreshed by realtime or a poll). */
export async function liveAttemptsAction(sessionId: string): Promise<LiveAttempt[]> {
  const viewer = await me();
  return listLiveAttempts(viewer, sessionId);
}

/** The student's newest quick check in this session, with its my_practice row (null when nothing has been sent). */
export async function myOpenActivityAction(sessionId: string): Promise<PracticeRow | null> {
  const viewer = await me();
  const assignments = await listMySessionAssignments(viewer, sessionId);
  if (assignments.length === 0) return null;
  const rows = await listMyPractice(viewer, 2);
  for (const a of assignments) {
    const row = rows.find((r) => r.assignment_id === a.id);
    if (row) return row;
  }
  return null;
}

/** The oral check: lesson_events kind quick_check_result {name, score, out_of, otr}. */
export async function recordOralCheckAction(sessionId: string, payload: { name: string; score: number; out_of: number; otr: number | null }): Promise<ActionResult> {
  try {
    const viewer = await me();
    await recordQuickCheckResult(viewer, sessionId, payload);
    return { ok: true, message: `Recorded ${payload.name}: ${payload.score}/${payload.out_of}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The oral check could not be recorded." };
  }
}
