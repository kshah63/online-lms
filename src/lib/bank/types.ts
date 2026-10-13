import type { QuestionType } from "@/lib/practice/model";

// ============================================================================
// The question bank and the syllabus editor — mv-app's rows as the room reads
// them under RLS (practice_questions, practice_sets, syllabus_topics) and the
// payloads its RPCs take (CONTRACTS-stage4 §A and §B). Nothing here is written
// except through those RPCs; src/lib/bank/question-row.ts maps between these
// rows and the practice model the runner renders.
// ============================================================================

export type QuestionStatus = "draft" | "approved" | "retired";

export const QUESTION_STATUSES: readonly QuestionStatus[] = ["draft", "approved", "retired"];

export const QUESTION_STATUS_LABEL: Record<QuestionStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  retired: "Retired",
};

export const QUESTION_TYPES: readonly QuestionType[] = ["mcq", "multi_select", "numeric", "short", "worked"];

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  mcq: "Multiple choice",
  multi_select: "Select all that apply",
  numeric: "Numeric",
  short: "Short answer",
  worked: "Worked",
};

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export const DIFFICULTIES: readonly Difficulty[] = [1, 2, 3, 4, 5];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  1: "Routine",
  2: "Easy",
  3: "Standard",
  4: "Hard",
  5: "Stretch",
};

/** A practice_questions row, every column the room selects (never `*`). */
export interface BankQuestion {
  id: string;
  course_id: string;
  syllabus_topic_id: string | null;
  type: QuestionType;
  stem: string;
  /** [{key, text}] for mcq / multi_select, else null. */
  options: { key: string; text: string }[] | null;
  /** mcq "A"; multi_select ["A","C"]; numeric 3; short "x=5"; worked null. */
  answer: unknown;
  tolerance: number | null;
  unit: string | null;
  /** Alternative short answers. */
  accepted: string[] | null;
  difficulty: Difficulty;
  marks: number;
  worked_solution: string | null;
  /** practice-images object path: <course_id>/<uuid>.png. */
  image_path: string | null;
  source: { kind?: "pdf" | "generated" | "manual"; file_id?: string; page?: number; parent_question_id?: string } & Record<string, unknown>;
  status: QuestionStatus;
  created_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const BANK_QUESTION_COLUMNS =
  "id, course_id, syllabus_topic_id, type, stem, options, answer, tolerance, unit, accepted, difficulty, marks, worked_solution, image_path, source, status, created_by, reviewed_by, reviewed_at, created_at, updated_at";

/** What the editor holds and upsert_question's p_question carries (column names). */
export interface QuestionDraftInput {
  id: string | null;
  type: QuestionType;
  stem: string;
  options: { key: string; text: string }[];
  /** mcq: the correct key. numeric: the number as typed. short: the answer. */
  answer: string;
  /** multi_select: the correct keys. */
  answers: string[];
  /** short: alternative answers, one per line in the editor. */
  accepted: string[];
  tolerance: string;
  unit: string;
  difficulty: Difficulty;
  marks: number;
  worked_solution: string;
  image_path: string | null;
  syllabus_topic_id: string | null;
  source: BankQuestion["source"];
}

export type SetKind = "practice" | "test";

export const SET_KINDS: readonly SetKind[] = ["practice", "test"];

export const SET_KIND_LABEL: Record<SetKind, string> = {
  practice: "Practice",
  test: "Timed test",
};

/** Minutes a test may run; null is no limit. */
export const TIME_LIMITS: readonly (number | null)[] = [null, 10, 15, 20, 30, 45, 60, 90];

/** practice_sets.integrity_settings, the two flags the bank sets. */
export interface IntegritySettings {
  camera_required: boolean;
  hide_solutions: boolean;
}

/** A practice_sets row with its question count. */
export interface PracticeSetRow {
  id: string;
  course_id: string;
  kind: "practice" | "quick_check" | "test";
  title: string;
  syllabus_topic_id: string | null;
  time_limit_minutes: number | null;
  integrity_settings: Partial<IntegritySettings>;
  status: "draft" | "live" | "retired";
  created_at: string;
  question_count: number;
}

export const PRACTICE_SET_COLUMNS = "id, course_id, kind, title, syllabus_topic_id, time_limit_minutes, integrity_settings, status, created_at";

/** A student enrolled on a course (student_courses joined to the profile columns the office may read). */
export interface CourseStudent {
  id: string;
  name: string;
  grade_level: string | null;
}

/** A syllabus_topics row. */
export interface SyllabusTopic {
  id: string;
  course_id: string;
  label: string;
  parent_id: string | null;
  sort_order: number;
  course_topic_id: string | null;
  is_active: boolean;
}

export const SYLLABUS_TOPIC_COLUMNS = "id, course_id, label, parent_id, sort_order, course_topic_id, is_active";

/** What upsert_syllabus_topic takes, minus the course. */
export interface SyllabusTopicInput {
  id: string | null;
  label: string;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
}
