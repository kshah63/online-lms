import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { buildDemoSessionRequests, demoCourseTopics, demoProfiles, demoReportDrafts, demoSessionReports } from "@/lib/demo/data";
import { getLessonRoomState, listMyOnlineLessons } from "@/lib/data/lessons";
import { DEMO_LESSON_TRANSCRIPT } from "@/lib/coaching/demo-transcript";
import { computeMetrics, type TranscriptSegment } from "@/lib/coaching/metrics";
import { lessonEndISO } from "@/lib/lessons/window";
import { SESSION_REPORT_COLUMNS, type LessonMetricsRow, type OnlineLesson, type Profile, type ReportDraftRow, type SessionReport } from "@/lib/types";

// ============================================================================
// Reports, read-only here. The centre's report is mv-app's session_reports,
// written only by rpc submit_report (src/lib/actions/session-report.ts); the AI
// draft is lesson_report_drafts, written by lesson-finalize. my_online_lessons
// already says per lesson whether a report exists (report_id, report_status)
// and whether a draft is waiting (draft_ready).
// ============================================================================

/** What the teacher's list shows for one lesson's report. */
export type ReportState = "published" | "pending" | "rejected" | "draft_ready" | "none";

export function reportState(l: Pick<OnlineLesson, "report_id" | "report_status" | "draft_ready">): ReportState {
  if (l.report_id && (l.report_status === "published" || l.report_status === "pending" || l.report_status === "rejected"))
    return l.report_status;
  return l.draft_ready ? "draft_ready" : "none";
}

/** A past lesson the teacher taught that still has no report in the app. */
export function needsReport(l: OnlineLesson, nowISO: string): boolean {
  if (l.seat !== "host") return false;
  if (l.status !== "completed" && l.status !== "confirmed") return false;
  if (lessonEndISO(l) > nowISO) return false;
  return l.report_id === null || l.report_status === "rejected";
}

/** The teacher's past lessons split into those awaiting a report and those reported, newest first. */
export async function getTeacherReportQueue(teacher: Profile): Promise<{ pending: OnlineLesson[]; done: OnlineLesson[] }> {
  const nowISO = new Date().toISOString();
  const past = (await listMyOnlineLessons(teacher, 14))
    .filter((l) => l.seat === "host" && lessonEndISO(l) <= nowISO && l.status !== "cancelled" && l.status !== "declined")
    .sort((a, b) => (a.effective_start < b.effective_start ? 1 : -1));
  return {
    pending: past.filter((l) => needsReport(l, nowISO)),
    done: past.filter((l) => !needsReport(l, nowISO)),
  };
}

/** The AI draft for a lesson, or null when lesson-finalize has not written one (RLS: assigned teacher, in-charge, admin). */
export async function getReportDraft(sessionId: string): Promise<ReportDraftRow | null> {
  if (isDemoMode) return demoReportDrafts[sessionId] ?? null;

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("lesson_report_drafts")
    .select("session_id, draft, rationale, source, created_at, used_at")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw new Error(`lesson_report_drafts failed: ${error.message}`);
  return (data as ReportDraftRow | null) ?? null;
}

/** Published reports the viewer's family may read (RLS: status published and family_id = my_family_id()), newest first. */
export async function getPublishedFamilyReports(viewer: Profile, limit = 50): Promise<{ rows: SessionReport[]; hitLimit: boolean }> {
  if (isDemoMode) {
    // Mirror the policy: only the viewer's own family's students.
    const family = new Set(demoProfiles.filter((p) => p.family_id != null && p.family_id === viewer.family_id).map((p) => p.id));
    const rows = demoSessionReports
      .filter((r) => r.status === "published" && r.student_id != null && family.has(r.student_id))
      .sort((a, b) => ((a.published_at ?? "") < (b.published_at ?? "") ? 1 : -1));
    return { rows, hitLimit: false };
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("session_reports")
    .select(SESSION_REPORT_COLUMNS)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`session_reports failed: ${error.message}`);
  const rows = (data ?? []).map((r) => toReport(r as Record<string, unknown>));
  return { rows, hitLimit: rows.length === limit };
}

/** The most recent reports on a student the viewer may read (a teacher sees only reports on their own sessions). */
export async function getReportsForStudent(studentId: string, limit = 3): Promise<SessionReport[]> {
  if (isDemoMode) {
    return demoSessionReports
      .filter((r) => r.student_id === studentId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, limit);
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("session_reports")
    .select(SESSION_REPORT_COLUMNS)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`session_reports failed: ${error.message}`);
  return (data ?? []).map((r) => toReport(r as Record<string, unknown>));
}

function toReport(r: Record<string, unknown>): SessionReport {
  return {
    ...(r as unknown as SessionReport),
    written_tests: Array.isArray(r.written_tests) ? (r.written_tests as SessionReport["written_tests"]) : [],
    has_upcoming_tests: Boolean(r.has_upcoming_tests),
  };
}

/** The booking's course: from lesson_room_state while the room is open, else the teacher's own session_requests row (RLS: assigned teacher, mode online). */
export async function getSessionCourseId(viewer: Profile, sessionId: string): Promise<string | null> {
  const state = await getLessonRoomState(viewer, sessionId);
  if (state?.course_id) return state.course_id;

  if (isDemoMode) return buildDemoSessionRequests().find((s) => s.id === sessionId)?.course_id ?? null;

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("session_requests").select("course_id").eq("id", sessionId).maybeSingle();
  if (error) throw new Error(`session_requests failed: ${error.message}`);
  return (data?.course_id as string | null) ?? null;
}

/** course_topics labels for a course — the pick list for the report's topic. */
export async function getTopicOptions(courseId: string | null): Promise<string[]> {
  if (!courseId) return [];
  if (isDemoMode) return demoCourseTopics.filter((t) => t.course_id === courseId).map((t) => t.label);

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("course_topics")
    .select("label")
    .eq("course_id", courseId)
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(`course_topics failed: ${error.message}`);
  return (data ?? []).map((t) => String((t as { label: string }).label));
}

/** Transcript segments + metrics for a lesson (RLS: assigned teacher, in-charge, admin), for drafting and coaching. */
export async function getSessionTranscript(
  sessionId: string,
): Promise<{ segments: TranscriptSegment[]; metrics: LessonMetricsRow | null }> {
  if (isDemoMode) {
    // Demo: reuse the scripted lesson so drafting has material to work with.
    const segments = DEMO_LESSON_TRANSCRIPT;
    const { avg_student_turn_ms: _dropped, ...metrics } = computeMetrics(segments);
    void _dropped;
    return { segments, metrics: { session_id: sessionId, ...metrics, computed_at: new Date().toISOString() } };
  }

  const supabase = createSupabaseServerClient()!;
  const [transcript, metrics] = await Promise.all([
    supabase.from("lesson_transcripts").select("segments").eq("session_id", sessionId).maybeSingle(),
    supabase.from("lesson_metrics").select(LESSON_METRICS_COLUMNS).eq("session_id", sessionId).maybeSingle(),
  ]);
  if (transcript.error) throw new Error(`lesson_transcripts failed: ${transcript.error.message}`);
  if (metrics.error) throw new Error(`lesson_metrics failed: ${metrics.error.message}`);
  const segments = Array.isArray(transcript.data?.segments) ? (transcript.data!.segments as TranscriptSegment[]) : [];
  return { segments, metrics: (metrics.data as LessonMetricsRow | null) ?? null };
}

export const LESSON_METRICS_COLUMNS =
  "session_id, teacher_talk_pct, student_talk_pct, question_count, open_question_pct, avg_wait_ms, student_turns, praise_count, computed_at";
