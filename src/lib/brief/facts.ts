import type { TopicStatus } from "@/lib/syllabus/progress";

// ============================================================================
// rpc lesson_brief_facts(p_session_id): what the database gathers for the
// pre-lesson brief (CONTRACTS-stage4 §A). The widening the owner approved is
// in last_reports — the last three PUBLISHED reports for this student and
// course by ANY teacher. The rest is the caller's own: the AI draft of their
// previous lesson with the student while its report is unwritten, the
// coaching moments from it, open practice, the teacher marks, last homework.
// ============================================================================

export interface BriefReportFact {
  id: string;
  /** published_at */
  at: string;
  topic: string | null;
  topic_completed: boolean | null;
  topics_not_done: string | null;
  understanding: number | null;
  homework: string | null;
  remarks: string | null;
  prev_hw: string | null;
  teacher_name: string | null;
}

export type PracticeAttemptStatus = "in_progress" | "submitted" | "marked" | "void";

export interface BriefPracticeFact {
  assignment_id: string;
  set_title: string;
  kind: "practice" | "quick_check" | "test";
  due_at: string | null;
  attempt_status: PracticeAttemptStatus | null;
  score: number | null;
  out_of: number | null;
}

export interface BriefTeacherMark {
  topic_id: string;
  label: string;
  status: TopicStatus;
  at: string;
}

export interface LessonBriefFacts {
  last_reports: BriefReportFact[];
  last_draft: { session_id: string; created_at: string; draft: Record<string, unknown> } | null;
  moments: { kind: "strength" | "improvement"; comment: string }[];
  open_practice: BriefPracticeFact[];
  teacher_marks: BriefTeacherMark[];
  homework_last: string | null;
}

export const EMPTY_BRIEF_FACTS: LessonBriefFacts = { last_reports: [], last_draft: null, moments: [], open_practice: [], teacher_marks: [], homework_last: null };

const STATUSES: readonly TopicStatus[] = ["not_started", "in_progress", "covered", "secure", "needs_work"];
const ATTEMPT_STATUSES: readonly PracticeAttemptStatus[] = ["in_progress", "submitted", "marked", "void"];

/** The jsonb as the RPC returns it, with every list present and every row well-typed. A row missing what identifies it is dropped. */
export function normaliseBriefFacts(raw: unknown): LessonBriefFacts {
  const r = asRecord(raw);
  const last_reports = list(r.last_reports).flatMap((x) => {
    const row = asRecord(x);
    const id = str(row.id);
    const at = str(row.at);
    if (!id || !at) return [];
    return [
      {
        id,
        at,
        topic: str(row.topic),
        topic_completed: typeof row.topic_completed === "boolean" ? row.topic_completed : null,
        topics_not_done: str(row.topics_not_done),
        understanding: int(row.understanding),
        homework: str(row.homework),
        remarks: str(row.remarks),
        prev_hw: str(row.prev_hw),
        teacher_name: str(row.teacher_name),
      },
    ];
  });

  const draftRow = asRecord(r.last_draft);
  const draftSession = str(draftRow.session_id);
  const draftAt = str(draftRow.created_at);
  const last_draft = draftSession && draftAt ? { session_id: draftSession, created_at: draftAt, draft: asRecord(draftRow.draft) } : null;

  const moments = list(r.moments).flatMap((x) => {
    const row = asRecord(x);
    const comment = str(row.comment);
    const kind: "strength" | "improvement" | null = row.kind === "strength" ? "strength" : row.kind === "improvement" ? "improvement" : null;
    return kind && comment ? [{ kind, comment }] : [];
  });

  const open_practice = list(r.open_practice).flatMap((x) => {
    const row = asRecord(x);
    const assignment_id = str(row.assignment_id);
    if (!assignment_id) return [];
    const status = str(row.attempt_status);
    const kind = row.kind === "quick_check" || row.kind === "test" ? row.kind : "practice";
    return [
      {
        assignment_id,
        set_title: str(row.set_title) ?? "Practice",
        kind,
        due_at: str(row.due_at),
        attempt_status: status && ATTEMPT_STATUSES.includes(status as PracticeAttemptStatus) ? (status as PracticeAttemptStatus) : null,
        score: num(row.score),
        out_of: num(row.out_of),
      } satisfies BriefPracticeFact,
    ];
  });

  const teacher_marks = list(r.teacher_marks).flatMap((x) => {
    const row = asRecord(x);
    const topic_id = str(row.topic_id);
    const status = str(row.status);
    const at = str(row.at);
    if (!topic_id || !at || !status || !STATUSES.includes(status as TopicStatus)) return [];
    return [{ topic_id, label: str(row.label) ?? "", status: status as TopicStatus, at }];
  });

  return { last_reports, last_draft, moments, open_practice, teacher_marks, homework_last: str(r.homework_last) ?? last_reports[0]?.homework ?? null };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n);
}
