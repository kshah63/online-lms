import { DateTime } from "luxon";
import {
  DEMO_IDS,
  buildDemoSessionRequests,
  demoCourses,
  demoFollowups,
  demoInchargeDepartments,
  demoProfiles,
  demoSessionReports,
  type DemoSessionRequest,
} from "@/lib/demo/data";
import { demoCoachingHistory } from "@/lib/demo/coaching";
import type { TeacherScorecardRpc } from "@/lib/coaching/scorecard";
import { displayName, type Course, type Profile } from "@/lib/types";

// ============================================================================
// rpc teacher_scorecard(p_teacher_id, p_days), as the demo answers it, for
// Maya and Daniel. Each teacher has a term of bookings — the real demo
// sessions plus a regular past term — and one window is decided from it
// exactly as the SQL decides its own (live bookings whose start lies in
// [now - p_days, now]); every block is aggregated from that one list, so the
// 30 / 90 / 180-day chips move every figure together. The coaching facts are
// the same rows Coaching QA shows (demoCoachingHistory), so the two screens
// agree about a lesson. Used only when isDemoMode is true.
// ============================================================================

const ID = DEMO_IDS;
const [IGCSE, SAT, PHYS] = demoCourses as [Course, Course, Course];
const DAY_MS = 86_400_000;

type Mode = "online" | "in_person";
type ReportStatus = "published" | "rejected" | "pending";
type FollowupStatus = "proposed" | "approved" | "done" | "dismissed";

/** One of the teacher's bookings with the facts the scorecard reads about it. */
interface DemoTermLesson {
  session_id: string;
  effective_start: string;
  ends_at: string;
  department_id: string;
  student_id: string;
  course: Course;
  mode: Mode;
  status: "confirmed" | "completed" | "cancelled";
  /** session_requests.arrived_at is set. */
  taught: boolean;
  /** session_requests.no_show, the fact sweep_no_shows wrote. */
  no_show: boolean;
  /** lesson_rooms.host_joined_at minus the start, in minutes; null when the room never saw the host. */
  host_late_min: number | null;
  /** The session's report: how long after the lesson's end it was written, and what became of it. */
  report: { hours_after: number; status: ReportStatus; understanding: number | null } | null;
  followups: FollowupStatus[];
  /** session_requests.rating, 1–5 from the household. */
  rating: number | null;
}

/** Mirrors teacher_scorecard's gate: the teacher themself, an admin, or an in-charge of a room the teacher taught in inside the window. Support is refused. */
export function demoMayReadScorecard(viewer: Profile, teacherId: string, days: number, nowMs = Date.now()): boolean {
  if (viewer.id === teacherId) return true;
  if (viewer.role === "admin") return true;
  if (viewer.role !== "staff") return false;
  const rooms = demoInchargeDepartments[viewer.id] ?? [];
  return windowOf(termFor(teacherId, nowMs), days, nowMs).some((l) => rooms.includes(l.department_id));
}

/** rpc teacher_scorecard, as the demo answers it. Throws the database's sentences in the database's order. */
export function buildDemoTeacherScorecard(viewer: Profile, teacherId: string, days: number, nowMs = Date.now()): TeacherScorecardRpc {
  if (!Number.isFinite(days) || days < 1) throw new Error("a scorecard's window is at least a day");
  if (!demoMayReadScorecard(viewer, teacherId, days, nowMs)) throw new Error("this teacher's scorecard is not yours to read");
  const teacher = demoProfiles.find((p) => p.id === teacherId);
  if (!teacher) throw new Error("no such teacher");

  const lessons = windowOf(termFor(teacherId, nowMs), days, nowMs);
  const taught = lessons.filter((l) => l.taught);
  const feedback = new Map(demoCoachingHistory().filter((f) => f.teacher_id === teacherId).map((f) => [f.session_id, f]));
  const coached = lessons.flatMap((l) => (feedback.has(l.session_id) ? [feedback.get(l.session_id)!] : []));
  const withMetrics = coached.flatMap((f) => (f.metrics ? [f.metrics] : []));
  const late = lessons.flatMap((l) => (l.mode === "online" && l.host_late_min != null ? [Math.max(0, l.host_late_min)] : []));
  const reports = lessons.flatMap((l) => (l.report ? [l.report] : []));
  const ratings = lessons.flatMap((l) => (l.rating == null ? [] : [l.rating]));
  const followups = lessons.flatMap((l) => l.followups);

  const dimensions = ["engagement", "questioning", "clarity", "rapport"] as const;
  const dimension_averages: Record<string, number> = {};
  for (const key of dimensions) {
    const mean = avg(coached.map((f) => f.dimension_scores[key]));
    if (mean != null) dimension_averages[key] = round(mean, 2)!;
  }

  return {
    teacher: { id: teacher.id, name: displayName(teacher) },
    window_days: days,
    lessons: {
      taught: taught.length,
      online: taught.filter((l) => l.mode === "online").length,
      in_person: taught.filter((l) => l.mode === "in_person").length,
      no_shows: lessons.filter((l) => l.no_show).length,
    },
    punctuality: {
      online_with_host_join: late.length,
      median_minutes_late: round(median(late), 1),
      late_over_5_min: late.filter((m) => m > 5).length,
    },
    coaching: {
      lessons_with_feedback: coached.length,
      dimension_averages,
      strengths_top: top(coached.flatMap((f) => f.strengths)),
      suggestions_top: top(coached.flatMap((f) => f.suggestions)),
    },
    metrics: {
      avg_teacher_talk_pct: round(avg(withMetrics.map((m) => m.teacher_talk_pct)), 2),
      avg_student_talk_pct: round(avg(withMetrics.map((m) => m.student_talk_pct)), 2),
      avg_question_count: round(avg(withMetrics.map((m) => m.question_count)), 2),
      avg_open_question_pct: round(avg(withMetrics.map((m) => m.open_question_pct)), 2),
      avg_wait_ms: round(avg(withMetrics.map((m) => m.avg_wait_ms)), 0),
      avg_praise_count: round(avg(withMetrics.map((m) => m.praise_count)), 2),
    },
    reports: {
      due: taught.length,
      written: reports.length,
      median_hours_to_write: round(median(reports.map((r) => r.hours_after)), 1),
      published: reports.filter((r) => r.status === "published").length,
      rejected: reports.filter((r) => r.status === "rejected").length,
    },
    followups: {
      proposed: followups.filter((s) => s === "proposed").length,
      approved: followups.filter((s) => s === "approved").length,
      done: followups.filter((s) => s === "done").length,
      dismissed: followups.filter((s) => s === "dismissed").length,
    },
    ratings: { count: ratings.length, average: round(avg(ratings), 2) },
    recent_lessons: [...lessons]
      .sort((a, b) => b.effective_start.localeCompare(a.effective_start) || a.session_id.localeCompare(b.session_id))
      .slice(0, 10)
      .map((l) => {
        const student = demoProfiles.find((p) => p.id === l.student_id);
        return {
          session_id: l.session_id,
          at: l.effective_start,
          student_name: student ? displayName(student) : "Student",
          subject: l.course.name,
          mode: l.mode,
          understanding: l.report?.status === "published" ? l.report.understanding : null,
          feedback_summary: feedback.get(l.session_id)?.summary ?? null,
        };
      }),
  };
}

// --- the term ---------------------------------------------------------------

/** The window, decided once: live bookings whose start lies in [now - days, now]. */
function windowOf(term: DemoTermLesson[], days: number, nowMs: number): DemoTermLesson[] {
  const from = nowMs - days * DAY_MS;
  return term.filter((l) => l.status !== "cancelled" && Date.parse(l.effective_start) >= from && Date.parse(l.effective_start) <= nowMs);
}

function termFor(teacherId: string, nowMs: number): DemoTermLesson[] {
  const real = buildDemoSessionRequests()
    .filter((s) => s.assigned_teacher_id === teacherId)
    .map((s) => realLesson(s));
  if (teacherId === ID.maya) return [...real, ...mayaTerm(nowMs)];
  if (teacherId === ID.daniel) return [...real, ...danielTerm(nowMs)];
  return real;
}

/** The facts the room's other demo rows already hold about a real demo booking, plus the room's host join and the household's rating. */
const REAL_FACTS: Record<string, { host_late_min: number | null; rating: number | null }> = {
  "20000000-0000-0000-0000-000000000001": { host_late_min: 0, rating: 5 },
  "20000000-0000-0000-0000-000000000002": { host_late_min: 0, rating: null },
  "20000000-0000-0000-0000-000000000006": { host_late_min: 2, rating: null },
  "20000000-0000-0000-0000-000000000007": { host_late_min: 0, rating: 4 },
};

function realLesson(s: DemoSessionRequest): DemoTermLesson {
  const course = demoCourses.find((c) => c.id === s.course_id)!;
  const report = demoSessionReports.find((r) => r.session_request_id === s.id) ?? null;
  const facts = REAL_FACTS[s.id] ?? { host_late_min: null, rating: null };
  return {
    session_id: s.id,
    effective_start: s.effective_start,
    ends_at: s.ends_at,
    department_id: s.department_id,
    student_id: s.student_id,
    course,
    mode: s.mode,
    status: s.status === "cancelled" ? "cancelled" : s.status === "completed" ? "completed" : "confirmed",
    taught: s.arrived_at != null,
    no_show: false,
    host_late_min: facts.host_late_min,
    report: report
      ? {
          hours_after: Math.max(0, (Date.parse(report.created_at) - Date.parse(s.ends_at)) / 3_600_000),
          status: report.status === "pending" ? "pending" : report.status,
          understanding: report.understanding,
        }
      : null,
    followups: demoFollowups.filter((f) => f.session_id === s.id).map((f) => f.status),
    rating: facts.rating,
  };
}

/** The coaching history's own ids for a teacher's lessons N weeks ago, so a recent lesson with feedback links to its coaching detail. */
function historyId(teacherId: string, weeksAgo: number): string {
  return `${teacherId}-hist-${weeksAgo}`;
}

/**
 * Maya's past term: two online lessons a week for the last 25 weeks, Aarav on
 * IGCSE and Sofia on SAT, with the odd in-person lesson at the centre. Weeks
 * two to five carry the coaching history's rows (weeks one and zero are the
 * real bookings …0007 and …0001). Punctuality, report lag and ratings cycle
 * so a longer window reads as a slightly different teacher than a short one.
 */
function mayaTerm(nowMs: number): DemoTermLesson[] {
  const out: DemoTermLesson[] = [];
  const lateCycle = [0, 0, 1, 0, 7, 0, 0, 2, 0, 0, 0, 12, 0, 3];
  const hoursCycle = [1.5, 3, 0.8, 20, 2.5, 6, 1, 30, 2, 4];
  const ratingCycle: (number | null)[] = [5, null, 4, 5, null, 5, 4, null, 5, 3];
  let n = 0;
  for (let w = 2; w <= 25; w++) {
    const aarav = w % 2 === 1;
    const first = lesson({
      session_id: w <= 5 ? historyId(ID.maya, w) : `${ID.maya}-term-${w}a`,
      start: nowMs - w * 7 * DAY_MS - 3 * 3_600_000,
      student_id: aarav ? ID.aarav : ID.sofia,
      course: aarav ? IGCSE : SAT,
      mode: w % 6 === 0 ? "in_person" : "online",
      status: w === 11 ? "cancelled" : "completed",
      taught: w !== 9,
      no_show: w === 9,
      host_late_min: lateCycle[n % lateCycle.length]!,
      report: w === 9 || w === 3 ? null : { hours_after: hoursCycle[n % hoursCycle.length]!, status: w === 7 ? "rejected" : "published", understanding: 6 + (n % 4) },
      followups: w === 2 ? ["done"] : w === 4 ? ["done", "dismissed"] : w === 6 ? ["approved"] : [],
      rating: ratingCycle[n % ratingCycle.length]!,
    });
    n++;
    const second = lesson({
      session_id: `${ID.maya}-term-${w}b`,
      start: nowMs - w * 7 * DAY_MS - 3 * DAY_MS,
      student_id: aarav ? ID.sofia : ID.aarav,
      course: aarav ? SAT : IGCSE,
      mode: "online",
      status: "completed",
      taught: true,
      no_show: false,
      host_late_min: lateCycle[n % lateCycle.length]!,
      report: { hours_after: hoursCycle[n % hoursCycle.length]!, status: "published", understanding: 5 + (n % 5) },
      followups: w === 8 ? ["done"] : [],
      rating: ratingCycle[n % ratingCycle.length]!,
    });
    n++;
    out.push(first, second);
  }
  return out;
}

/** Daniel's past term: Lena's weekly physics lesson for 24 weeks, every fourth one at the centre; weeks zero to two carry the coaching history's rows. */
function danielTerm(nowMs: number): DemoTermLesson[] {
  const out: DemoTermLesson[] = [];
  const lateCycle = [4, 0, 9, 1, 0, 6, 0, 2];
  const hoursCycle = [26, 4, 48, 3, 18, 2, 52, 5];
  const ratingCycle: (number | null)[] = [4, null, null, 5, null, 4, null, 3];
  for (let w = 0; w <= 24; w++) {
    out.push(
      lesson({
        session_id: w <= 2 ? historyId(ID.daniel, w) : `${ID.daniel}-term-${w}`,
        start: nowMs - w * 7 * DAY_MS - 3 * 3_600_000,
        student_id: ID.lena,
        course: PHYS,
        mode: w % 4 === 3 ? "in_person" : "online",
        status: "completed",
        taught: w !== 14,
        no_show: w === 14,
        host_late_min: lateCycle[w % lateCycle.length]!,
        report: w === 14 || w === 1 ? null : { hours_after: hoursCycle[w % hoursCycle.length]!, status: w === 10 ? "rejected" : "published", understanding: 5 + (w % 4) },
        followups: w === 1 ? ["proposed"] : w === 5 ? ["approved"] : [],
        rating: ratingCycle[w % ratingCycle.length]!,
      }),
    );
  }
  return out;
}

function lesson(x: Omit<DemoTermLesson, "effective_start" | "ends_at" | "department_id"> & { start: number }): DemoTermLesson {
  const { start, ...rest } = x;
  return {
    ...rest,
    effective_start: DateTime.fromMillis(start, { zone: "utc" }).toISO()!,
    ends_at: DateTime.fromMillis(start + 3_600_000, { zone: "utc" }).toISO()!,
    department_id: x.course.department_id!,
  };
}

// --- the arithmetic the SQL does --------------------------------------------

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** percentile_cont(0.5): the middle value, or the mean of the two middle values. */
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function round(n: number | null, places: number): number | null {
  if (n == null) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** The five most repeated texts, most repeated first, ties alphabetical. */
function top(texts: string[]): { text: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of texts) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, 5);
}
