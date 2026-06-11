// ============================================================================
// §7.2 Live in-lesson coaching. A rolling state per session, updated on each
// transcript segment AND on a periodic tick (so time-based cues like silence
// fire even when no one is speaking). Emits subtle, private, rate-limited
// nudges for the teacher only. Pure + deterministic so it can run client-side
// and be unit-tested. Guardrails (teacher-only delivery, mute) live in the UI.
// ============================================================================

import type { TranscriptSegment } from "@/lib/coaching/metrics";

export type NudgeType =
  | "teacher_monologue"
  | "student_quiet"
  | "both_quiet"
  | "teacher_leading"
  | "low_questions"
  | "wait_time"
  | "closed_questions"
  | "praise_drought"
  | "confusion"
  | "ai"; // periodic LLM cue (§7.2 optional pass)

export interface Nudge {
  type: NudgeType;
  message: string;
  at_ms: number;
}

export interface CoachState {
  startedAtMs: number; // 0 until the first segment anchors it
  teacherTalkMs: number;
  studentTalkMs: number;
  questionCount: number;
  studentTurns: number;
  lastStudentEndMs: number;
  lastAnySpeechMs: number;
  lastPraiseMs: number;
  teacherMonologueMs: number; // continuous teacher talk since the student last spoke
  awaitingAnswer: boolean; // teacher asked a question, waiting for the student
  lastQuestionEndMs: number;
  closedStreak: number; // consecutive closed (yes/no) questions
  recentNudges: { type: NudgeType; at_ms: number }[];
}

// Thresholds (§7.2) + rate-limiting guardrails.
const MONOLOGUE_MS = 90_000;
const STUDENT_SILENCE_MS = 120_000;
const BOTH_SILENT_MS = 35_000;
const TEACHER_PCT_CAP = 0.75;
const WARMUP_MS = 5 * 60_000; // don't critique ratio/questions/praise in the first 5 min
const WAIT_MS = 3_000; // a question deserves ~3s of think-time
const CLOSED_STREAK = 3;
const PRAISE_DROUGHT_MS = 6 * 60_000;
const COOLDOWN_MS = 60_000; // min gap between nudges of the same type
const MAX_NUDGES_PER_WINDOW = 3;
const WINDOW_MS = 5 * 60_000;

const OPEN_STARTERS = ["how", "why", "what", "describe", "explain", "tell", "walk", "where", "which"];
const PRAISE = [
  "great",
  "good job",
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
  "good thinking",
  "well thought",
  "good work",
];
const CONFUSION = [
  "i don't get",
  "i dont get",
  "don't understand",
  "dont understand",
  "i'm confused",
  "im confused",
  "confused",
  "i'm lost",
  "im lost",
  "no idea",
  "i'm stuck",
  "im stuck",
  "i am stuck",
  "what do you mean",
  "makes no sense",
  "don't know how",
  "dont know how",
];

export function createCoachState(startedAtMs = 0): CoachState {
  return {
    startedAtMs,
    teacherTalkMs: 0,
    studentTalkMs: 0,
    questionCount: 0,
    studentTurns: 0,
    lastStudentEndMs: startedAtMs,
    lastAnySpeechMs: startedAtMs,
    lastPraiseMs: startedAtMs,
    teacherMonologueMs: 0,
    awaitingAnswer: false,
    lastQuestionEndMs: 0,
    closedStreak: 0,
    recentNudges: [],
  };
}

function isQuestion(text: string) {
  return text.trim().endsWith("?");
}
function isOpen(text: string) {
  const first = text.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return OPEN_STARTERS.includes(first);
}
function has(text: string, list: string[]) {
  const lower = text.toLowerCase();
  return list.some((p) => lower.includes(p));
}

/** Ingest one transcript segment; mutate state and return any nudges to fire now. */
export function ingestSegment(state: CoachState, seg: TranscriptSegment, nowMs = seg.end_ms): Nudge[] {
  // Anchor the clock to the first segment we see.
  if (state.startedAtMs === 0) {
    state.startedAtMs = seg.start_ms;
    state.lastStudentEndMs = seg.start_ms;
    state.lastAnySpeechMs = seg.start_ms;
    state.lastPraiseMs = seg.start_ms;
  }

  const duration = Math.max(0, seg.end_ms - seg.start_ms);
  const elapsed = nowMs - state.startedAtMs;
  state.lastAnySpeechMs = Math.max(state.lastAnySpeechMs, seg.end_ms);
  const out: Nudge[] = [];

  if (seg.speaker === "teacher") {
    // Wait-time: teacher speaks again too soon after their own question.
    if (state.awaitingAnswer && seg.start_ms - state.lastQuestionEndMs < WAIT_MS) {
      out.push(mk("wait_time", "Give them a few seconds to think before jumping in.", nowMs));
      state.awaitingAnswer = false;
    }

    state.teacherTalkMs += duration;
    state.teacherMonologueMs += duration;
    if (has(seg.text, PRAISE)) state.lastPraiseMs = seg.end_ms;

    if (isQuestion(seg.text)) {
      state.questionCount++;
      state.awaitingAnswer = true;
      state.lastQuestionEndMs = seg.end_ms;
      if (isOpen(seg.text)) {
        state.closedStreak = 0;
      } else {
        state.closedStreak++;
        if (state.closedStreak >= CLOSED_STREAK) {
          out.push(mk("closed_questions", "Mix in an open 'why' or 'how' question.", nowMs));
          state.closedStreak = 0;
        }
      }
    }

    if (state.teacherMonologueMs > MONOLOGUE_MS) {
      out.push(mk("teacher_monologue", "Pause — check the student understands.", nowMs));
    }

    const teacherPct = state.teacherTalkMs / (state.teacherTalkMs + state.studentTalkMs || 1);
    if (teacherPct > TEACHER_PCT_CAP && elapsed > WARMUP_MS) {
      out.push(mk("teacher_leading", "You're leading a lot — hand them the pen.", nowMs));
    }
    if (elapsed > WARMUP_MS && state.questionCount === 0) {
      out.push(mk("low_questions", "Try an open question to get them talking.", nowMs));
    }
  } else {
    state.studentTalkMs += duration;
    state.teacherMonologueMs = 0;
    state.lastStudentEndMs = seg.end_ms;
    state.studentTurns++;
    state.awaitingAnswer = false; // they answered

    if (has(seg.text, CONFUSION)) {
      out.push(mk("confusion", "They're stuck — try a worked example or a simpler step.", nowMs));
    }
  }

  return out.filter((n) => admit(state, n));
}

/** Periodic evaluation for time-based cues that fire during silence. `nowMs`
 * must share the segments' timescale (real epoch in production). */
export function evaluateTick(state: CoachState, nowMs: number): Nudge[] {
  if (state.startedAtMs === 0) return [];
  const elapsed = nowMs - state.startedAtMs;
  const out: Nudge[] = [];

  if (nowMs - state.lastStudentEndMs > STUDENT_SILENCE_MS) {
    out.push(mk("student_quiet", "Draw them back in with a question.", nowMs));
  }
  if (nowMs - state.lastAnySpeechMs > BOTH_SILENT_MS && elapsed > 60_000) {
    out.push(mk("both_quiet", "It's gone quiet — check in: is everything okay?", nowMs));
  }
  if (elapsed > WARMUP_MS && state.studentTurns >= 2 && nowMs - state.lastPraiseMs > PRAISE_DROUGHT_MS) {
    out.push(mk("praise_drought", "Acknowledge their effort — a little encouragement goes a long way.", nowMs));
  }
  if (state.teacherMonologueMs > MONOLOGUE_MS) {
    out.push(mk("teacher_monologue", "Pause — check the student understands.", nowMs));
  }

  return out.filter((n) => admit(state, n));
}

function mk(type: NudgeType, message: string, at_ms: number): Nudge {
  return { type, message, at_ms };
}

/** Rate-limiting: per-type cooldown + a cap per rolling window. */
function admit(state: CoachState, nudge: Nudge): boolean {
  const windowStart = nudge.at_ms - WINDOW_MS;
  state.recentNudges = state.recentNudges.filter((n) => n.at_ms >= windowStart);

  if (state.recentNudges.length >= MAX_NUDGES_PER_WINDOW) return false;
  const lastSameType = state.recentNudges
    .filter((n) => n.type === nudge.type)
    .sort((a, b) => b.at_ms - a.at_ms)[0];
  if (lastSameType && nudge.at_ms - lastSameType.at_ms < COOLDOWN_MS) return false;

  state.recentNudges.push({ type: nudge.type, at_ms: nudge.at_ms });
  return true;
}
