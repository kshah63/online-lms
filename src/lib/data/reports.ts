import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { buildDemoSessions, demoReports } from "@/lib/demo/data";
import { computeMetrics, type SessionMetrics, type TranscriptSegment } from "@/lib/coaching/metrics";
import type { Profile, Report, SessionView } from "@/lib/types";

/**
 * A short diarized lesson excerpt (completing the square) so AI report drafting
 * has material to work with in demo mode. Replaces the retired live-coach
 * script; the Pencil-shaped transcription fixture arrives with the post-session
 * pipeline (Phase 2).
 */
const DEMO_TRANSCRIPT_FIXTURE: TranscriptSegment[] = [
  { speaker: "teacher", start_ms: 0, end_ms: 14_000, text: "Today we're completing the square. Can you remind me what the vertex form of a quadratic looks like?" },
  { speaker: "student", start_ms: 15_000, end_ms: 24_000, text: "Um, something like a times x minus h squared, plus k?" },
  { speaker: "teacher", start_ms: 25_000, end_ms: 38_000, text: "Exactly. So with x squared plus six x, what would you do first?" },
  { speaker: "student", start_ms: 41_000, end_ms: 58_000, text: "Take half of six, that's three, and square it to get nine. Then add and subtract nine so the value doesn't change." },
  { speaker: "teacher", start_ms: 59_000, end_ms: 70_000, text: "Great — you kept the expression balanced. Now factor the first three terms for me." },
  { speaker: "student", start_ms: 72_000, end_ms: 84_000, text: "x plus three, all squared, minus nine. So the vertex is at minus three, minus nine." },
  { speaker: "teacher", start_ms: 85_000, end_ms: 102_000, text: "Well done. When there's a two in front, what changes? Take your time." },
  { speaker: "student", start_ms: 106_000, end_ms: 126_000, text: "I'd factor the two out of the first two terms first, complete the square inside the bracket, then multiply back through." },
  { speaker: "teacher", start_ms: 127_000, end_ms: 140_000, text: "That's it — and the sign inside the bracket is where people slip, so go slowly there. Try question four on your own." },
];

const SELECT = `
  *,
  course:courses(id,name,subject,materials_course_id),
  student:profiles!sessions_student_id_fkey(id,display_name,timezone,avatar_url),
  teacher:profiles!sessions_teacher_id_fkey(id,display_name,timezone,avatar_url)
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
    // Demo: a small fixture so drafting has material to work with.
    const segments = DEMO_TRANSCRIPT_FIXTURE;
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
