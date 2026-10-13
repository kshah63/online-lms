import type { BriefInput } from "@/lib/brief/compose";
import type { FeedbackMoment } from "@/lib/coaching/analyze";
import type { LessonRoomState, OnlineLesson, ReportDraftRow, SessionReport } from "@/lib/types";

// ============================================================================
// Pure mapping from what the room can read (a my_online_lessons row, the
// room state when the room is open, the last report or draft on the student,
// the teacher's coaching moments from their last lesson with them) onto the
// brief composer's input. Nothing is invented: a missing input is omitted.
// ============================================================================

export function briefInputFrom(args: {
  lesson: OnlineLesson;
  state: LessonRoomState | null;
  lastReport: SessionReport | null;
  /** The draft for the teacher's previous lesson with this student, when that lesson has no report yet. */
  lastDraft: ReportDraftRow | null;
  moments: FeedbackMoment[];
  nowISO?: string;
}): BriefInput {
  const { lesson, state, lastReport, lastDraft, moments } = args;
  const first = lesson.student_name.split(/\s+/)[0] ?? lesson.student_name;

  let last_report: BriefInput["last_report"] = null;
  if (lastReport) {
    last_report = {
      at: lastReport.published_at ?? lastReport.created_at,
      topic: lastReport.topic,
      topic_completed: lastReport.topic_completed,
      topics_not_done: lastReport.topics_not_done,
      understanding: lastReport.understanding,
      homework: lastReport.homework,
      remarks: lastReport.remarks,
    };
  } else if (lastDraft) {
    const d = lastDraft.draft;
    last_report = {
      at: lastDraft.created_at,
      topic: str(d.topic),
      topic_completed: typeof d.topic_completed === "boolean" ? d.topic_completed : null,
      topics_not_done: str(d.topics_not_done),
      understanding: typeof d.understanding === "number" ? d.understanding : null,
      homework: str(d.homework),
      remarks: str(d.remarks) ? `(AI draft, not yet submitted) ${str(d.remarks)}` : null,
    };
  }

  return {
    student: { first_name: first, grade: state?.student_grade ?? null },
    course: state?.course_name ?? lesson.subject ?? "the lesson",
    session: { starts_at: lesson.effective_start, topic: state?.topic ?? lesson.topic, mode: lesson.mode },
    last_report,
    coaching_moments: moments.map((m) => ({ kind: m.kind, comment: m.comment })),
    nowISO: args.nowISO,
  };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
