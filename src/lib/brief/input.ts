import type { BriefInput } from "@/lib/brief/compose";
import type { BriefPracticeFact, BriefReportFact, LessonBriefFacts } from "@/lib/brief/facts";
import type { FeedbackMoment } from "@/lib/coaching/analyze";
import type { LessonRoomState, OnlineLesson, ReportDraftRow, SessionReport } from "@/lib/types";

// ============================================================================
// Pure mapping from what the room can read — a my_online_lessons row, the
// room state when the room is open, and rpc lesson_brief_facts (the last
// published reports by any teacher, the caller's own draft and coaching
// moments from their previous lesson, open practice, the teacher marks) —
// onto the brief composer's input. Nothing is invented: a missing input is
// omitted. The older arguments (one report, one draft, moments) stay for
// callers that read those rows themselves.
// ============================================================================

export function briefInputFrom(args: {
  lesson: OnlineLesson;
  state: LessonRoomState | null;
  /** rpc lesson_brief_facts, normalised. Wins over the single-row arguments below. */
  facts?: LessonBriefFacts | null;
  lastReport?: SessionReport | null;
  /** The draft for the teacher's previous lesson with this student, when that lesson has no report yet. */
  lastDraft?: ReportDraftRow | null;
  moments?: FeedbackMoment[];
  nowISO?: string;
}): BriefInput {
  const { lesson, state, facts } = args;
  const first = lesson.student_name.split(/\s+/)[0] ?? lesson.student_name;

  let last_report: BriefInput["last_report"] = null;
  let earlier_reports: BriefInput["earlier_reports"] = [];
  const firstFact = facts?.last_reports[0] ?? null;
  if (firstFact) {
    last_report = reportFromFact(firstFact);
    earlier_reports = facts!.last_reports.slice(1).map(reportFromFact);
  } else if (args.lastReport) {
    const r = args.lastReport;
    last_report = {
      at: r.published_at ?? r.created_at,
      topic: r.topic,
      topic_completed: r.topic_completed,
      topics_not_done: r.topics_not_done,
      understanding: r.understanding,
      homework: r.homework,
      remarks: r.remarks,
    };
  } else {
    const draft = facts?.last_draft ?? (args.lastDraft ? { created_at: args.lastDraft.created_at, draft: args.lastDraft.draft } : null);
    if (draft) {
      const d = draft.draft;
      last_report = {
        at: draft.created_at,
        topic: str(d.topic),
        topic_completed: typeof d.topic_completed === "boolean" ? d.topic_completed : null,
        topics_not_done: str(d.topics_not_done),
        understanding: typeof d.understanding === "number" ? d.understanding : null,
        homework: str(d.homework),
        remarks: str(d.remarks) ? `(AI draft, not yet submitted) ${str(d.remarks)}` : null,
      };
    }
  }

  const moments = [...(facts?.moments ?? []), ...(args.moments ?? []).map((m) => ({ kind: m.kind, comment: m.comment }))];

  return {
    student: { first_name: first, grade: state?.student_grade ?? null },
    course: state?.course_name ?? lesson.subject ?? "the lesson",
    session: { starts_at: lesson.effective_start, topic: state?.topic ?? lesson.topic, mode: lesson.mode },
    last_report,
    earlier_reports,
    coaching_moments: moments,
    homework: (facts?.open_practice ?? []).flatMap(practiceToHomework),
    teacher_marks: (facts?.teacher_marks ?? []).map((m) => ({ label: m.label, status: m.status, at: m.at })),
    nowISO: args.nowISO,
  };
}

function reportFromFact(r: BriefReportFact): NonNullable<BriefInput["last_report"]> {
  return {
    at: r.at,
    topic: r.topic,
    topic_completed: r.topic_completed,
    topics_not_done: r.topics_not_done,
    understanding: r.understanding,
    homework: r.homework,
    remarks: r.remarks,
    teacher_name: r.teacher_name,
  };
}

/** An assignment with its latest attempt, in the composer's homework vocabulary. A voided attempt is nothing to mention. */
function practiceToHomework(p: BriefPracticeFact): NonNullable<BriefInput["homework"]> {
  if (p.attempt_status === "void") return [];
  const description = p.kind === "test" ? `${p.set_title} (test)` : p.set_title;
  const marks = p.score != null && p.out_of != null ? `${p.score}/${p.out_of}` : null;
  const status =
    p.attempt_status === "marked" ? "completed" : p.attempt_status === "submitted" ? "submitted" : p.attempt_status === "in_progress" ? "started" : "assigned";
  return [{ description, status, due_at: p.due_at, marks }];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
