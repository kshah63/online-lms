// ============================================================================
// Practice & tests — the question model.
//
// Pure types, no database. The same shapes are used by the extraction pipeline
// (PDF → draft questions), the review queue, practice sets, in-session quick
// checks and timed tests. Stems and solutions are Markdown with LaTeX ($…$ and
// $$…$$); images are referenced by URL/storage path and rendered beside the
// stem.
// ============================================================================

export type QuestionType = "mcq" | "multi_select" | "numeric" | "short" | "worked";

/** Where a question came from — kept so a wrong answer key can be traced. */
export interface QuestionSource {
  kind: "pdf" | "generated" | "manual";
  /** Materials-portal file id and 1-based page, for pdf sources. */
  file_id?: string;
  page?: number;
  /** The question this one was generated from, for generated variants. */
  parent_question_id?: string;
}

export interface McqOption {
  key: string; // "A", "B", …
  text: string; // Markdown + LaTeX
}

interface QuestionBase {
  id: string;
  type: QuestionType;
  stem: string;
  image_url?: string | null;
  /** Syllabus topic (mv-app course_topics / lesson syllabus) the question drills. */
  topic_id?: string | null;
  topic_label?: string | null;
  /** 1 (routine) … 5 (stretch). */
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** Marks available. Worked questions can carry method marks. */
  marks: number;
  /** Full worked solution shown after an attempt. */
  worked_solution?: string | null;
  source: QuestionSource;
}

export interface McqQuestion extends QuestionBase {
  type: "mcq";
  options: McqOption[];
  answer: string; // option key
}

export interface MultiSelectQuestion extends QuestionBase {
  type: "multi_select";
  options: McqOption[];
  answers: string[]; // option keys
}

export interface NumericQuestion extends QuestionBase {
  type: "numeric";
  answer: number;
  /** Absolute tolerance. Default: half a unit in the answer's last decimal place. */
  tolerance?: number | null;
  /** Relative tolerance in percent, used when set instead of absolute. */
  tolerance_pct?: number | null;
  /** Expected unit, informational ("cm", "kg"). Units typed by the student are stripped. */
  unit?: string | null;
}

export interface ShortQuestion extends QuestionBase {
  type: "short";
  /** Accepted answers, any of which earns the marks. */
  answers: string[];
  /** Compare ignoring case (default true). */
  case_insensitive?: boolean;
}

export interface WorkedQuestion extends QuestionBase {
  type: "worked";
  /** How marks are awarded, for the teacher and the AI pre-marker. */
  marking_scheme: string;
  /** The final answer, when there is one, so a quick correctness check is possible. */
  final_answer?: string | null;
}

export type Question =
  | McqQuestion
  | MultiSelectQuestion
  | NumericQuestion
  | ShortQuestion
  | WorkedQuestion;

/** What a student submitted for one question. */
export type Response =
  | { type: "mcq"; key: string | null }
  | { type: "multi_select"; keys: string[] }
  | { type: "numeric"; text: string }
  | { type: "short"; text: string }
  | {
      type: "worked";
      /** Typed final answer, if the student gave one. */
      final_answer?: string | null;
      /** Canvas page or uploaded images holding the working. */
      evidence: { kind: "notebook_page" | "image"; ref: string }[];
    };

export type MarkStatus = "correct" | "incorrect" | "partial" | "unanswered" | "pending_review";

export interface MarkResult {
  status: MarkStatus;
  /** Marks awarded, 0..question.marks. For pending_review this is 0 until marked. */
  score: number;
  max: number;
  /** Short student-facing explanation of the outcome, never the full solution. */
  feedback: string;
}

/** Narrow the response type to the question type at the type level. */
export type ResponseFor<Q extends Question> = Extract<Response, { type: Q["type"] }>;
