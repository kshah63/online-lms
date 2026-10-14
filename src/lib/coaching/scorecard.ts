// ============================================================================
// rpc teacher_scorecard(p_teacher_id, p_days) → the office's teacher scorecard.
//
// SQL decides the window (the teacher's live bookings that started inside the
// last p_days days) and aggregates every block from that one list; this maps
// the jsonb onto what the screen draws and derives the two shares the tiles
// show. Nothing is invented: a missing number is null, a missing list is
// empty, and a dimension the database did not send is not drawn.
// ============================================================================

export const SCORECARD_WINDOWS = [30, 90, 180] as const;
export type ScorecardWindow = (typeof SCORECARD_WINDOWS)[number];
export const DEFAULT_SCORECARD_WINDOW: ScorecardWindow = 90;

/** The window from the query string: one of the three chips, else the default. */
export function scorecardWindow(raw: string | string[] | undefined): ScorecardWindow {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (SCORECARD_WINDOWS as readonly number[]).includes(n) ? (n as ScorecardWindow) : DEFAULT_SCORECARD_WINDOW;
}

/** The jsonb teacher_scorecard returns, as the contract spells it. Averages and medians are null when nothing was averaged. */
export interface TeacherScorecardRpc {
  teacher: { id: string; name: string };
  window_days: number;
  lessons: { taught: number; online: number; in_person: number; no_shows: number };
  punctuality: { online_with_host_join: number; median_minutes_late: number | null; late_over_5_min: number };
  coaching: {
    lessons_with_feedback: number;
    dimension_averages: Record<string, number>;
    strengths_top: { text: string; count: number }[];
    suggestions_top: { text: string; count: number }[];
  };
  metrics: {
    avg_teacher_talk_pct: number | null;
    avg_student_talk_pct: number | null;
    avg_question_count: number | null;
    avg_open_question_pct: number | null;
    avg_wait_ms: number | null;
    avg_praise_count: number | null;
  };
  reports: { due: number; written: number; median_hours_to_write: number | null; published: number; rejected: number };
  followups: { proposed: number; approved: number; done: number; dismissed: number };
  ratings: { count: number; average: number | null };
  recent_lessons: {
    session_id: string;
    at: string;
    student_name: string;
    subject: string | null;
    mode: string;
    understanding: number | null;
    feedback_summary: string | null;
  }[];
}

export interface ScorecardDimension {
  key: string;
  label: string;
  mean: number;
}

export interface ScorecardCounted {
  text: string;
  count: number;
}

export interface ScorecardLesson {
  session_id: string;
  at: string;
  student_name: string;
  subject: string;
  mode: "online" | "in_person";
  understanding: number | null;
  feedback_summary: string | null;
}

/** What the scorecard screen renders. */
export interface TeacherScorecard {
  teacher: { id: string; name: string };
  window_days: number;
  lessons: { taught: number; online: number; in_person: number; no_shows: number };
  punctuality: { online_with_host_join: number; median_minutes_late: number | null; late_over_5_min: number };
  coaching: { lessons_with_feedback: number; dimensions: ScorecardDimension[]; strengths_top: ScorecardCounted[]; suggestions_top: ScorecardCounted[] };
  metrics: TeacherScorecardRpc["metrics"];
  reports: { due: number; written: number; median_hours_to_write: number | null; published: number; rejected: number };
  followups: { proposed: number; approved: number; done: number; dismissed: number };
  ratings: { count: number; average: number | null };
  recent_lessons: ScorecardLesson[];
}

/** The four dimensions lessonAnalysis scores, in the order the coaching pages draw them; any other key the database sends follows, alphabetically. */
const DIMENSION_ORDER = ["engagement", "questioning", "clarity", "rapport"];
const DIMENSION_LABEL: Record<string, string> = { engagement: "Engagement", questioning: "Questioning", clarity: "Clarity", rapport: "Rapport" };

export function dimensionLabel(key: string): string {
  if (DIMENSION_LABEL[key]) return DIMENSION_LABEL[key]!;
  const words = key.replace(/_/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}

/** Map the RPC's jsonb onto the scorecard. */
export function scorecardFromRpc(raw: unknown): TeacherScorecard {
  const r = asRecord(raw);
  const teacher = asRecord(r.teacher);
  const lessons = asRecord(r.lessons);
  const punctuality = asRecord(r.punctuality);
  const coaching = asRecord(r.coaching);
  const metrics = asRecord(r.metrics);
  const reports = asRecord(r.reports);
  const followups = asRecord(r.followups);
  const ratings = asRecord(r.ratings);

  const dimensions: ScorecardDimension[] = Object.entries(asRecord(coaching.dimension_averages))
    .flatMap(([key, v]) => {
      const mean = num(v);
      return mean == null ? [] : [{ key, label: dimensionLabel(key), mean }];
    })
    .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));

  return {
    teacher: { id: str(teacher.id) ?? "", name: str(teacher.name) ?? "Teacher" },
    window_days: int(r.window_days) ?? DEFAULT_SCORECARD_WINDOW,
    lessons: {
      taught: count(lessons.taught),
      online: count(lessons.online),
      in_person: count(lessons.in_person),
      no_shows: count(lessons.no_shows),
    },
    punctuality: {
      online_with_host_join: count(punctuality.online_with_host_join),
      median_minutes_late: num(punctuality.median_minutes_late),
      late_over_5_min: count(punctuality.late_over_5_min),
    },
    coaching: {
      lessons_with_feedback: count(coaching.lessons_with_feedback),
      dimensions,
      strengths_top: counted(coaching.strengths_top),
      suggestions_top: counted(coaching.suggestions_top),
    },
    metrics: {
      avg_teacher_talk_pct: num(metrics.avg_teacher_talk_pct),
      avg_student_talk_pct: num(metrics.avg_student_talk_pct),
      avg_question_count: num(metrics.avg_question_count),
      avg_open_question_pct: num(metrics.avg_open_question_pct),
      avg_wait_ms: num(metrics.avg_wait_ms),
      avg_praise_count: num(metrics.avg_praise_count),
    },
    reports: {
      due: count(reports.due),
      written: count(reports.written),
      median_hours_to_write: num(reports.median_hours_to_write),
      published: count(reports.published),
      rejected: count(reports.rejected),
    },
    followups: {
      proposed: count(followups.proposed),
      approved: count(followups.approved),
      done: count(followups.done),
      dismissed: count(followups.dismissed),
    },
    ratings: { count: count(ratings.count), average: num(ratings.average) },
    recent_lessons: list(r.recent_lessons)
      .map((x) => {
        const row = asRecord(x);
        return {
          session_id: str(row.session_id) ?? "",
          at: str(row.at) ?? "",
          student_name: str(row.student_name) ?? "Student",
          subject: str(row.subject) ?? "Lesson",
          mode: (row.mode === "in_person" ? "in_person" : "online") as ScorecardLesson["mode"],
          understanding: int(row.understanding),
          feedback_summary: str(row.feedback_summary),
        };
      })
      .filter((x) => x.session_id && x.at),
  };
}

/**
 * Online lessons where the host was in the room within five minutes of the
 * start, as a share of the online lessons whose room recorded a host join.
 * Null when none did — a window with no online lesson has no punctuality.
 */
export function onTimeShare(card: Pick<TeacherScorecard, "punctuality">): number | null {
  const n = card.punctuality.online_with_host_join;
  if (n <= 0) return null;
  return Math.max(0, n - card.punctuality.late_over_5_min) / n;
}

/** Reports written as a share of the lessons taught (each taught lesson is due one). Null when nothing was due. */
export function reportsShare(card: Pick<TeacherScorecard, "reports">): number | null {
  const due = card.reports.due;
  if (due <= 0) return null;
  return Math.min(1, card.reports.written / due);
}

function rank(key: string): number {
  const i = DIMENSION_ORDER.indexOf(key);
  return i === -1 ? DIMENSION_ORDER.length : i;
}

function counted(v: unknown): ScorecardCounted[] {
  return list(v)
    .map((x) => ({ text: str(asRecord(x).text) ?? "", count: count(asRecord(x).count) }))
    .filter((x) => x.text);
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

/** A count the database always sends; absent or malformed reads as none. */
function count(v: unknown): number {
  return Math.max(0, int(v) ?? 0);
}
