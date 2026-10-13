import { DateTime } from "luxon";
import { buildDemoSessionRequests, demoCourses, demoInchargeDepartments, demoProfiles, demoReportDrafts, demoSessionReports } from "@/lib/demo/data";
import { demoPracticeAssignments, demoSyllabusTopics, demoTeacherMarks } from "@/lib/demo/progress";
import type { LessonBriefFacts } from "@/lib/brief/facts";
import { displayName, type Profile } from "@/lib/types";

// ============================================================================
// Demo rows behind the brief and the recording link: rpc lesson_brief_facts
// as the demo answers it (mirroring its gate and its widening — published
// reports by any teacher for the student and course), and lesson_recordings
// for the lessons that were recorded. Used only when isDemoMode is true.
// ============================================================================

/** Mirrors reads_lesson: the assigned teacher, the room's in-charge, an admin. */
export function demoReadsLesson(viewer: Profile, sessionId: string): boolean {
  const s = buildDemoSessionRequests().find((x) => x.id === sessionId);
  if (!s) return false;
  if (s.assigned_teacher_id === viewer.id) return true;
  if (viewer.role === "admin") return true;
  if (viewer.role === "staff") return (demoInchargeDepartments[viewer.id] ?? []).includes(s.department_id);
  return false;
}

/**
 * rpc lesson_brief_facts(p_session_id) in demo. The coaching moments of the
 * caller's previous lesson live with the coaching demo (data/coaching.ts),
 * so the previous session's id is handed back for the data layer to fetch
 * them through the same door the live path uses.
 */
export function buildDemoLessonBriefFacts(viewer: Profile, sessionId: string, nowISO = new Date().toISOString()): { facts: LessonBriefFacts; previousSessionId: string | null } {
  const sessions = buildDemoSessionRequests();
  const s = sessions.find((x) => x.id === sessionId);
  if (!s) throw new Error("no such session");
  if (!demoReadsLesson(viewer, sessionId)) throw new Error("only the lesson's teacher, the room's in-charge or an admin reads its brief");

  const course = demoCourses.find((c) => c.id === s.course_id)!;
  const teacherOf = (sessionRequestId: string | null) => {
    const teacherId = sessions.find((x) => x.id === sessionRequestId)?.assigned_teacher_id ?? null;
    const t = demoProfiles.find((p) => p.id === teacherId);
    return t ? displayName(t) : null;
  };

  const last_reports = demoSessionReports
    .filter((r) => r.student_id === s.student_id && r.status === "published" && r.course_name === course.name)
    .sort((a, b) => ((a.published_at ?? "") < (b.published_at ?? "") ? 1 : -1))
    .slice(0, 3)
    .map((r) => ({
      id: r.id,
      at: r.published_at ?? r.created_at,
      topic: r.topic,
      topic_completed: r.topic_completed,
      topics_not_done: r.topics_not_done,
      understanding: r.understanding,
      homework: r.homework,
      remarks: r.remarks,
      prev_hw: r.prev_hw,
      teacher_name: teacherOf(r.session_request_id),
    }));

  // The caller's own previous lesson with this student.
  const previous = sessions
    .filter((x) => x.student_id === s.student_id && x.assigned_teacher_id === viewer.id && x.id !== s.id && x.effective_start < s.effective_start && x.status !== "cancelled" && x.status !== "declined")
    .sort((a, b) => (a.effective_start < b.effective_start ? 1 : -1))[0];
  let last_draft: LessonBriefFacts["last_draft"] = null;
  if (previous) {
    const reported = demoSessionReports.some((r) => r.session_request_id === previous.id && r.status !== "rejected");
    const draft = demoReportDrafts[previous.id];
    if (!reported && draft) last_draft = { session_id: draft.session_id, created_at: draft.created_at, draft: draft.draft };
  }

  const since = DateTime.fromISO(nowISO, { zone: "utc" }).minus({ days: 30 }).toISO()!;
  const open_practice = demoPracticeAssignments(nowISO)
    .filter((a) => a.student_id === s.student_id && a.course_id === s.course_id && a.created_at >= since)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(({ assignment_id, set_title, kind, due_at, attempt_status, score, out_of }) => ({ assignment_id, set_title, kind, due_at, attempt_status, score, out_of }));

  const teacher_marks = demoTeacherMarks(nowISO)
    .filter((m) => m.student_id === s.student_id)
    .flatMap((m) => {
      const t = demoSyllabusTopics.find((x) => x.id === m.syllabus_topic_id);
      return t && t.course_id === s.course_id ? [{ topic_id: t.id, label: t.label, status: m.status, at: m.marked_at }] : [];
    });

  return {
    facts: { last_reports, last_draft, moments: [], open_practice, teacher_marks, homework_last: last_reports[0]?.homework ?? null },
    previousSessionId: previous?.id ?? null,
  };
}

/** lesson_recordings rows: the reported lessons were recorded (the family's consent is on for both students). */
export function demoRecordings(nowISO = new Date().toISOString()) {
  const now = DateTime.fromISO(nowISO, { zone: "utc" });
  const row = (sessionId: string, recordedAt: DateTime, durationS: number) => ({
    session_id: sessionId,
    provider_recording_id: `demo-${sessionId.slice(-4)}`,
    duration_s: durationS,
    recorded_at: recordedAt.toISO()!,
    expires_at: recordedAt.plus({ days: 90 }).toISO()!,
    deleted_at: null as string | null,
  });
  return [
    row("20000000-0000-0000-0000-000000000001", now.minus({ hours: 1, minutes: 30 }), 58 * 60),
    row("20000000-0000-0000-0000-000000000007", now.minus({ days: 7 }), 59 * 60),
  ];
}

/** Mirrors lesson_recordings_select: reads_lesson, or the household while the recording consent is in force. */
export function demoReadsRecording(viewer: Profile, sessionId: string, consentOn: boolean): boolean {
  if (demoReadsLesson(viewer, sessionId)) return true;
  const s = buildDemoSessionRequests().find((x) => x.id === sessionId);
  if (!s || !s.family_id || !viewer.family_id) return false;
  return viewer.family_id === s.family_id && consentOn;
}
