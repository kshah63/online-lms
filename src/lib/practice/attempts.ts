// ============================================================================
// Practice attempts — the shapes mv-app's RPCs hand the room, and the pure
// rules the screens apply to them. No database here: the RPC seam is
// src/lib/data/attempts.ts, the demo twin src/lib/demo/attempts.ts.
//
//   my_practice(p_days)                 → PracticeRow[]
//   attempt_questions(p_attempt_id)     → AttemptQuestionRow[] (answers masked in progress)
//   answer_question(...)                → AnswerVerdict (never the answer)
//   submit_attempt(...)                 → SubmitResult
//   live_attempts(p_session_id)         → LiveAttempt[]
//   flagged_attempt_review(p_attempt_id)→ AttemptReview
// ============================================================================

import type { IntegrityEventType } from "@/lib/integrity/engine";
import { SEVERITY } from "@/lib/integrity/engine";
import { parseNumber } from "@/lib/practice/numbers";
import type { MarkResult, McqOption, Question, Response } from "@/lib/practice/model";

export type PracticeKind = "practice" | "quick_check" | "test";
export type AssignmentMode = "in_session" | "at_home";
export type AttemptStatus = "in_progress" | "submitted" | "marked" | "void";

export const PRACTICE_KIND_LABEL: Record<PracticeKind, string> = {
  practice: "Practice",
  quick_check: "Quick check",
  test: "Test",
};

/** One row of rpc my_practice(p_days). */
export interface PracticeRow {
  /** my_practice's own total, on every row: the list stops at 200. */
  total_count?: number;
  assignment_id: string;
  set_id: string;
  set_title: string;
  kind: PracticeKind;
  course_id: string;
  course_name: string;
  student_id: string;
  student_name: string;
  mode: AssignmentMode;
  due_at: string | null;
  assigned_at: string;
  attempt_id: string | null;
  attempt_status: AttemptStatus | null;
  score: number | null;
  out_of: number | null;
  integrity_flagged: boolean;
  submitted_at: string | null;
  question_count: number;
}

export type PracticeState = "not_started" | "in_progress" | "submitted" | "flagged" | "void";

/** What a row's chip says: the attempt's state, with the flag winning over the mark. */
export function practiceState(row: Pick<PracticeRow, "attempt_id" | "attempt_status" | "integrity_flagged">): PracticeState {
  if (!row.attempt_id || !row.attempt_status) return "not_started";
  if (row.attempt_status === "void") return "void";
  if (row.attempt_status === "in_progress") return "in_progress";
  return row.integrity_flagged ? "flagged" : "submitted";
}

/** "Submitted · 7/10", "Flagged · 3/6", "In progress", "Not started", "Voided". */
export function practiceStateLabel(row: Pick<PracticeRow, "attempt_id" | "attempt_status" | "integrity_flagged" | "score" | "out_of">): string {
  const state = practiceState(row);
  const mark = row.score != null && row.out_of != null ? ` · ${formatMark(row.score)}/${formatMark(row.out_of)}` : "";
  switch (state) {
    case "not_started":
      return "Not started";
    case "in_progress":
      return "In progress";
    case "submitted":
      return `Submitted${mark}`;
    case "flagged":
      return `Flagged${mark}`;
    case "void":
      return "Voided";
  }
}

/** Marks print without a trailing ".0", keeping halves ("2.5"). */
export function formatMark(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Where an attempt runs: a test is its own full-screen page, anything else the practice runner. */
export function attemptPath(kind: PracticeKind, attemptId: string): string {
  return kind === "test" ? `/test/${attemptId}` : `/home/practice/${attemptId}`;
}

/** A row the student may still open: not yet started, or in progress. Parents never start anything. */
export function canOpen(row: Pick<PracticeRow, "attempt_id" | "attempt_status" | "integrity_flagged">): boolean {
  const s = practiceState(row);
  return s === "not_started" || s === "in_progress";
}

// --- attempt_questions --------------------------------------------------------

/** One element of rpc attempt_questions(p_attempt_id). answer and worked_solution are null while the student is in progress. */
export interface AttemptQuestionRow {
  id: string;
  type: Question["type"];
  stem: string;
  image_path: string | null;
  options: McqOption[] | null;
  difficulty: number | null;
  marks: number;
  topic_id: string | null;
  topic_label: string | null;
  sort_order: number;
  response: Record<string, unknown> | null;
  is_correct: boolean | null;
  marks_awarded: number | null;
  feedback: string | null;
  answer: unknown;
  worked_solution: string | null;
  unit: string | null;
}

/** The question model the cards render, built from an attempt_questions row. The answer is whatever the RPC let through. */
export function toQuestion(row: AttemptQuestionRow, imageUrl: string | null = null): Question {
  const base = {
    id: row.id,
    stem: row.stem,
    image_url: imageUrl,
    topic_id: row.topic_id,
    topic_label: row.topic_label,
    difficulty: clampDifficulty(row.difficulty),
    marks: Number(row.marks) || 1,
    worked_solution: row.worked_solution,
    source: { kind: "manual" as const },
  };
  const options = Array.isArray(row.options) ? row.options : [];
  switch (row.type) {
    case "mcq":
      return { ...base, type: "mcq", options, answer: typeof row.answer === "string" ? row.answer : "" };
    case "multi_select":
      return { ...base, type: "multi_select", options, answers: Array.isArray(row.answer) ? row.answer.map(String) : [] };
    case "numeric":
      return { ...base, type: "numeric", answer: typeof row.answer === "number" ? row.answer : Number.NaN, unit: row.unit };
    case "short":
      return { ...base, type: "short", answers: typeof row.answer === "string" ? [row.answer] : Array.isArray(row.answer) ? row.answer.map(String) : [] };
    case "worked":
      return { ...base, type: "worked", marking_scheme: "", final_answer: null };
  }
}

function clampDifficulty(d: number | null): 1 | 2 | 3 | 4 | 5 {
  const n = Math.round(Number(d ?? 3));
  return (n < 1 ? 1 : n > 5 ? 5 : n) as 1 | 2 | 3 | 4 | 5;
}

/** The student's saved response, as the runner holds it. */
export function toResponse(row: Pick<AttemptQuestionRow, "type" | "response">): Response | null {
  const r = row.response;
  if (!r || typeof r !== "object") return null;
  switch (row.type) {
    case "mcq":
      return { type: "mcq", key: typeof r.key === "string" ? r.key : null };
    case "multi_select":
      return { type: "multi_select", keys: Array.isArray(r.keys) ? r.keys.map(String) : [] };
    case "numeric":
      return { type: "numeric", text: typeof r.text === "string" ? r.text : r.value != null ? String(r.value) : "" };
    case "short":
      return { type: "short", text: typeof r.text === "string" ? r.text : "" };
    case "worked":
      return {
        type: "worked",
        final_answer: typeof r.final_answer === "string" ? r.final_answer : null,
        evidence: Array.isArray(r.evidence) ? (r.evidence as { kind: "notebook_page" | "image"; ref: string }[]) : [],
      };
  }
}

/** The jsonb answer_question receives. A numeric answer carries the parsed value beside the text the student typed. */
export function responsePayload(r: Response): Record<string, unknown> {
  if (r.type === "numeric") return { type: "numeric", text: r.text, value: parseNumber(r.text) };
  return { ...r };
}

/** The card's mark from the row: correct / incorrect / partial, pending review for an unmarked worked answer, null when unanswered. */
export function toMarkResult(row: Pick<AttemptQuestionRow, "type" | "response" | "is_correct" | "marks_awarded" | "feedback" | "marks">): MarkResult | null {
  if (!row.response) return null;
  const max = Number(row.marks) || 1;
  if (row.is_correct == null) {
    if (row.type === "worked") return { status: "pending_review", score: 0, max, feedback: row.feedback ?? "Submitted — your working will be marked." };
    return null;
  }
  const score = row.marks_awarded ?? (row.is_correct ? max : 0);
  const status = row.is_correct ? "correct" : score > 0 ? "partial" : "incorrect";
  return { status, score, max, feedback: row.feedback ?? (status === "correct" ? "Correct." : status === "partial" ? "Partly right." : "Not quite.") };
}

/**
 * What answer_question returns: the verdict, never the answer. The database
 * ports the room's own marking rules, so its vocabulary is the same five
 * statuses (partial credit on a multi-select, unanswered), plus the
 * student-facing feedback sentence it composed.
 */
export interface AnswerVerdict {
  is_correct: boolean | null;
  marks_awarded: number | null;
  status: "correct" | "incorrect" | "partial" | "unanswered" | "pending_review";
  feedback?: string | null;
}

export function verdictToMark(v: AnswerVerdict, max: number): MarkResult {
  if (v.status === "pending_review") return { status: "pending_review", score: 0, max, feedback: v.feedback ?? "Submitted — your working will be marked." };
  const score = v.marks_awarded ?? (v.is_correct ? max : 0);
  if (v.status === "correct") return { status: "correct", score, max, feedback: v.feedback ?? "Correct." };
  if (v.status === "unanswered") return { status: "unanswered", score: 0, max, feedback: v.feedback ?? "No answer given." };
  const status = v.status === "partial" || score > 0 ? "partial" : "incorrect";
  return { status, score, max, feedback: v.feedback ?? (status === "partial" ? "Partly right." : "Not quite.") };
}

export interface SubmitResult {
  score: number;
  out_of: number;
  status: AttemptStatus;
}

// --- timed tests ----------------------------------------------------------------

/** The RPC's integrity event kinds (practice_integrity_events.kind). */
export type IntegrityEventKind =
  | "fullscreen_exit"
  | "visibility_hidden"
  | "window_blur"
  | "resize"
  | "paste"
  | "copy"
  | "context_menu"
  | "devtools"
  | "offline"
  | "camera_off"
  | "snapshot"
  | "resume"
  | "warned"
  | "paused";

/** The engine's event types, as log_integrity_event spells them. */
export const INTEGRITY_EVENT_KIND: Record<IntegrityEventType, IntegrityEventKind> = {
  visibility_hidden: "visibility_hidden",
  window_blur: "window_blur",
  fullscreen_exit: "fullscreen_exit",
  paste: "paste",
  copy: "copy",
  context_menu: "context_menu",
  devtools_shortcut: "devtools",
  camera_off: "camera_off",
  camera_denied: "camera_off",
  offline: "offline",
  resize: "resize",
};

/** How much a logged kind counts, for the review timeline (the engine's weights; bookkeeping kinds count nothing). */
export function eventSeverity(kind: string): number {
  switch (kind) {
    case "devtools":
      return SEVERITY.devtools_shortcut;
    case "snapshot":
    case "resume":
    case "warned":
    case "paused":
      return 0;
    default:
      return SEVERITY[kind as IntegrityEventType] ?? 0;
  }
}

export const INTEGRITY_KIND_LABEL: Record<IntegrityEventKind, string> = {
  fullscreen_exit: "Exited full screen",
  visibility_hidden: "Left the tab",
  window_blur: "Switched window",
  resize: "Resized the window",
  paste: "Pasted",
  copy: "Copied",
  context_menu: "Right-clicked",
  devtools: "Developer tools shortcut",
  offline: "Went offline",
  camera_off: "Camera off",
  snapshot: "Snapshot",
  resume: "Came back",
  warned: "Warned",
  paused: "Timer paused",
};

/**
 * Time left on a timed attempt: the limit counts from the row's started_at, and
 * every pause the engine recorded is given back. Null when there is no limit.
 */
export function remainingMs(args: { startedAtISO: string; timeLimitMinutes: number | null; pausedMs: number; nowMs: number }): number | null {
  if (args.timeLimitMinutes == null) return null;
  const limit = args.timeLimitMinutes * 60_000;
  const elapsed = args.nowMs - Date.parse(args.startedAtISO) - Math.max(0, args.pausedMs);
  return Math.max(0, limit - elapsed);
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** The snapshot's object path in the test-snapshots bucket: <uid>/<attempt_id>/<ts>.jpg. */
export function snapshotPath(uid: string, attemptId: string, atMs: number): string {
  return `${uid}/${attemptId}/${atMs}.jpg`;
}

// --- live_attempts and the review --------------------------------------------------

export interface LiveAttemptAnswer {
  question_id: string;
  is_correct: boolean | null;
  marks_awarded: number | null;
  answered_at: string;
}

/** One element of rpc live_attempts(p_session_id). */
export interface LiveAttempt {
  attempt_id: string;
  student_id: string;
  set_id: string;
  set_title: string;
  kind: PracticeKind;
  status: AttemptStatus;
  score: number | null;
  out_of: number | null;
  started_at: string;
  submitted_at: string | null;
  integrity_flagged: boolean;
  answers: LiveAttemptAnswer[];
}

/** A practice_integrity_events row as flagged_attempt_review lists it. */
export interface IntegrityEventRow {
  at: string;
  kind: IntegrityEventKind | string;
  detail: string | null;
  snapshot_path: string | null;
}

/** The attempt as flagged_attempt_review returns it (a practice_attempts row). */
export interface AttemptRecord {
  id: string;
  assignment_id: string | null;
  set_id: string;
  student_id: string;
  session_id: string | null;
  started_at: string;
  submitted_at: string | null;
  time_limit_minutes: number | null;
  score: number | null;
  out_of: number | null;
  integrity_flagged: boolean;
  integrity_summary: Record<string, unknown> | null;
  status: AttemptStatus;
}

export interface AttemptReview {
  attempt: AttemptRecord;
  events: IntegrityEventRow[];
  answers: { question_id: string; response: Record<string, unknown> | null; is_correct: boolean | null; marks_awarded: number | null; feedback: string | null; answered_at: string | null }[];
}

/** The review page's headline: the stored summary's, else counted from the events. */
export function reviewHeadline(review: Pick<AttemptReview, "attempt" | "events">): string {
  const stored = review.attempt.integrity_summary?.headline;
  if (typeof stored === "string" && stored) return stored;
  const scored = review.events.filter((e) => eventSeverity(e.kind) > 0);
  if (scored.length === 0) return "No integrity events";
  const counts = new Map<string, number>();
  for (const e of scored) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${(INTEGRITY_KIND_LABEL[k as IntegrityEventKind] ?? k).toLowerCase()} ×${n}`);
  return `${scored.length} event${scored.length > 1 ? "s" : ""}: ${parts.join(", ")}`;
}

/** Total weighted severity over a timeline. */
export function timelineSeverity(events: Pick<IntegrityEventRow, "kind">[]): number {
  return Math.round(events.reduce((s, e) => s + eventSeverity(e.kind), 0) * 10) / 10;
}
