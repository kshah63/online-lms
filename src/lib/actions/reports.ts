"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/auth";
import { getSessionById } from "@/lib/data/sessions";
import { getSessionTranscript } from "@/lib/data/reports";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { notifyReportPublished } from "@/lib/messaging/notify";
import { draftReport, type ReportDraft } from "@/lib/reports/draft";
import type { ActionResult } from "@/lib/actions/types";

/** §8 Ask AI for a draft from the teacher's notes + the lesson transcript/metrics. */
export async function generateReportDraft(sessionId: string, notes: string): Promise<ReportDraft> {
  const profile = await getCurrentProfile();
  const session = await getSessionById(sessionId);
  const { segments, metrics } = await getSessionTranscript(sessionId);

  // Cap Opus spend per teacher; over the limit we fall back to the notes heuristic.
  const useAi = await rateLimit(
    `ai:report_draft:${profile?.id ?? "anon"}`,
    LIMITS.reportDraft.limit,
    LIMITS.reportDraft.windowSeconds,
  );

  return draftReport({
    notes,
    segments,
    metrics,
    useAi,
    ctx: {
      studentName: session?.student.display_name ?? "the student",
      course: session?.course.name ?? "the lesson",
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

/** Save a draft or publish. On publish, assign homework + raise any follow-ups. */
export async function saveReport(
  sessionId: string,
  input: ReportInput,
  publish: boolean,
): Promise<ActionResult> {
  if (isDemoMode) {
    revalidatePath("/teacher/reports");
    return { ok: true, message: publish ? "Demo mode: report not persisted." : "Demo mode: draft not saved." };
  }

  const profile = await getCurrentProfile();
  const session = await getSessionById(sessionId);
  const supabase = createSupabaseServerClient()!;
  const published_at = publish ? new Date().toISOString() : null;

  const { error } = await supabase.from("reports").upsert({
    session_id: sessionId,
    teacher_id: profile?.id ?? null,
    topics_covered: input.topics_covered,
    how_student_did: input.how_student_did,
    strengths: input.strengths,
    areas_to_work: input.areas_to_work,
    homework: input.homework,
    rating: input.rating,
    teacher_notes: input.teacher_notes,
    ai_drafted: input.ai_drafted,
    needs_followup: input.needs_followup,
    followup_reason: input.followup_reason || null,
    published_at,
  });
  if (error) return { ok: false, message: error.message };

  if (publish && session) {
    if (input.homework.trim()) {
      await supabase.from("homework").insert({
        session_id: sessionId,
        student_id: session.student_id,
        course_id: session.course_id,
        description: input.homework.trim(),
        due_at: input.homework_due,
        notebook_id: session.notebook_id, // do it on the same running notebook
      });
    }
    if (input.needs_followup) {
      await supabase.from("followups").insert({
        student_id: session.student_id,
        session_id: sessionId,
        type: "report_flag",
        priority: "high",
        reason: input.followup_reason || "Teacher flagged this report for follow-up.",
      });
    } else if (input.rating <= 2) {
      await supabase.from("followups").insert({
        student_id: session.student_id,
        session_id: sessionId,
        type: "low_rating",
        priority: "normal",
        reason: `Low lesson rating (${input.rating}/5) in ${session.course.name}.`,
      });
    }

    // Tell the family their report is ready (no-op without opt-in/provider).
    await notifyReportPublished({
      studentId: session.student_id,
      studentName: session.student.display_name,
      course: session.course.name,
      sessionId,
    });
  }

  revalidatePath("/teacher/reports");
  revalidatePath("/home/reports");
  revalidatePath("/admin/followups");
  return { ok: true, message: publish ? "Report published." : "Draft saved." };
}
