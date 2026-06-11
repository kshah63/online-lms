import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { buildDemoSessions, demoReports } from "@/lib/demo/data";
import { DEMO_LESSON_TRANSCRIPT } from "@/lib/coaching/demo-transcript";
import { computeMetrics, type SessionMetrics, type TranscriptSegment } from "@/lib/coaching/metrics";
import type { Profile, Report, SessionView } from "@/lib/types";

const SELECT = `
  *,
  course:courses(id,name,subject,materials_course_id),
  student:profiles!student_id(id,display_name,timezone,avatar_url),
  teacher:profiles!teacher_id(id,display_name,timezone,avatar_url)
`;

export async function getReport(sessionId: string): Promise<Report | null> {
  if (isDemoMode) return demoReports.find((r) => r.session_id === sessionId) ?? null;
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("reports").select("*").eq("session_id", sessionId).maybeSingle();
  if (error) throw error;
  return (data as Report) ?? null;
}

/** A teacher's completed lessons paired with their report status (for the queue). */
export async function getTeacherReportQueue(
  teacher: Profile,
): Promise<{ session: SessionView; report: Report | null }[]> {
  const nowISO = new Date().toISOString();

  if (isDemoMode) {
    const sessions = buildDemoSessions()
      .filter((s) => s.teacher_id === teacher.id && s.status === "completed" && s.scheduled_end < nowISO)
      .sort((a, b) => (a.scheduled_start < b.scheduled_start ? 1 : -1));
    return sessions.map((s) => ({ session: s, report: demoReports.find((r) => r.session_id === s.id) ?? null }));
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("sessions")
    .select(`${SELECT}, report:reports(*)`)
    .eq("teacher_id", teacher.id)
    .eq("status", "completed")
    .order("scheduled_start", { ascending: false })
    .limit(40);
  if (error) throw error;
  return ((data ?? []) as unknown as (SessionView & { report: Report[] | Report | null })[]).map((row) => {
    const report = Array.isArray(row.report) ? (row.report[0] ?? null) : row.report;
    return { session: row, report };
  });
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

  const supabase = createSupabaseServerClient()!;
  const [{ data: t }, { data: m }] = await Promise.all([
    supabase.from("transcripts").select("segments").eq("session_id", sessionId).maybeSingle(),
    supabase.from("session_metrics").select("*").eq("session_id", sessionId).maybeSingle(),
  ]);
  return {
    segments: ((t?.segments as TranscriptSegment[]) ?? []) as TranscriptSegment[],
    metrics: (m as SessionMetrics) ?? null,
  };
}
