"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import { getCourse, getMaterialsCourseId, getQuestion } from "@/lib/data/bank";
import { listTopicOptions } from "@/lib/data/syllabus";
import { canManageCourse } from "@/lib/permissions-bank";
import { fetchFileBase64, fetchFileViewUrl } from "@/lib/materials/portal";
import { extractQuestionsFromPdf, extractionConfigured } from "@/lib/practice/extract";
import { matchTopic, type DraftQuestion } from "@/lib/practice/extract-parse";
import { SAMPLE_QUESTIONS } from "@/lib/practice/samples";
import { rateLimit } from "@/lib/rate-limit";
import { draftToPayload, draftToRow, editorToPayload, payloadToRow, questionToDraft } from "@/lib/bank/question-row";
import type { BankQuestion, IntegritySettings, PracticeSetRow, QuestionDraftInput, SetKind } from "@/lib/bank/types";
import type { ActionResult } from "@/lib/actions/types";
import type { Profile } from "@/lib/types";

// ============================================================================
// The question bank's writes, every one an mv-app RPC that re-checks
// manages_course itself: upsert_question, approve_question, retire_question,
// store_extracted_questions, create_practice_set, assign_practice. Extraction
// runs here with the room's Anthropic key and the materials portal's signed
// URLs, exactly as the lesson's worksheet path does. A refusal's message is
// shown as it came; demo mode answers with what the RPC would have done.
// ============================================================================

/** Worksheet extractions per person per hour: one Opus call each. */
const EXTRACT_LIMIT = { limit: 20, windowSeconds: 3600 };

async function manager(courseId: string): Promise<{ profile: Profile } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in." };
  if (!(await canManageCourse(profile, courseId))) return { error: "You do not manage this course." };
  return { profile };
}

/** Save a new or edited question through upsert_question; returns the row as the bank now holds it. */
export async function saveQuestionAction(courseId: string, form: QuestionDraftInput): Promise<ActionResult & { row?: BankQuestion }> {
  const m = await manager(courseId);
  if ("error" in m) return { ok: false, message: m.error };
  const built = editorToPayload(form);
  if (!built.ok) return { ok: false, message: built.message };
  const nowISO = new Date().toISOString();

  if (isDemoMode) {
    const existing = form.id ? await getQuestion(form.id) : null;
    const row = payloadToRow(built.payload, existing, courseId, randomUUID(), m.profile.id, nowISO);
    return { ok: true, message: `Demo mode: upsert_question would ${form.id ? "update" : "add"} this question as ${existing?.status ?? "a draft"}.`, row };
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("upsert_question", { p_course_id: courseId, p_question: built.payload });
  if (error) return { ok: false, message: error.message };
  const id = typeof data === "string" ? data : form.id;
  const row = id ? await getQuestion(id) : null;
  if (!row) return { ok: false, message: "The question was saved but could not be read back." };
  revalidatePath("/bank");
  return { ok: true, message: form.id ? "Question saved." : "Question added as a draft.", row };
}

/** approve_question: a draft becomes usable in sets. */
export async function approveQuestionAction(courseId: string, id: string): Promise<ActionResult> {
  const m = await manager(courseId);
  if ("error" in m) return { ok: false, message: m.error };
  if (isDemoMode) return { ok: true, message: "Demo mode: approve_question would mark this question approved." };
  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.rpc("approve_question", { p_id: id });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/bank");
  return { ok: true, message: "Question approved." };
}

/** retire_question: the row stays for the attempts that used it, and leaves the pick lists. */
export async function retireQuestionAction(courseId: string, id: string): Promise<ActionResult> {
  const m = await manager(courseId);
  if ("error" in m) return { ok: false, message: m.error };
  if (isDemoMode) return { ok: true, message: "Demo mode: retire_question would retire this question." };
  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.rpc("retire_question", { p_id: id });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/bank");
  return { ok: true, message: "Question retired." };
}

export interface ExtractWorksheetInput {
  courseId: string;
  worksheet: { fileId: string; name: string };
  answerKey: { fileId: string; name: string } | null;
  hints: string;
}

export interface ExtractWorksheetResult extends ActionResult {
  title: string;
  questions: DraftQuestion[];
  errors: string[];
}

/** Read the worksheet (and answer key) from the materials portal and extract draft questions; nothing is stored yet. */
export async function extractWorksheetAction(input: ExtractWorksheetInput): Promise<ExtractWorksheetResult> {
  const m = await manager(input.courseId);
  if ("error" in m) return { ok: false, message: m.error, title: "", questions: [], errors: [] };
  const topics = await listTopicOptions(input.courseId);

  if (isDemoMode) {
    // The sample questions stand in for what Claude would read off the PDF.
    const questions = SAMPLE_QUESTIONS.map((q, i) => {
      const d = questionToDraft(q, String(i + 1), input.worksheet.fileId);
      const topic = matchTopic(d.topic_label, topics);
      if (topic) return { ...d, topic_id: topic.id, topic_label: topic.label };
      return { ...d, review_notes: [...d.review_notes, d.topic_label ? `Proposed topic "${d.topic_label}" is not in the syllabus list.` : "No topic proposed."] };
    });
    return { ok: true, message: `Demo mode: ${questions.length} sample questions stand in for the extraction of ${input.worksheet.name}.`, title: input.worksheet.name.replace(/\.pdf$/i, ""), questions, errors: [] };
  }

  if (!extractionConfigured) return { ok: false, message: "ANTHROPIC_API_KEY is not configured, so worksheets cannot be extracted here.", title: "", questions: [], errors: [] };
  const allowed = await rateLimit(`ai:extract:${m.profile.id}`, EXTRACT_LIMIT.limit, EXTRACT_LIMIT.windowSeconds);
  if (!allowed) return { ok: false, message: "Too many extractions this hour; try again later.", title: "", questions: [], errors: [] };
  const materialsCourseId = await getMaterialsCourseId(input.courseId);
  if (!materialsCourseId) return { ok: false, message: "This course is not mapped to a materials course yet; an admin maps it in the MathVision app.", title: "", questions: [], errors: [] };

  const role = m.profile.role === "admin" ? "admin" : "in_charge";
  const course = await getCourse(input.courseId);
  const [worksheet, answerKey] = await Promise.all([
    fetchFileBase64(input.worksheet.fileId, role),
    input.answerKey ? fetchFileBase64(input.answerKey.fileId, role) : Promise.resolve(null),
  ]);
  const result = await extractQuestionsFromPdf({
    worksheet: { base64: worksheet.base64, name: worksheet.name || input.worksheet.name, file_id: input.worksheet.fileId },
    answerKey: answerKey && input.answerKey ? { base64: answerKey.base64, name: answerKey.name || input.answerKey.name, file_id: input.answerKey.fileId } : null,
    course: course?.name ?? "the course",
    topics,
    hints: input.hints.trim() || null,
  });
  if (result.errors.length && result.questions.length === 0) return { ok: false, message: result.errors.join(" "), title: result.title, questions: [], errors: result.errors };
  return { ok: true, message: `Extracted ${result.questions.length} question${result.questions.length === 1 ? "" : "s"}.`, title: result.title, questions: result.questions, errors: result.errors };
}

/** store_extracted_questions: the reviewed drafts land in the bank as draft rows. */
export async function storeExtractedQuestionsAction(
  courseId: string,
  questions: DraftQuestion[],
  source: { file_id: string; answer_key_file_id: string | null; title: string },
): Promise<ActionResult & { count: number; rows?: BankQuestion[] }> {
  const m = await manager(courseId);
  if ("error" in m) return { ok: false, message: m.error, count: 0 };
  if (questions.length === 0) return { ok: false, message: "Nothing to add.", count: 0 };

  if (isDemoMode) {
    const nowISO = new Date().toISOString();
    const rows = questions.map((d) => draftToRow(d, courseId, randomUUID(), m.profile.id, nowISO));
    return { ok: true, message: `Demo mode: store_extracted_questions would add ${rows.length} draft question${rows.length === 1 ? "" : "s"}.`, count: rows.length, rows };
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("store_extracted_questions", {
    p_course_id: courseId,
    p_questions: questions.map(draftToPayload),
    p_source: { kind: "pdf", ...source },
  });
  if (error) return { ok: false, message: error.message, count: 0 };
  const count = typeof data === "number" ? data : questions.length;
  revalidatePath("/bank");
  return { ok: true, message: `Added ${count} draft question${count === 1 ? "" : "s"} to the bank.`, count };
}

export interface CreateSetInput {
  courseId: string;
  kind: SetKind;
  title: string;
  questionIds: string[];
  topicId: string | null;
  timeLimitMinutes: number | null;
  integrity: IntegritySettings;
}

/** create_practice_set with the questions in the order picked. */
export async function createPracticeSetAction(input: CreateSetInput): Promise<ActionResult & { set?: PracticeSetRow }> {
  const m = await manager(input.courseId);
  if ("error" in m) return { ok: false, message: m.error };
  const title = input.title.trim();
  if (!title) return { ok: false, message: "The set needs a title." };
  if (input.questionIds.length === 0) return { ok: false, message: "Pick at least one approved question." };
  const integrity = input.kind === "test" ? input.integrity : { camera_required: false, hide_solutions: input.integrity.hide_solutions };
  const timeLimit = input.kind === "test" ? input.timeLimitMinutes : null;

  const set = (id: string): PracticeSetRow => ({
    id,
    course_id: input.courseId,
    kind: input.kind,
    title,
    syllabus_topic_id: input.topicId,
    time_limit_minutes: timeLimit,
    integrity_settings: integrity,
    status: "live",
    created_at: new Date().toISOString(),
    question_count: input.questionIds.length,
  });

  if (isDemoMode) return { ok: true, message: `Demo mode: create_practice_set would make "${title}" with ${input.questionIds.length} question${input.questionIds.length === 1 ? "" : "s"}.`, set: set(randomUUID()) };

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("create_practice_set", {
    p_course_id: input.courseId,
    p_kind: input.kind,
    p_title: title,
    p_question_ids: input.questionIds,
    p_topic_id: input.topicId,
    p_time_limit_minutes: timeLimit,
    p_integrity_settings: integrity,
    p_session_id: null,
  });
  if (error) return { ok: false, message: error.message };
  if (typeof data !== "string") return { ok: false, message: "The set was created but no id came back." };
  revalidatePath("/bank");
  return { ok: true, message: `Made "${title}".`, set: set(data) };
}

export interface AssignInput {
  courseId: string;
  setId: string;
  studentIds: string[];
  dueAt: string | null;
}

/** assign_practice, mode at_home: one assignment per student, pushed to the family by the database. */
export async function assignPracticeAction(input: AssignInput): Promise<ActionResult & { count: number }> {
  const m = await manager(input.courseId);
  if ("error" in m) return { ok: false, message: m.error, count: 0 };
  if (input.studentIds.length === 0) return { ok: false, message: "Pick at least one student.", count: 0 };
  if (input.dueAt && Number.isNaN(Date.parse(input.dueAt))) return { ok: false, message: "The due date could not be read.", count: 0 };

  if (isDemoMode) {
    return { ok: true, message: `Demo mode: assign_practice would assign this set to ${input.studentIds.length} student${input.studentIds.length === 1 ? "" : "s"} at home${input.dueAt ? ", due " + new Date(input.dueAt).toLocaleString() : ""}.`, count: input.studentIds.length };
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("assign_practice", {
    p_set_id: input.setId,
    p_student_ids: input.studentIds,
    p_mode: "at_home",
    p_session_id: null,
    p_due_at: input.dueAt,
  });
  if (error) return { ok: false, message: error.message, count: 0 };
  const count = typeof data === "number" ? data : input.studentIds.length;
  const skipped = input.studentIds.length - count;
  return { ok: true, message: `Assigned to ${count} student${count === 1 ? "" : "s"}${skipped > 0 ? ` (${skipped} already had it open)` : ""}.`, count };
}

/** A short-lived URL to open a materials file while choosing a worksheet. */
export async function materialsViewUrlAction(courseId: string, fileId: string): Promise<ActionResult & { url?: string }> {
  const m = await manager(courseId);
  if ("error" in m) return { ok: false, message: m.error };
  try {
    const { url } = await fetchFileViewUrl(fileId, m.profile.role === "admin" ? "admin" : "in_charge");
    return { ok: true, message: "", url };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Could not open the file." };
  }
}
