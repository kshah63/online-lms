"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { computeMetrics, type TranscriptSegment } from "@/lib/coaching/metrics";
import { analyzeLesson, type TeacherFeedback } from "@/lib/coaching/analyze";

/**
 * On session end: run the post-session analysis on the transcript the room
 * held and return the teacher feedback so the UI can show it immediately.
 *
 * Nothing is persisted here any more: rpc lesson_end (src/lib/actions/lesson.ts)
 * stores the transcript on lesson_transcripts and invokes the lesson-finalize
 * edge function, which writes lesson_metrics and lesson_feedback with the
 * service role. This local pass keeps the coaching UI working until that
 * pipeline is live; the coaching pages read lesson_feedback.
 */
export async function finalizeLesson(
  sessionId: string,
  segments: TranscriptSegment[],
  ctx: { teacherName: string; studentName: string; course: string },
): Promise<TeacherFeedback> {
  const profile = await getCurrentProfile();
  const metrics = computeMetrics(segments);

  // Cap model spend per teacher; over the limit we still return a (heuristic) report.
  const useAi = await rateLimit(
    `ai:finalize:${profile?.id ?? "anon"}:${sessionId}`,
    LIMITS.finalizeLesson.limit,
    LIMITS.finalizeLesson.windowSeconds,
  );
  return analyzeLesson(segments, metrics, ctx, { useAi });
}

/** Log a live nudge that was shown to the teacher (lesson_events, append-only). */
export async function logLiveEvent(
  sessionId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (isDemoMode) return;
  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.rpc("log_lesson_event", { p_session_id: sessionId, p_kind: type, p_payload: payload });
  if (error) console.error("log_lesson_event failed:", error.message);
}
