import { practiceByWeek, summariseCourse, topicProgress, type TopicSignals, type TopicStatus } from "./progress";
import type { ProgressView } from "./view";

// ============================================================================
// rpc child_progress(p_student_id, p_course_id) → the progress dashboard.
//
// SQL gathers the signals (CONTRACTS-stage4 §A); the statuses are derived here
// with the same pure model the sample data runs through, so the database and
// the room never hold two opinions about what "secure" means. Nothing is
// invented: a missing list is empty, a malformed number is null.
// ============================================================================

/** The jsonb child_progress returns, as the contract spells it. */
export interface ChildProgressRpc {
  student: { id: string; first_name: string };
  course: { id: string; name: string };
  generated_at: string;
  topics: {
    id: string;
    label: string;
    sort_order: number;
    sessions: { at: string; completed: boolean }[];
    practice: { at: string; correct: number; total: number }[];
    tests: { at: string; score: number; out_of: number }[];
    teacher_mark: { status: string; at: string; note: string | null } | null;
  }[];
  weekly_practice: { week_start: string; items: number }[];
  accuracy: { current: { correct: number; total: number }; previous: { correct: number; total: number } };
  attendance: { attended: number; booked: number; weeks: number };
  tests: { attempt_id: string; name: string; at: string; score: number; out_of: number; topic_label: string | null; flagged: boolean }[];
  reports: { id: string; at: string; topic: string | null; understanding: number | null; homework: string | null }[];
}

/** A published report, as the dashboard lists it beside the syllabus. */
export interface ProgressReport {
  id: string;
  at: string;
  topic: string | null;
  understanding: number | null;
  homework: string | null;
}

/** What the progress screen renders: the view the dashboard already draws, plus the recent reports. */
export interface ProgressPageData {
  view: ProgressView;
  reports: ProgressReport[];
}

const STATUSES: readonly TopicStatus[] = ["not_started", "in_progress", "covered", "secure", "needs_work"];

/** Map the RPC's jsonb onto the dashboard. `nowISO` defaults to the RPC's generated_at so recency weighting matches the database's clock. */
export function progressFromRpc(raw: unknown, nowISO?: string): ProgressPageData {
  const r = asRecord(raw);
  const student = asRecord(r.student);
  const course = asRecord(r.course);
  const generated_at = str(r.generated_at) ?? new Date().toISOString();
  const now = nowISO ?? generated_at;

  const topics = list(r.topics).map((t) => {
    const row = asRecord(t);
    const signals: TopicSignals = {
      topic_id: str(row.id) ?? "",
      sessions: list(row.sessions).map((s) => ({ at: str(asRecord(s).at) ?? "", completed: Boolean(asRecord(s).completed) })).filter((s) => s.at),
      practice: list(row.practice)
        .map((p) => ({ at: str(asRecord(p).at) ?? "", correct: int(asRecord(p).correct) ?? 0, total: int(asRecord(p).total) ?? 0 }))
        .filter((p) => p.at),
      tests: list(row.tests)
        .map((x) => ({ at: str(asRecord(x).at) ?? "", score: num(asRecord(x).score) ?? 0, out_of: num(asRecord(x).out_of) ?? 0 }))
        .filter((x) => x.at),
      teacher_mark: teacherMark(row.teacher_mark),
    };
    return {
      id: signals.topic_id,
      label: str(row.label) ?? "",
      sort_order: int(row.sort_order) ?? 0,
      signals,
    };
  });
  topics.sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));

  const progress = topics.map((t) => ({ id: t.id, label: t.label, progress: topicProgress(t.signals, now) }));

  // The database zero-fills eight ISO weeks; when it sent nothing, bucket the topic practice the same way.
  const weeklyRaw = list(r.weekly_practice)
    .map((w) => ({ week_start: str(asRecord(w).week_start) ?? "", items: int(asRecord(w).items) ?? 0 }))
    .filter((w) => w.week_start);
  const weekly = weeklyRaw.length ? weeklyRaw : practiceByWeek(topics.flatMap((t) => t.signals.practice), 8, now);

  const accuracy = asRecord(r.accuracy);
  const current = asRecord(accuracy.current);
  const previous = asRecord(accuracy.previous);
  const currentTotal = int(current.total) ?? 0;
  const previousTotal = int(previous.total) ?? 0;

  const attendance = asRecord(r.attendance);

  const view: ProgressView = {
    student: { id: str(student.id) ?? "", first_name: str(student.first_name) ?? "" },
    course: { id: str(course.id) ?? "", name: str(course.name) ?? "" },
    generated_at,
    summary: summariseCourse(progress.map((p) => p.progress)),
    topics: progress,
    weekly,
    accuracy: {
      current: currentTotal > 0 ? (int(current.correct) ?? 0) / currentTotal : null,
      previous: previousTotal > 0 ? (int(previous.correct) ?? 0) / previousTotal : null,
      items: currentTotal,
    },
    attendance: {
      attended: int(attendance.attended) ?? 0,
      booked: int(attendance.booked) ?? 0,
      weeks: int(attendance.weeks) ?? 8,
    },
    tests: list(r.tests)
      .map((x) => {
        const row = asRecord(x);
        return {
          name: str(row.name) ?? "Test",
          at: str(row.at) ?? "",
          score: num(row.score) ?? 0,
          out_of: num(row.out_of) ?? 0,
          topic_label: str(row.topic_label),
          flagged: Boolean(row.flagged),
        };
      })
      .filter((x) => x.at),
  };

  const reports: ProgressReport[] = list(r.reports)
    .map((x) => {
      const row = asRecord(x);
      return { id: str(row.id) ?? "", at: str(row.at) ?? "", topic: str(row.topic), understanding: int(row.understanding), homework: str(row.homework) };
    })
    .filter((x) => x.id && x.at);

  return { view, reports };
}

function teacherMark(v: unknown): TopicSignals["teacher_mark"] {
  const m = asRecord(v);
  const status = str(m.status);
  const at = str(m.at);
  if (!status || !at || !STATUSES.includes(status as TopicStatus)) return null;
  return { status: status as TopicStatus, at, note: str(m.note) };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
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
