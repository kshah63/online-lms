import { DateTime } from "luxon";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { heuristicFeedback } from "@/lib/coaching/analyze";
import type { TranscriptSegment } from "@/lib/coaching/metrics";
import type { FeedbackMoment, TeacherFeedback } from "@/lib/coaching/analyze";
import { demoCourses, demoInchargeDepartments } from "@/lib/demo/data";
import { listMyOnlineLessons } from "@/lib/data/lessons";
import { LESSON_METRICS_COLUMNS } from "@/lib/data/reports";
import { LESSON_FEEDBACK_COLUMNS, type LessonFeedbackRow, type LessonMetricsRow, type OnlineLesson, type Profile } from "@/lib/types";

// ============================================================================
// Coaching, read-only. lesson-finalize writes lesson_feedback and
// lesson_metrics from lesson_transcripts; the room appends lesson_events
// (the live nudges it showed). Who taught whom comes from my_online_lessons:
// a feedback row is shown only for a lesson the viewer's list carries (host
// rows for a teacher, observer rows for the office), so RLS and the listing
// agree on what is theirs to see.
// ============================================================================

export interface FeedbackView {
  session_id: string;
  teacher_id: string;
  teacher_name: string;
  course_name: string;
  student_name: string;
  created_at: string;
  summary: string;
  strengths: string[];
  suggestions: string[];
  moments: FeedbackMoment[];
  dimension_scores: TeacherFeedback["dimension_scores"];
  metrics: Omit<LessonMetricsRow, "session_id" | "computed_at"> | null;
}

/** Everything the coaching detail page needs for one lesson. */
export interface FeedbackDetail extends FeedbackView {
  segments: TranscriptSegment[];
  nudges: { type: string; message: string; created_at: string }[];
}

const DAYS = 30;

/** A teacher's coached lessons, newest first (host rows with a lesson_feedback row). */
export async function getFeedbackHistory(teacher: Profile): Promise<FeedbackView[]> {
  if (isDemoMode) {
    return demoHistory()
      .filter((f) => f.teacher_id === teacher.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  const lessons = (await listMyOnlineLessons(teacher, DAYS)).filter((l) => l.seat === "host");
  return joinFeedback(lessons);
}

/** Office QA: the latest coached lesson of every teacher the viewer observes. */
export async function getAllTeachersLatest(viewer: Profile): Promise<FeedbackView[]> {
  const all = isDemoMode
    ? demoHistory().filter((f) => demoObserves(viewer, f.course_name))
    : await joinFeedback((await listMyOnlineLessons(viewer, DAYS)).filter((l) => l.seat === "observer"));
  const byTeacher = new Map<string, FeedbackView>();
  for (const f of all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
    if (!byTeacher.has(f.teacher_id)) byTeacher.set(f.teacher_id, f);
  }
  return [...byTeacher.values()];
}

/** Average dimension score; used to flag lessons/teachers for review. */
export function avgScore(f: FeedbackView): number {
  const d = f.dimension_scores;
  return round2((d.engagement + d.questioning + d.clarity + d.rapport) / 4);
}

/**
 * Coaching detail for one lesson: feedback + moments + transcript + the live
 * nudges shown during the lesson. Null when the lesson is not in the viewer's
 * list with the right seat, or has no feedback yet.
 */
export async function getFeedbackDetail(viewer: Profile, sessionId: string): Promise<FeedbackDetail | null> {
  if (isDemoMode) {
    const view = demoHistory().find((f) => f.session_id === sessionId);
    if (!view) return null;
    if (viewer.role === "teacher" ? view.teacher_id !== viewer.id : !demoObserves(viewer, view.course_name)) return null;
    return { ...view, segments: demoSegments(), nudges: demoNudges(view.created_at) };
  }

  const wanted = viewer.role === "teacher" ? "host" : "observer";
  const lesson = (await listMyOnlineLessons(viewer, DAYS)).find((l) => l.session_id === sessionId && l.seat === wanted);
  if (!lesson) return null;
  const [view] = await joinFeedback([lesson]);
  if (!view) return null;

  const supabase = createSupabaseServerClient()!;
  const [transcript, events] = await Promise.all([
    supabase.from("lesson_transcripts").select("segments").eq("session_id", sessionId).maybeSingle(),
    supabase.from("lesson_events").select("kind, payload, at").eq("session_id", sessionId).order("at"),
  ]);
  if (transcript.error) throw new Error(`lesson_transcripts failed: ${transcript.error.message}`);
  if (events.error) throw new Error(`lesson_events failed: ${events.error.message}`);

  const segments = Array.isArray(transcript.data?.segments) ? (transcript.data!.segments as TranscriptSegment[]) : [];
  const nudges = ((events.data ?? []) as { kind: string; payload: Record<string, unknown> | null; at: string }[])
    .filter((e) => typeof e.payload?.message === "string")
    .map((e) => ({ type: e.kind, message: String(e.payload!.message), created_at: e.at }));
  return { ...view, segments, nudges };
}

/** Select lesson_feedback and lesson_metrics for the given lessons and label each with its teacher, course and student. */
async function joinFeedback(lessons: OnlineLesson[]): Promise<FeedbackView[]> {
  if (lessons.length === 0) return [];
  const ids = lessons.map((l) => l.session_id);
  const supabase = createSupabaseServerClient()!;
  const [feedback, metrics] = await Promise.all([
    supabase.from("lesson_feedback").select(LESSON_FEEDBACK_COLUMNS).in("session_id", ids),
    supabase.from("lesson_metrics").select(LESSON_METRICS_COLUMNS).in("session_id", ids),
  ]);
  if (feedback.error) throw new Error(`lesson_feedback failed: ${feedback.error.message}`);
  if (metrics.error) throw new Error(`lesson_metrics failed: ${metrics.error.message}`);

  const metricsBySession = new Map(((metrics.data ?? []) as LessonMetricsRow[]).map((m) => [m.session_id, m]));
  const bySession = new Map(lessons.map((l) => [l.session_id, l]));
  return ((feedback.data ?? []) as LessonFeedbackRow[]).flatMap((f) => {
    const lesson = bySession.get(f.session_id);
    if (!lesson) return [];
    const m = metricsBySession.get(f.session_id);
    return [
      {
        session_id: f.session_id,
        teacher_id: lesson.teacher_id ?? "",
        teacher_name: lesson.teacher_name ?? "Teacher",
        course_name: lesson.subject ?? "Lesson",
        student_name: lesson.student_name,
        created_at: f.created_at,
        summary: f.summary,
        strengths: f.strengths ?? [],
        suggestions: f.suggestions ?? [],
        moments: f.moments ?? [],
        dimension_scores: f.dimension_scores,
        metrics: m ? stripMetrics(m) : null,
      },
    ];
  });
}

function stripMetrics(m: LessonMetricsRow): FeedbackView["metrics"] {
  const { session_id: _s, computed_at: _c, ...rest } = m;
  void _s;
  void _c;
  return rest;
}

// ---------------------------------------------------------------------------
// Demo synthesis — a believable coaching history with improving talk-ratio and
// questioning over the past weeks, so the dashboard trends are meaningful. The
// two most recent of Maya's are keyed to real demo sessions so the brief finds
// them.
// ---------------------------------------------------------------------------
const MAYA = "00000000-0000-0000-0000-0000000000a1";
const DANIEL = "00000000-0000-0000-0000-0000000000a2";

function demoHistory(): FeedbackView[] {
  const out: FeedbackView[] = [];

  // Maya: 6 lessons, student talk climbing 0.28 → 0.47, questions 3 → 9.
  const mayaPoints = [
    { talk: 0.28, q: 3, open: 0.33, praise: 1, wait: 1400, course: "IGCSE Mathematics", student: "Aarav Sharma" },
    { talk: 0.31, q: 4, open: 0.4, praise: 2, wait: 1700, course: "SAT Math Prep", student: "Sofia Rossi" },
    { talk: 0.36, q: 5, open: 0.45, praise: 2, wait: 2100, course: "IGCSE Mathematics", student: "Aarav Sharma" },
    { talk: 0.4, q: 6, open: 0.5, praise: 3, wait: 2400, course: "SAT Math Prep", student: "Sofia Rossi" },
    { talk: 0.44, q: 8, open: 0.55, praise: 3, wait: 2800, course: "SAT Math Prep", student: "Sofia Rossi", session: "20000000-0000-0000-0000-000000000007" },
    { talk: 0.47, q: 9, open: 0.6, praise: 4, wait: 3100, course: "IGCSE Mathematics", student: "Aarav Sharma", session: "20000000-0000-0000-0000-000000000001" },
  ];
  mayaPoints.forEach((p, i) => out.push(synth(MAYA, "Maya Chen", p, mayaPoints.length - 1 - i)));

  // Daniel: 3 lessons, steadier.
  const danielPoints = [
    { talk: 0.34, q: 5, open: 0.4, praise: 2, wait: 2000, course: "A-Level Physics", student: "Lena Park" },
    { talk: 0.3, q: 4, open: 0.35, praise: 1, wait: 1800, course: "A-Level Physics", student: "Lena Park" },
    { talk: 0.38, q: 6, open: 0.5, praise: 3, wait: 2600, course: "A-Level Physics", student: "Lena Park" },
  ];
  danielPoints.forEach((p, i) => out.push(synth(DANIEL, "Daniel Okafor", p, danielPoints.length - 1 - i)));

  return out;
}

function synth(
  teacherId: string,
  teacherName: string,
  p: { talk: number; q: number; open: number; praise: number; wait: number; course: string; student: string; session?: string },
  weeksAgo: number,
): FeedbackView {
  const metrics = {
    teacher_talk_pct: round2(1 - p.talk),
    student_talk_pct: p.talk,
    question_count: p.q,
    open_question_pct: p.open,
    avg_wait_ms: p.wait,
    student_turns: Math.round(p.q * 1.6),
    praise_count: p.praise,
  };
  const fb = heuristicFeedback({ ...metrics, avg_student_turn_ms: Math.round(8000 + p.talk * 12000) });
  return {
    session_id: p.session ?? `${teacherId}-hist-${weeksAgo}`,
    teacher_id: teacherId,
    teacher_name: teacherName,
    course_name: p.course,
    student_name: p.student,
    created_at: DateTime.utc().minus({ weeks: weeksAgo, hours: 2 }).toISO()!,
    summary: fb.summary,
    strengths: fb.strengths,
    suggestions: fb.suggestions,
    moments: demoMoments(p.student),
    dimension_scores: fb.dimension_scores,
    metrics,
  };
}

function demoMoments(student: string): FeedbackMoment[] {
  const first = student.split(" ")[0];
  return [
    {
      at: "07:42",
      kind: "strength",
      quote: `Walk me through how you'd start this one, ${first}.`,
      comment: "Open hand-off that put the thinking on the student — they talked for 40s straight after this.",
    },
    {
      at: "18:03",
      kind: "improvement",
      quote: "It's minus two, see, because the bracket flips the sign.",
      comment: `You answered your own question after ~1s. Try waiting 3-5s, or narrowing it: "what happens to the sign inside the bracket?"`,
    },
    {
      at: "31:15",
      kind: "strength",
      quote: "Exactly — and you spotted the restriction on the domain without a hint.",
      comment: "Specific, earned praise tied to what they actually did; this is the kind that builds confidence.",
    },
  ];
}

/** Mirrors the observer seat in demo: admin and support see every room, an in-charge their own departments. */
function demoObserves(viewer: Profile, courseName: string): boolean {
  if (viewer.role === "admin" || viewer.role === "support") return true;
  if (viewer.role !== "staff") return false;
  const department = demoCourses.find((c) => c.name === courseName)?.department_id;
  return department != null && (demoInchargeDepartments[viewer.id] ?? []).includes(department);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function demoSegments(): TranscriptSegment[] {
  return [
    { speaker: "teacher", text: "Let's pick up where we left off — completing the square.", start_ms: 5_000, end_ms: 12_000 },
    { speaker: "teacher", text: "Walk me through how you'd start this one.", start_ms: 462_000, end_ms: 466_000 },
    { speaker: "student", text: "I'd move the constant over first, then halve the x coefficient…", start_ms: 468_000, end_ms: 508_000 },
    { speaker: "teacher", text: "It's minus two, see, because the bracket flips the sign.", start_ms: 1_083_000, end_ms: 1_089_000 },
    { speaker: "student", text: "Oh right, I keep forgetting that flip.", start_ms: 1_090_000, end_ms: 1_094_000 },
    { speaker: "teacher", text: "Exactly — and you spotted the restriction on the domain without a hint.", start_ms: 1_875_000, end_ms: 1_881_000 },
  ];
}

function demoNudges(lessonISO: string): FeedbackDetail["nudges"] {
  const base = DateTime.fromISO(lessonISO, { zone: "utc" });
  return [
    { type: "wait_time", message: "Give them a few seconds to think before jumping in.", created_at: base.plus({ minutes: 18 }).toISO()! },
    { type: "praise_drought", message: "Acknowledge their effort — a little encouragement goes a long way.", created_at: base.plus({ minutes: 33 }).toISO()! },
  ];
}

/** The coaching moments for a session when the viewer's list carries it (used by the brief). */
export async function getMomentsForSession(viewer: Profile, sessionId: string): Promise<FeedbackMoment[]> {
  if (isDemoMode) return demoHistory().find((f) => f.session_id === sessionId && f.teacher_id === viewer.id)?.moments ?? [];
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("lesson_feedback").select("moments").eq("session_id", sessionId).maybeSingle();
  if (error) throw new Error(`lesson_feedback failed: ${error.message}`);
  return Array.isArray(data?.moments) ? (data!.moments as FeedbackMoment[]) : [];
}
