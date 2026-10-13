"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import { getMyOnlineLesson } from "@/lib/data/lessons";
import { getSessionTranscript } from "@/lib/data/reports";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { draftSessionReport, type DraftedSessionReport } from "@/lib/reports/draft-session-report";
import { signsReport } from "@/lib/reports/signs";
import type { SessionReportDraft } from "@/lib/reports/mvapp-template";
import type { ActionResult } from "@/lib/actions/types";

/**
 * Draft the centre-format session report for one of the teacher's lessons
 * from their notes plus the stored transcript and metrics (lesson_transcripts,
 * lesson_metrics under RLS). The result is the row submit_report wants; the
 * teacher edits every field before submitting.
 */
export async function draftSessionReportAction(input: {
  sessionId: string;
  notes: string;
  topicOptions: string[];
}): Promise<DraftedSessionReport> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in");
  const lesson = await getMyOnlineLesson(profile, input.sessionId);
  if (!lesson || lesson.seat !== "host") throw new Error("That lesson is not yours to report on.");

  const [useAi, { segments, metrics }] = await Promise.all([
    rateLimit(`ai:report:${profile.id}`, LIMITS.reportDraft.limit, LIMITS.reportDraft.windowSeconds),
    getSessionTranscript(input.sessionId),
  ]);
  return draftSessionReport({
    notes: input.notes,
    segments,
    metrics: metrics ? { ...metrics, avg_student_turn_ms: 0 } : null,
    studentName: lesson.student_name,
    course: lesson.subject ?? "the lesson",
    topicOptions: input.topicOptions,
    bookedTopic: lesson.topic,
    signs: signsReport(profile),
    useAi,
  });
}

/**
 * Submit through mv-app's one door for reports, rpc submit_report. Every rule
 * is the database's: who may write, the topic and understanding being
 * required, a GP only when the author signs, "already gone to the family",
 * "another colleague is already writing this report". The message of a
 * refusal is shown to the teacher as it came.
 */
export async function submitSessionReportAction(sessionId: string, draft: SessionReportDraft): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Not signed in." };

  if (isDemoMode) {
    revalidatePath("/teacher/reports");
    return { ok: true, message: `Demo mode: the report for "${draft.topic}" would be submitted through submit_report.` };
  }

  const supabase = createSupabaseServerClient()!;
  const { error } = await supabase.rpc("submit_report", {
    p_session_id: sessionId,
    p_topic: draft.topic,
    p_topic_completed: draft.topic_completed,
    p_understanding: draft.understanding,
    p_otr: draft.otr,
    p_gp: draft.gp,
    p_prev_hw: draft.prev_hw,
    p_homework: draft.homework || null,
    p_remarks: draft.remarks || null,
    p_written_tests: draft.written_tests.map((t) => ({ name: t.name, score: t.score, out_of: t.out_of, percent: t.percent })),
    p_has_upcoming_tests: draft.has_upcoming_tests,
    p_topics_not_done: draft.topic_completed ? null : draft.topics_not_done,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/teacher/reports");
  revalidatePath("/teacher");
  const signs = signsReport(profile);
  return { ok: true, message: signs ? "Published to the family." : "Sent to your in-charge for approval." };
}
