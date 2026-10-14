import { DateTime } from "luxon";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import type { TranscriptSegment } from "@/lib/coaching/metrics";
import type { FeedbackMoment, TeacherFeedback } from "@/lib/coaching/analyze";
import { demoCoachingHistory, demoNudges, demoObserves, demoSegments } from "@/lib/demo/coaching";
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
    return demoCoachingHistory()
      .filter((f) => f.teacher_id === teacher.id)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  const lessons = (await listMyOnlineLessons(teacher, DAYS)).filter((l) => l.seat === "host");
  return joinFeedback(lessons);
}

/** Office QA: the latest coached lesson of every teacher the viewer observes. */
export async function getAllTeachersLatest(viewer: Profile): Promise<FeedbackView[]> {
  const all = isDemoMode
    ? demoCoachingHistory().filter((f) => demoObserves(viewer, f.course_name))
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
    const view = demoCoachingHistory().find((f) => f.session_id === sessionId);
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

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** The coaching moments for a session when the viewer's list carries it (used by the brief). */
export async function getMomentsForSession(viewer: Profile, sessionId: string): Promise<FeedbackMoment[]> {
  if (isDemoMode) return demoCoachingHistory().find((f) => f.session_id === sessionId && f.teacher_id === viewer.id)?.moments ?? [];
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("lesson_feedback").select("moments").eq("session_id", sessionId).maybeSingle();
  if (error) throw new Error(`lesson_feedback failed: ${error.message}`);
  return Array.isArray(data?.moments) ? (data!.moments as FeedbackMoment[]) : [];
}
