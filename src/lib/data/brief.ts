import { composeBrief, type Brief } from "@/lib/brief/compose";
import { briefInputFrom } from "@/lib/brief/input";
import { getMomentsForSession } from "@/lib/data/coaching";
import { getLessonRoomState, listMyOnlineLessons } from "@/lib/data/lessons";
import { getReportDraft, getReportsForStudent } from "@/lib/data/reports";
import type { OnlineLesson, Profile } from "@/lib/types";

// ============================================================================
// The pre-lesson brief for a teacher: composed from my_online_lessons,
// lesson_room_state (when the room is already open), the last session_report
// visible to the teacher — else the AI draft of their previous lesson with the
// student — and the coaching moments from that previous lesson. Read-only.
// ============================================================================

export async function getTeacherBrief(teacher: Profile, sessionId: string): Promise<{ lesson: OnlineLesson; brief: Brief } | null> {
  const lessons = await listMyOnlineLessons(teacher, 30);
  const lesson = lessons.find((l) => l.session_id === sessionId && l.seat === "host");
  if (!lesson) return null;

  // The teacher's previous lesson with this student, if any.
  const previous = lessons
    .filter((l) => l.seat === "host" && l.student_id === lesson.student_id && l.effective_start < lesson.effective_start)
    .sort((a, b) => (a.effective_start < b.effective_start ? 1 : -1))[0];

  const [state, reports, moments, draft] = await Promise.all([
    getLessonRoomState(teacher, sessionId),
    lesson.student_id ? getReportsForStudent(lesson.student_id, 1) : Promise.resolve([]),
    previous ? getMomentsForSession(teacher, previous.session_id) : Promise.resolve([]),
    previous && !previous.report_id ? getReportDraft(previous.session_id) : Promise.resolve(null),
  ]);

  const brief = composeBrief(briefInputFrom({ lesson, state, lastReport: reports[0] ?? null, lastDraft: draft, moments }));
  return { lesson, brief };
}
