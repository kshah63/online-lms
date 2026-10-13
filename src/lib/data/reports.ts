import { isDemoMode } from "@/lib/env";
import { demoReports } from "@/lib/demo/data";
import { listMyOnlineLessons } from "@/lib/data/lessons";
import { DEMO_LESSON_TRANSCRIPT } from "@/lib/coaching/demo-transcript";
import { computeMetrics, type SessionMetrics, type TranscriptSegment } from "@/lib/coaching/metrics";
import type { OnlineLesson, Profile, Report } from "@/lib/types";

// ============================================================================
// Reports, behind the data layer. online-lms's reports table is retired: the
// centre's reports are mv-app's session_reports (written by submit_report, read
// through the app) and the AI draft is lesson_report_drafts. my_online_lessons
// already carries report_id, report_status and draft_ready per lesson. The
// next stage ports these readers; until then the live paths return nothing.
// ============================================================================

/** The legacy report for a session (demo only). TODO(next stage): session_reports via my_online_lessons.report_id. */
export async function getReport(sessionId: string): Promise<Report | null> {
  if (isDemoMode) return demoReports.find((r) => r.session_id === sessionId) ?? null;
  return null;
}

/** A teacher's completed lessons paired with their report status (for the queue). */
export async function getTeacherReportQueue(
  teacher: Profile,
): Promise<{ lesson: OnlineLesson; report: Report | null }[]> {
  const nowISO = new Date().toISOString();
  const lessons = (await listMyOnlineLessons(teacher, 30))
    .filter((l) => l.seat === "host" && l.status === "completed" && l.effective_start < nowISO)
    .sort((a, b) => (a.effective_start < b.effective_start ? 1 : -1));
  const rows = await Promise.all(lessons.map(async (lesson) => ({ lesson, report: await getReport(lesson.session_id) })));
  return rows;
}

/** Transcript segments + metrics for a session, for AI report drafting. */
export async function getSessionTranscript(
  sessionId: string,
): Promise<{ segments: TranscriptSegment[]; metrics: SessionMetrics | null }> {
  if (isDemoMode) {
    // Demo: reuse the scripted lesson so drafting has material to work with.
    const segments = DEMO_LESSON_TRANSCRIPT;
    return { segments, metrics: computeMetrics(segments) };
  }
  // TODO(next stage): lesson_transcripts.segments and lesson_metrics for sessionId (RLS: assigned teacher, in-charge, admin).
  void sessionId;
  return { segments: [], metrics: null };
}
