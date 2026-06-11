"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { computeMetrics, type TranscriptSegment } from "@/lib/coaching/metrics";
import { analyzeLesson, type TeacherFeedback } from "@/lib/coaching/analyze";

/**
 * §7.3 On session end: persist the transcript + metrics, run the post-session
 * AI analysis, and save the teacher feedback. Returns the feedback so the UI
 * can show it immediately. In demo mode nothing is persisted.
 */
export async function finalizeLesson(
  sessionId: string,
  segments: TranscriptSegment[],
  ctx: { teacherName: string; studentName: string; course: string },
): Promise<TeacherFeedback> {
  const profile = await getCurrentProfile();
  const metrics = computeMetrics(segments);

  // Cap Opus spend per teacher; over the limit we still return a (heuristic) report.
  const useAi = await rateLimit(
    `ai:finalize:${profile?.id ?? "anon"}`,
    LIMITS.finalizeLesson.limit,
    LIMITS.finalizeLesson.windowSeconds,
  );
  const feedback = await analyzeLesson(segments, metrics, ctx, { useAi });

  if (isDemoMode) return feedback;

  const supabase = createSupabaseServerClient()!;

  await supabase.from("transcripts").upsert({ session_id: sessionId, segments });
  await supabase
    .from("session_metrics")
    .upsert({ session_id: sessionId, ...metrics, computed_at: new Date().toISOString() });
  await supabase.from("teacher_feedback").upsert({
    session_id: sessionId,
    teacher_id: profile?.id ?? null,
    summary: feedback.summary,
    strengths: feedback.strengths,
    suggestions: feedback.suggestions,
    dimension_scores: feedback.dimension_scores,
  });
  await supabase
    .from("sessions")
    .update({ status: "completed", actual_end: new Date().toISOString() })
    .eq("id", sessionId);

  revalidatePath("/teacher/coaching");
  revalidatePath("/admin/coaching");
  return feedback;
}

/** §7.2 Log a live nudge that was shown to the teacher. */
export async function logLiveEvent(
  sessionId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (isDemoMode) return;
  const supabase = createSupabaseServerClient()!;
  await supabase.from("live_events").insert({ session_id: sessionId, type, payload });
}
