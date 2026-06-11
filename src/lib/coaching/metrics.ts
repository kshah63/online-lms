// ============================================================================
// §7.1 Transcript → metrics. Pure functions, shared by the live coach (client)
// and the post-session analysis (server). No external dependencies.
// ============================================================================

export interface TranscriptSegment {
  speaker: "teacher" | "student";
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface SessionMetrics {
  teacher_talk_pct: number;
  student_talk_pct: number;
  question_count: number;
  open_question_pct: number;
  avg_wait_ms: number;
  student_turns: number;
  avg_student_turn_ms: number;
  praise_count: number;
}

const OPEN_STARTERS = ["how", "why", "what", "describe", "explain", "tell", "walk", "where", "which"];
const PRAISE = [
  "great",
  "good job",
  "good work",
  "well done",
  "excellent",
  "nice",
  "exactly",
  "perfect",
  "brilliant",
  "awesome",
  "fantastic",
  "that's right",
  "thats right",
  "well thought",
  "good thinking",
];

function dur(s: TranscriptSegment) {
  return Math.max(0, s.end_ms - s.start_ms);
}

function isQuestion(text: string) {
  return text.trim().endsWith("?");
}

function isOpenQuestion(text: string) {
  const first = text.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return OPEN_STARTERS.includes(first);
}

function hasPraise(text: string) {
  const lower = text.toLowerCase();
  return PRAISE.some((p) => lower.includes(p));
}

/** Compute the full metric set from an ordered transcript. */
export function computeMetrics(segments: TranscriptSegment[]): SessionMetrics {
  if (segments.length === 0) {
    return {
      teacher_talk_pct: 0,
      student_talk_pct: 0,
      question_count: 0,
      open_question_pct: 0,
      avg_wait_ms: 0,
      student_turns: 0,
      avg_student_turn_ms: 0,
      praise_count: 0,
    };
  }

  const ordered = [...segments].sort((a, b) => a.start_ms - b.start_ms);

  let teacherMs = 0;
  let studentMs = 0;
  let questionCount = 0;
  let openCount = 0;
  let praiseCount = 0;
  const waits: number[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const seg = ordered[i];
    if (seg.speaker === "teacher") {
      teacherMs += dur(seg);
      if (hasPraise(seg.text)) praiseCount++;
      if (isQuestion(seg.text)) {
        questionCount++;
        if (isOpenQuestion(seg.text)) openCount++;
        // wait-time: silence until the next student turn starts
        const next = ordered.slice(i + 1).find((s) => s.speaker === "student");
        if (next) waits.push(Math.max(0, next.start_ms - seg.end_ms));
      }
    } else {
      studentMs += dur(seg);
    }
  }

  // Student turns = contiguous runs of student speech.
  const turns: number[] = [];
  let runStart: number | null = null;
  let runEnd = 0;
  for (const seg of ordered) {
    if (seg.speaker === "student") {
      if (runStart === null) runStart = seg.start_ms;
      runEnd = seg.end_ms;
    } else if (runStart !== null) {
      turns.push(runEnd - runStart);
      runStart = null;
    }
  }
  if (runStart !== null) turns.push(runEnd - runStart);

  const totalSpeech = teacherMs + studentMs || 1;
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

  return {
    teacher_talk_pct: round2(teacherMs / totalSpeech),
    student_talk_pct: round2(studentMs / totalSpeech),
    question_count: questionCount,
    open_question_pct: questionCount ? round2(openCount / questionCount) : 0,
    avg_wait_ms: avg(waits),
    student_turns: turns.length,
    avg_student_turn_ms: avg(turns),
    praise_count: praiseCount,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
