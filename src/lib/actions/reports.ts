"use server";

import { revalidatePath } from "next/cache";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import { getMyOnlineLesson } from "@/lib/data/lessons";
import { getSessionTranscript } from "@/lib/data/reports";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { draftReport, type ReportDraft } from "@/lib/reports/draft";
import type { ActionResult } from "@/lib/actions/types";

/** Ask AI for a draft from the teacher's notes + the lesson transcript/metrics. */
export async function generateReportDraft(sessionId: string, notes: string): Promise<ReportDraft> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in");
  const lesson = await getMyOnlineLesson(profile, sessionId);
  const { segments, metrics } = await getSessionTranscript(sessionId);

  // Cap model spend per teacher; over the limit we fall back to the notes heuristic.
  const useAi = await rateLimit(
    `ai:report_draft:${profile.id}`,
    LIMITS.reportDraft.limit,
    LIMITS.reportDraft.windowSeconds,
  );

  return draftReport({
    notes,
    segments,
    metrics,
    useAi,
    ctx: {
      studentName: lesson?.student_name ?? "the student",
      course: lesson?.subject ?? "the lesson",
    },
  });
}

export interface ReportInput {
  topics_covered: string;
  how_student_did: string;
  strengths: string;
  areas_to_work: string;
  homework: string;
  rating: number;
  teacher_notes: string;
  needs_followup: boolean;
  followup_reason: string;
  ai_drafted: boolean;
  homework_due: string | null;
}

/**
 * Save a draft or publish. online-lms's reports table is retired: the centre's
 * report is written by mv-app's submit_report RPC (session_reports) from the
 * centre-format editor, and the AI draft lives on lesson_report_drafts.
 * TODO(next stage): submit through rpc submit_report with the lesson_report_drafts
 * draft; until then this legacy editor cannot persist outside demo mode.
 */
export async function saveReport(sessionId: string, input: ReportInput, publish: boolean): Promise<ActionResult> {
  void sessionId;
  void input;
  if (isDemoMode) {
    revalidatePath("/teacher/reports");
    return { ok: true, message: publish ? "Demo mode: report not persisted." : "Demo mode: draft not saved." };
  }
  return { ok: false, message: "Reports are submitted to the centre app (submit_report) — that arrives with the next integration stage." };
}
