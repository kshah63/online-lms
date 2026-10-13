"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import type { TranscriptSegment } from "@/lib/coaching/metrics";

// ============================================================================
// The room's writes to the booking, through mv-app's RPCs only:
//   lesson_join(p_session_id)              — the learner, on first join; sets arrived_at
//   lesson_host_join(p_session_id)         — the host, on first join; sets host_joined_at
//   lesson_end(p_session_id, p_segments)   — the host (or in-charge / admin); sets
//                                            departed_at, stores the transcript and
//                                            invokes lesson-finalize
//   log_lesson_event(p_session_id, kind, payload) — append-only room events
// A failed call is surfaced, never swallowed.
// ============================================================================

/** The learner has joined: returns the arrival time the clock counts from. */
export async function joinLesson(sessionId: string): Promise<{ arrived_at: string }> {
  if (isDemoMode) return { arrived_at: new Date().toISOString() };

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("lesson_join", { p_session_id: sessionId });
  if (error) throw new Error(`lesson_join failed: ${error.message}`);
  return { arrived_at: typeof data === "string" && data ? data : new Date().toISOString() };
}

/**
 * The host has joined: rpc lesson_host_join stamps lesson_rooms.host_joined_at
 * once, so the no-join sweep can tell a student waiting alone from a lesson
 * under way. room_access decides who the host is; a refusal is surfaced.
 */
export async function hostArrived(sessionId: string): Promise<void> {
  if (isDemoMode) return;

  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.rpc("lesson_host_join", { p_session_id: sessionId });
  if (error) throw new Error(`lesson_host_join failed: ${error.message}`);
}

/** The host ends the lesson with the transcript the room held. */
export async function endLesson(sessionId: string, segments: TranscriptSegment[]): Promise<void> {
  if (isDemoMode) return;

  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.rpc("lesson_end", { p_session_id: sessionId, p_segments: segments });
  if (error) throw new Error(`lesson_end failed: ${error.message}`);
}

/** Log a room event (a live nudge shown, an activity pushed, …). */
export async function logLessonEvent(sessionId: string, kind: string, payload: Record<string, unknown>): Promise<void> {
  if (isDemoMode) return;

  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.rpc("log_lesson_event", { p_session_id: sessionId, p_kind: kind, p_payload: payload });
  if (error) throw new Error(`log_lesson_event failed: ${error.message}`);
}
