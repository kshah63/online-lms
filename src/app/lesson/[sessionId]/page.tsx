import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, ShieldX } from "lucide-react";
import { LessonRoom, ParentStatusCard } from "@/components/lesson/lesson-room";
import { Button } from "@/components/ui/button";
import { requireProfile, homePathForRole } from "@/lib/data/auth";
import { getSessionById } from "@/lib/data/sessions";
import { getChildren } from "@/lib/data/people";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";
import { captureError } from "@/lib/observability";
import { demoRecordingOptOuts } from "@/lib/demo/data";
import { pencilLive } from "@/lib/pencil/client";
import { canEndLesson, canJoinLesson } from "@/lib/pencil/authz";
import { mockPencilUserId } from "@/lib/pencil/mock";
import { getPencilUser, getSpaceForPair, isRecordingOptedOut, recordingPolicyBlocksJoin } from "@/lib/pencil/provision";
import { lessonFallbackForced, resolveFallbackUrl } from "@/lib/pencil/urls";
import type { SessionView } from "@/lib/types";

/**
 * The lesson room. SERVER COMPONENT = DB-ONLY reads: the Space row, the
 * student's Pencil id and the opt-out flag come from the service-only tables
 * via the admin client (after the access rule below). No Pencil call happens
 * here and no join URL is ever rendered — the client mints one per click via
 * POST /api/lesson/[id]/space.
 */
export default async function LessonPage({ params }: { params: { sessionId: string } }) {
  const profile = await requireProfile();
  const session = await getSessionById(params.sessionId);
  if (!session) notFound();

  // ----- Access control (§4) — the same rule the Space route re-applies -----
  const isTeacher = profile.role === "teacher";
  const children = await getChildren(profile); // self for student, kids for parent
  const childIds = children.map((c) => c.id);
  if (!canJoinLesson(profile, session, childIds)) {
    return <AccessDenied isTeacher={isTeacher} backHref={homePathForRole(profile.role)} />;
  }

  const backHref = homePathForRole(profile.role);
  const state = await loadRoomState(session);
  const teacherName = session.teacher?.display_name ?? "Teacher (unassigned)";

  // Parents: status card only — no Pencil user, no seat in the room (owner decision 3).
  if (profile.role === "parent") {
    return (
      <ParentStatusCard
        courseName={session.course.name}
        studentName={session.student.display_name}
        teacherName={teacherName}
        status={session.status}
        actualStartISO={session.actual_start}
        actualEndISO={session.actual_end}
        recordingOn={!state.optedOut}
        backHref={backHref}
      />
    );
  }

  const hostView = profile.role === "teacher" || profile.role === "admin";
  const peer = hostView ? session.student : session.teacher;

  return (
    <LessonRoom
      sessionId={session.id}
      courseName={session.course.name}
      materialsCourseId={session.course.materials_course_id}
      status={session.status}
      backHref={backHref}
      viewerKind={profile.role}
      canEnd={canEndLesson(profile, session)}
      selfName={profile.display_name}
      peerName={hostView ? session.student.display_name : teacherName}
      peerAvatarUrl={peer?.avatar_url ?? null}
      studentPencilUserId={state.studentPencilUserId}
      recordingOn={!state.optedOut}
      optOutUnconfirmed={state.policyUnconfirmed}
      roomUnavailable={state.unavailable}
      mock={!pencilLive}
      fallbackUrl={resolveFallbackUrl(session)}
      fallbackForced={lessonFallbackForced()}
      actualStartISO={session.actual_start}
      actualEndISO={session.actual_end}
    />
  );
}

// ---------------------------------------------------------------------------

interface RoomState {
  /** Student's Pencil user id (mock-user-… when Pencil is mocked); null until first provisioned. */
  studentPencilUserId: string | null;
  optedOut: boolean;
  /** Opted out, but the (real) Space has not confirmed recording_disabled → hard stop. */
  policyUnconfirmed: boolean;
  /** The rows could not be read (service role missing / query error) → "Classroom unavailable". */
  unavailable: boolean;
}

/** DB-only reads through the service role. Never calls Pencil. */
async function loadRoomState(session: SessionView): Promise<RoomState> {
  const studentId = session.student_id;
  const admin = createSupabaseAdminClient();

  if (!pencilLive) {
    // Mock Space (demo dataset, or Supabase without a Pencil key). The opt-out flag is still ours.
    let optedOut = false;
    try {
      optedOut = isDemoMode
        ? demoRecordingOptOuts.some((o) => o.student_id === studentId)
        : admin
          ? await isRecordingOptedOut(admin, studentId)
          : false;
    } catch (err) {
      captureError(err, { where: "lesson page: opt-out lookup", session_id: session.id });
    }
    return { studentPencilUserId: mockPencilUserId(studentId), optedOut, policyUnconfirmed: false, unavailable: false };
  }

  if (!admin) {
    captureError(new Error("SUPABASE_SERVICE_ROLE_KEY is missing — the lesson room needs the service role"), {
      where: "lesson page",
    });
    return { studentPencilUserId: null, optedOut: false, policyUnconfirmed: false, unavailable: true };
  }

  try {
    const [space, studentUser, optedOut] = await Promise.all([
      getSpaceForPair(admin, studentId, session.course_id),
      getPencilUser(admin, studentId),
      isRecordingOptedOut(admin, studentId),
    ]);
    // Only a provisioned Space can be "policy not applied"; a missing or seeded
    // 'mock' row is upgraded by the route, which applies the policy before minting.
    const policyUnconfirmed = space !== null && space.status !== "mock" && recordingPolicyBlocksJoin(optedOut, space);
    return { studentPencilUserId: studentUser?.pencil_user_id ?? null, optedOut, policyUnconfirmed, unavailable: false };
  } catch (err) {
    captureError(err, { where: "lesson page: room state", session_id: session.id });
    return { studentPencilUserId: null, optedOut: false, policyUnconfirmed: false, unavailable: true };
  }
}

function AccessDenied({ isTeacher, backHref }: { isTeacher: boolean; backHref: string }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldX className="h-7 w-7" />
      </div>
      <div>
        <h1 className="text-lg font-semibold">You can&rsquo;t join this lesson</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {isTeacher
            ? "Teachers can only join sessions they are assigned to. Ask an admin to assign you if this is yours."
            : "This lesson belongs to a different student."}
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href={backHref}>
          <Clock className="h-4 w-4" /> Back to dashboard
        </Link>
      </Button>
    </div>
  );
}
