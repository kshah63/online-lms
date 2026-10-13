import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { composeBrief, type Brief } from "@/lib/brief/compose";
import { EMPTY_BRIEF_FACTS, normaliseBriefFacts, type LessonBriefFacts } from "@/lib/brief/facts";
import { briefInputFrom } from "@/lib/brief/input";
import { getMomentsForSession } from "@/lib/data/coaching";
import { getLessonRoomState, listMyOnlineLessons } from "@/lib/data/lessons";
import { getSessionCourseId } from "@/lib/data/reports";
import { buildDemoLessonBriefFacts } from "@/lib/demo/brief";
import { demoTopicsForCourse } from "@/lib/demo/progress";
import type { MarkableTopic } from "@/components/progress/topic-mark-chips";
import type { OnlineLesson, Profile } from "@/lib/types";

// ============================================================================
// The pre-lesson brief: rpc lesson_brief_facts(p_session_id) — the last
// published reports by any teacher for this student and course (the
// widening the owner approved), the caller's own draft and coaching moments
// from their previous lesson, open practice, the teacher marks, the last
// homework — merged with the my_online_lessons row and lesson_room_state
// (when the room is open) through briefInputFrom. Read-only but for the
// host's topic marks, which go through set_topic_status.
// ============================================================================

export interface TeacherBriefView {
  lesson: OnlineLesson;
  brief: Brief;
  /** The course's syllabus with the student's current mark on each topic, for the host's "Mark a topic" chips. */
  topics: MarkableTopic[];
  /** The host marks topics; an observer (in-charge, admin) reads. */
  canMark: boolean;
}

/** rpc lesson_brief_facts for a lesson. The database decides who reads it (the assigned teacher, the room's in-charge, an admin) and refuses the rest. */
export async function getLessonBriefFacts(viewer: Profile, sessionId: string): Promise<LessonBriefFacts> {
  if (isDemoMode) {
    const { facts, previousSessionId } = buildDemoLessonBriefFacts(viewer, sessionId);
    const moments = previousSessionId ? await getMomentsForSession(viewer, previousSessionId) : [];
    return { ...facts, moments: moments.map((m) => ({ kind: m.kind, comment: m.comment })) };
  }

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.rpc("lesson_brief_facts", { p_session_id: sessionId });
  if (error) throw new Error(`lesson_brief_facts failed: ${error.message}`);
  return normaliseBriefFacts(data);
}

/** syllabus_topics for a course (any signed-in account may read the labels), in syllabus order. */
export async function getSyllabusTopics(courseId: string | null): Promise<{ id: string; label: string }[]> {
  if (!courseId) return [];
  if (isDemoMode) return demoTopicsForCourse(courseId).map((t) => ({ id: t.id, label: t.label }));

  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase.from("syllabus_topics").select("id, label").eq("course_id", courseId).eq("is_active", true).order("sort_order").order("label");
  if (error) throw new Error(`syllabus_topics failed: ${error.message}`);
  return (data ?? []).map((t) => ({ id: String((t as { id: string }).id), label: String((t as { label: string }).label) }));
}

/** The brief for a lesson the viewer's list carries as host or observer; null when it is not theirs. */
export async function getTeacherBrief(viewer: Profile, sessionId: string): Promise<TeacherBriefView | null> {
  const lessons = await listMyOnlineLessons(viewer, 30);
  const lesson = lessons.find((l) => l.session_id === sessionId && (l.seat === "host" || l.seat === "observer"));
  if (!lesson) return null;

  const [state, facts, courseId] = await Promise.all([getLessonRoomState(viewer, sessionId), getLessonBriefFacts(viewer, sessionId), getSessionCourseId(viewer, sessionId)]);
  const syllabus = await getSyllabusTopics(courseId);

  const markByTopic = new Map(facts.teacher_marks.map((m) => [m.topic_id, m]));
  const topics: MarkableTopic[] = syllabus.map((t) => {
    const m = markByTopic.get(t.id);
    return { id: t.id, label: t.label, status: m?.status ?? null, at: m?.at ?? null };
  });

  const brief = composeBrief(briefInputFrom({ lesson, state, facts: facts ?? EMPTY_BRIEF_FACTS }));
  return { lesson, brief, topics, canMark: lesson.seat === "host" && lesson.student_id != null };
}
