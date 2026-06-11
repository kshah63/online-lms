import { DateTime } from "luxon";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { demoProfiles } from "@/lib/demo/data";
import { heuristicFeedback } from "@/lib/coaching/analyze";
import type { SessionMetrics } from "@/lib/coaching/metrics";
import type { TeacherFeedback } from "@/lib/coaching/analyze";

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
  dimension_scores: TeacherFeedback["dimension_scores"];
  metrics: SessionMetrics | null;
}

// ---------------------------------------------------------------------------
// Demo synthesis — a believable coaching history with improving talk-ratio and
// questioning over the past weeks, so the dashboard trends are meaningful.
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
    { talk: 0.44, q: 8, open: 0.55, praise: 3, wait: 2800, course: "IGCSE Mathematics", student: "Aarav Sharma" },
    { talk: 0.47, q: 9, open: 0.6, praise: 4, wait: 3100, course: "SAT Math Prep", student: "Sofia Rossi" },
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
  p: { talk: number; q: number; open: number; praise: number; wait: number; course: string; student: string },
  weeksAgo: number,
): FeedbackView {
  const metrics: SessionMetrics = {
    teacher_talk_pct: round2(1 - p.talk),
    student_talk_pct: p.talk,
    question_count: p.q,
    open_question_pct: p.open,
    avg_wait_ms: p.wait,
    student_turns: Math.round(p.q * 1.6),
    avg_student_turn_ms: Math.round(8000 + p.talk * 12000),
    praise_count: p.praise,
  };
  const fb = heuristicFeedback(metrics);
  return {
    session_id: `${teacherId}-hist-${weeksAgo}`,
    teacher_id: teacherId,
    teacher_name: teacherName,
    course_name: p.course,
    student_name: p.student,
    created_at: DateTime.utc().minus({ weeks: weeksAgo, hours: 2 }).toISO()!,
    summary: fb.summary,
    strengths: fb.strengths,
    suggestions: fb.suggestions,
    dimension_scores: fb.dimension_scores,
    metrics,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Public accessors
// ---------------------------------------------------------------------------

/** Full feedback history for a teacher, newest first. */
export async function getFeedbackHistory(teacherId: string): Promise<FeedbackView[]> {
  if (isDemoMode) {
    return demoHistory()
      .filter((f) => f.teacher_id === teacherId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("teacher_feedback")
    .select(
      `session_id, teacher_id, summary, strengths, suggestions, dimension_scores, created_at,
       session:sessions!teacher_feedback_session_id_fkey(course:courses(name), student:profiles!sessions_student_id_fkey(display_name), metrics:session_metrics(*)),
       teacher:profiles!teacher_feedback_teacher_id_fkey(display_name)`,
    )
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function getLatestFeedback(teacherId: string): Promise<FeedbackView | null> {
  const history = await getFeedbackHistory(teacherId);
  return history[0] ?? null;
}

/** Admin QA: the latest feedback for every teacher, flagged if low engagement. */
export async function getAllTeachersLatest(): Promise<FeedbackView[]> {
  if (isDemoMode) {
    const byTeacher = new Map<string, FeedbackView>();
    for (const f of demoHistory().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
      if (!byTeacher.has(f.teacher_id)) byTeacher.set(f.teacher_id, f);
    }
    return [...byTeacher.values()];
  }

  const teachers = demoProfiles.filter((p) => p.role === "teacher"); // shape only; real path below
  void teachers;
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("teacher_feedback")
    .select(
      `session_id, teacher_id, summary, strengths, suggestions, dimension_scores, created_at,
       session:sessions!teacher_feedback_session_id_fkey(course:courses(name), student:profiles!sessions_student_id_fkey(display_name), metrics:session_metrics(*)),
       teacher:profiles!teacher_feedback_teacher_id_fkey(display_name)`,
    )
    .order("created_at", { ascending: false });
  if (error) throw error;

  const seen = new Set<string>();
  const latest: FeedbackView[] = [];
  for (const row of data ?? []) {
    const view = mapRow(row);
    if (!seen.has(view.teacher_id)) {
      seen.add(view.teacher_id);
      latest.push(view);
    }
  }
  return latest;
}

/** Average dimension score; used to flag lessons/teachers for review. */
export function avgScore(f: FeedbackView): number {
  const d = f.dimension_scores;
  return round2((d.engagement + d.questioning + d.clarity + d.rapport) / 4);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): FeedbackView {
  const session = row.session ?? {};
  return {
    session_id: row.session_id,
    teacher_id: row.teacher_id,
    teacher_name: row.teacher?.display_name ?? "Teacher",
    course_name: session.course?.name ?? "Lesson",
    student_name: session.student?.display_name ?? "Student",
    created_at: row.created_at,
    summary: row.summary ?? "",
    strengths: row.strengths ?? [],
    suggestions: row.suggestions ?? [],
    dimension_scores: row.dimension_scores ?? { engagement: 0, questioning: 0, clarity: 0, rapport: 0 },
    metrics: session.metrics ?? null,
  };
}
