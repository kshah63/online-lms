import { notFound } from "next/navigation";
import { LessonDeviceGate } from "@/components/lesson/device-gate";
import { LessonRoom } from "@/components/lesson/lesson-room";
import { requireProfile, homePathForRole, viewerTimeZone } from "@/lib/data/auth";
import { getLessonRoomState } from "@/lib/data/lessons";
import { loadNotebookSnapshot } from "@/lib/actions/notebook";
import { lessonEndISO } from "@/lib/lessons/window";
import { isDemoMode } from "@/lib/env";
import { SAMPLE_QUESTIONS } from "@/lib/practice/samples";
import { displayName } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The lesson room. The booking is the lesson: rpc lesson_room_state returns one
 * row when session_requests holds the id and room_access gives this viewer a
 * seat (host, learner or observer), and none otherwise — which is a 404 here,
 * so a lesson "created only on the web" cannot exist. The room itself opens
 * only on a laptop or tablet: LessonDeviceGate measures the screen before
 * anything in the room mounts.
 */
export default async function LessonPage({ params }: { params: { sessionId: string } }) {
  const profile = await requireProfile();
  const state = await getLessonRoomState(profile, params.sessionId);
  if (!state) notFound();

  const notebookChannel = state.notebook_id ?? `session:${state.session_id}`;
  const initialSnapshot = await loadNotebookSnapshot(state.notebook_id);
  const courseName = state.course_name ?? state.subject ?? "Lesson";

  return (
    <LessonDeviceGate
      startISO={state.effective_start}
      endISO={lessonEndISO(state)}
      tz={viewerTimeZone(profile)}
      courseName={courseName}
      studentName={state.student_name}
      backHref={homePathForRole(profile.role)}
    >
      <LessonRoom
        sessionId={state.session_id}
        seat={state.seat}
        notebookId={notebookChannel}
        saveId={state.notebook_id}
        courseName={courseName}
        topic={state.topic}
        status={state.status}
        backHref={homePathForRole(profile.role)}
        selfId={profile.id}
        selfName={displayName(profile)}
        studentName={state.student_name}
        teacherName={state.teacher_name}
        startISO={state.effective_start}
        endISO={lessonEndISO(state)}
        arrivedAtISO={state.arrived_at}
        endedAtISO={state.room_closed_at ?? state.departed_at}
        consents={state.consents}
        initialSnapshot={initialSnapshot}
        demoCoaching={isDemoMode}
        activitySets={isDemoMode ? [{ id: "sample-quadratics", title: "Quadratics — quick check", questions: SAMPLE_QUESTIONS }] : []}
      />
    </LessonDeviceGate>
  );
}
