import { DateTime } from "luxon";
import { heuristicFeedback, type FeedbackMoment } from "@/lib/coaching/analyze";
import type { TranscriptSegment } from "@/lib/coaching/metrics";
import type { FeedbackDetail, FeedbackView } from "@/lib/data/coaching";
import { demoCourses, demoInchargeDepartments } from "@/lib/demo/data";
import type { Profile } from "@/lib/types";

// ---------------------------------------------------------------------------
// Demo synthesis — a believable coaching history with improving talk-ratio and
// questioning over the past weeks, so the dashboard trends are meaningful. The
// two most recent of Maya's are keyed to real demo sessions so the brief finds
// them.
// ---------------------------------------------------------------------------
const MAYA = "00000000-0000-0000-0000-0000000000a1";
const DANIEL = "00000000-0000-0000-0000-0000000000a2";

export function demoCoachingHistory(): FeedbackView[] {
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
export function demoObserves(viewer: Profile, courseName: string): boolean {
  if (viewer.role === "admin" || viewer.role === "support") return true;
  if (viewer.role !== "staff") return false;
  const department = demoCourses.find((c) => c.name === courseName)?.department_id;
  return department != null && (demoInchargeDepartments[viewer.id] ?? []).includes(department);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function demoSegments(): TranscriptSegment[] {
  return [
    { speaker: "teacher", text: "Let's pick up where we left off — completing the square.", start_ms: 5_000, end_ms: 12_000 },
    { speaker: "teacher", text: "Walk me through how you'd start this one.", start_ms: 462_000, end_ms: 466_000 },
    { speaker: "student", text: "I'd move the constant over first, then halve the x coefficient…", start_ms: 468_000, end_ms: 508_000 },
    { speaker: "teacher", text: "It's minus two, see, because the bracket flips the sign.", start_ms: 1_083_000, end_ms: 1_089_000 },
    { speaker: "student", text: "Oh right, I keep forgetting that flip.", start_ms: 1_090_000, end_ms: 1_094_000 },
    { speaker: "teacher", text: "Exactly — and you spotted the restriction on the domain without a hint.", start_ms: 1_875_000, end_ms: 1_881_000 },
  ];
}

export function demoNudges(lessonISO: string): FeedbackDetail["nudges"] {
  const base = DateTime.fromISO(lessonISO, { zone: "utc" });
  return [
    { type: "wait_time", message: "Give them a few seconds to think before jumping in.", created_at: base.plus({ minutes: 18 }).toISO()! },
    { type: "praise_drought", message: "Acknowledge their effort — a little encouragement goes a long way.", created_at: base.plus({ minutes: 33 }).toISO()! },
  ];
}
