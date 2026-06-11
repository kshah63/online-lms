import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, ShieldX } from "lucide-react";
import { LessonRoom } from "@/components/lesson/lesson-room";
import { Button } from "@/components/ui/button";
import { requireProfile, homePathForRole } from "@/lib/data/auth";
import { getSessionById } from "@/lib/data/sessions";
import { getChildren } from "@/lib/data/people";
import { loadNotebookSnapshot } from "@/lib/actions/notebook";
import { isDemoMode } from "@/lib/env";

export default async function LessonPage({ params }: { params: { sessionId: string } }) {
  const profile = await requireProfile();
  const session = await getSessionById(params.sessionId);
  if (!session) notFound();

  // ----- Access control (§4) ------------------------------------------------
  const isTeacher = profile.role === "teacher";
  const children = await getChildren(profile); // self for student, kids for parent
  const childIds = children.map((c) => c.id);

  let allowed = profile.role === "admin";
  if (isTeacher) allowed = session.teacher_id === profile.id; // assigned-teacher-only
  if (profile.role === "student") allowed = session.student_id === profile.id;
  if (profile.role === "parent") allowed = childIds.includes(session.student_id);

  if (!allowed) {
    return <AccessDenied isTeacher={isTeacher} backHref={homePathForRole(profile.role)} />;
  }

  // The "other" participant.
  const peerName = isTeacher
    ? session.student.display_name
    : session.teacher?.display_name ?? "Teacher (unassigned)";

  const notebookId = session.notebook_id ?? session.id;
  const initialSnapshot = await loadNotebookSnapshot(notebookId);

  return (
    <LessonRoom
      sessionId={session.id}
      notebookId={notebookId}
      materialsCourseId={session.course.materials_course_id}
      courseName={session.course.name}
      status={session.status}
      backHref={homePathForRole(profile.role)}
      selfId={profile.id}
      selfName={profile.display_name}
      peerName={peerName}
      isTeacher={isTeacher}
      initialSnapshot={initialSnapshot}
      actualStartISO={session.actual_start}
      demoCoaching={isDemoMode}
    />
  );
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
