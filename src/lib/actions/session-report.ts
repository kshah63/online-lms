"use server";

import { getCurrentProfile } from "@/lib/data/auth";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { computeMetrics } from "@/lib/coaching/metrics";
import { DEMO_LESSON_TRANSCRIPT } from "@/lib/coaching/demo-transcript";
import { draftSessionReport, type DraftedSessionReport } from "@/lib/reports/draft-session-report";
import type { SessionReportDraft } from "@/lib/reports/mvapp-template";
import { isDemoMode } from "@/lib/env";

/**
 * Draft the centre-format session report for a lesson. Today the lesson
 * context (transcript, metrics, booked topic, topic options, previous
 * homework, in-lesson results) comes from the demo dataset; the live wiring to
 * mv-app's session_requests / course_topics / session_reports lands with the
 * port, and submit goes through mv-app's submit_report RPC.
 */
export async function draftSessionReportAction(input: {
  sessionId: string;
  notes: string;
  studentName: string;
  course: string;
  topicOptions: string[];
  bookedTopic?: string | null;
  signs: boolean;
}): Promise<DraftedSessionReport> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in");
  const useAi = await rateLimit(`ai:report:${profile.id}`, LIMITS.reportDraft.limit, LIMITS.reportDraft.windowSeconds);
  const segments = isDemoMode ? DEMO_LESSON_TRANSCRIPT : [];
  return draftSessionReport({
    notes: input.notes,
    segments,
    metrics: segments.length ? computeMetrics(segments) : null,
    studentName: input.studentName,
    course: input.course,
    topicOptions: input.topicOptions,
    bookedTopic: input.bookedTopic ?? null,
    signs: input.signs,
    useAi,
  });
}

export async function submitSessionReportAction(_sessionId: string, draft: SessionReportDraft): Promise<{ ok: boolean; message: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Not signed in." };
  if (isDemoMode) return { ok: true, message: `Demo mode: the report for "${draft.topic}" would be submitted to the centre app.` };
  return { ok: false, message: "Submitting to the centre app arrives with the integration release." };
}
