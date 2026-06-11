import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Clock, ShieldX, Timer } from "lucide-react";
import { LessonRoom } from "@/components/lesson/lesson-room";
import { LessonTimer } from "@/components/lesson/lesson-timer";
import { ProviderBadge } from "@/components/lesson/video-panel";
import { StatusBadge } from "@/components/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { requireProfile, homePathForRole } from "@/lib/data/auth";
import { getSessionById } from "@/lib/data/sessions";
import { getChildren, getConsents } from "@/lib/data/people";
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

  // ----- Recording consent gate (§9) ---------------------------------------
  const consents = await getConsents(session.student_id);
  const recordingAllowed = consents.some((c) => c.type === "recording");

  // The "other" participant.
  const peerName = isTeacher
    ? session.student.display_name
    : session.teacher?.display_name ?? "Teacher (unassigned)";

  const notebookId = session.notebook_id ?? session.id;
  const initialSnapshot = await loadNotebookSnapshot(notebookId);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-3 md:px-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={homePathForRole(profile.role)}>
            <ChevronLeft className="h-4 w-4" /> Leave
          </Link>
        </Button>

        <div className="hidden h-6 w-px bg-border sm:block" />

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{session.course.name}</span>
            <StatusBadge status={session.status} />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Avatar name={peerName} size={16} />
            <span className="truncate">with {peerName}</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
            <Timer className="h-4 w-4" />
            <LessonTimer startISO={session.scheduled_start} />
          </div>
          <ProviderBadge />
        </div>
      </header>

      {/* Three-panel body */}
      <LessonRoom
        sessionId={session.id}
        notebookId={notebookId}
        materialsCourseId={session.course.materials_course_id}
        courseName={session.course.name}
        selfId={profile.id}
        selfName={profile.display_name}
        peerName={peerName}
        recordingAllowed={recordingAllowed}
        isTeacher={isTeacher}
        initialSnapshot={initialSnapshot}
        demoCoaching={isDemoMode}
      />
    </div>
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
