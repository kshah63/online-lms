import type { SessionStatus } from "@/lib/types";

// ============================================================================
// When a room is open. Mirrors rpc room_access: a seat exists for a confirmed
// or completed online session from 15 minutes before effective_start until 30
// minutes after coalesce(ends_at, effective_start + duration_minutes). The
// database decides; this copy only drives link rendering and the demo dataset.
// ============================================================================

export const ROOM_OPENS_BEFORE_MIN = 15;
export const ROOM_CLOSES_AFTER_MIN = 30;

export interface LessonWindow {
  status: SessionStatus;
  mode: "in_person" | "online";
  effective_start: string;
  ends_at: string | null;
  duration_minutes: number | null;
}

/** The lesson's scheduled end: ends_at, else start + duration (60 min when unknown). */
export function lessonEndISO(l: Pick<LessonWindow, "effective_start" | "ends_at" | "duration_minutes">): string {
  if (l.ends_at) return l.ends_at;
  const start = Date.parse(l.effective_start);
  const minutes = l.duration_minutes ?? 60;
  return new Date(start + minutes * 60_000).toISOString();
}

/** True while room_access would give the assigned teacher or the student a seat. */
export function roomIsOpen(l: LessonWindow, nowMs = Date.now()): boolean {
  if (l.mode !== "online") return false;
  if (l.status !== "confirmed" && l.status !== "completed") return false;
  const opens = Date.parse(l.effective_start) - ROOM_OPENS_BEFORE_MIN * 60_000;
  const closes = Date.parse(lessonEndISO(l)) + ROOM_CLOSES_AFTER_MIN * 60_000;
  return nowMs >= opens && nowMs <= closes;
}

/** The lesson is running right now (inside its booked slot). */
export function lessonIsLive(l: LessonWindow, nowMs = Date.now()): boolean {
  if (l.status !== "confirmed" && l.status !== "completed") return false;
  return nowMs >= Date.parse(l.effective_start) && nowMs <= Date.parse(lessonEndISO(l));
}
