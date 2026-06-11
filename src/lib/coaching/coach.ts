// ============================================================================
// §7.2 Live in-lesson coaching. A rolling state per session, updated on each
// transcript segment; emits subtle, private, rate-limited nudges for the
// teacher only. Pure + deterministic so it can run client-side during a lesson
// and be unit-tested. Guardrails (teacher-only delivery, mute) live in the UI.
// ============================================================================

import type { TranscriptSegment } from "@/lib/coaching/metrics";

export type NudgeType =
  | "teacher_monologue"
  | "student_quiet"
  | "teacher_leading"
  | "low_questions"
  | "ai"; // periodic LLM cue (§7.2 optional pass)

export interface Nudge {
  type: NudgeType;
  message: string;
  at_ms: number;
}

export interface CoachState {
  startedAtMs: number;
  teacherTalkMs: number;
  studentTalkMs: number;
  questionCount: number;
  lastStudentEndMs: number;
  teacherMonologueMs: number; // continuous teacher talk since the student last spoke
  recentNudges: { type: NudgeType; at_ms: number }[];
}

// Thresholds straight from the spec (§7.2), plus rate-limiting guardrails.
const MONOLOGUE_MS = 90_000;
const STUDENT_SILENCE_MS = 120_000;
const TEACHER_PCT_CAP = 0.75;
const WARMUP_MS = 5 * 60_000; // don't critique talk-ratio in the first 5 minutes
const COOLDOWN_MS = 60_000; // min gap between nudges of the same type
const MAX_NUDGES_PER_WINDOW = 3;
const WINDOW_MS = 5 * 60_000;

export function createCoachState(startedAtMs = 0): CoachState {
  return {
    startedAtMs,
    teacherTalkMs: 0,
    studentTalkMs: 0,
    questionCount: 0,
    lastStudentEndMs: startedAtMs,
    teacherMonologueMs: 0,
    recentNudges: [],
  };
}

/**
 * Ingest one transcript segment; mutate the state and return any nudges that
 * should fire now. `nowMs` is the lesson clock at ingestion (defaults to the
 * segment end).
 */
export function ingestSegment(state: CoachState, seg: TranscriptSegment, nowMs = seg.end_ms): Nudge[] {
  const elapsed = nowMs - state.startedAtMs;
  const duration = Math.max(0, seg.end_ms - seg.start_ms);

  if (seg.speaker === "teacher") {
    state.teacherTalkMs += duration;
    state.teacherMonologueMs += duration;
    if (seg.text.trim().endsWith("?")) state.questionCount++;
  } else {
    state.studentTalkMs += duration;
    state.teacherMonologueMs = 0;
    state.lastStudentEndMs = seg.end_ms;
  }

  const msSinceStudentSpoke = nowMs - state.lastStudentEndMs;
  const teacherPct =
    state.teacherTalkMs / (state.teacherTalkMs + state.studentTalkMs || 1);

  const candidates: Nudge[] = [];

  if (state.teacherMonologueMs > MONOLOGUE_MS) {
    candidates.push(mk("teacher_monologue", "Pause — check the student understands.", nowMs));
  }
  if (msSinceStudentSpoke > STUDENT_SILENCE_MS) {
    candidates.push(mk("student_quiet", "Draw them back in with a question.", nowMs));
  }
  if (teacherPct > TEACHER_PCT_CAP && elapsed > WARMUP_MS) {
    candidates.push(mk("teacher_leading", "You're leading a lot — hand them the pen.", nowMs));
  }
  if (elapsed > WARMUP_MS && state.questionCount === 0) {
    candidates.push(mk("low_questions", "Try an open question to get them talking.", nowMs));
  }

  return candidates.filter((n) => admit(state, n));
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
